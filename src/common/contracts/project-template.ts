// Schema for bundled project templates (PRD §18, DATA_MODEL §10.1; M1-5 #32) and the
// `template.list` query.
//
// A project template ("starter package") describes what a kind of project asks for (its input
// fields), what it produces (artifact types) and what it can't do offline. A project records
// the template ID and version it came from, so both must be stable and safe to store.
//
// M1 templates are **metadata only**: no workflows, agents, skills or checks yet (those
// arrive with M3/M4). `metadataOnly: true` says so in every manifest, and the schema refuses
// `workflows`/`agents` keys, so a manifest can't pretend to ship something the app can't run.
import { z } from 'zod';

/** Bump when the manifest shape changes in a way old readers can't handle. */
export const PROJECT_TEMPLATE_SCHEMA_VERSION = 1;

/** Upper bound on templates loaded or listed, so the list query stays bounded. */
export const MAX_PROJECT_TEMPLATES = 100;

/**
 * Lowercase words joined by dots or dashes, e.g. `builtin.content-campaign`. No slashes,
 * backslashes, `..`, spaces or uppercase: an ID is stored in the database and may one day name
 * a folder, so it must never be able to point somewhere else.
 */
export const TemplateId = z
  .string()
  .max(100)
  .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'lowercase words joined by "." or "-"');

/**
 * Plain semantic version `MAJOR.MINOR.PATCH` (lesson 009): no leading zeros, no `v` prefix,
 * no pre-release or build suffix. Each part is capped so versions compare as small integers.
 */
export const TemplateVersion = z
  .string()
  .max(14)
  .regex(
    /^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/,
    'semantic version MAJOR.MINOR.PATCH',
  );

/** camelCase key for an input field, e.g. `expectedDeliverable`. */
const FieldKey = z
  .string()
  .max(40)
  .regex(/^[a-z][a-zA-Z0-9]*$/, 'camelCase key');

const Label = z.string().trim().min(1).max(80);
const Help = z.string().trim().min(1).max(300);

/** Fields every input type shares. */
const fieldBase = {
  key: FieldKey,
  label: Label,
  help: Help.optional(),
  required: z.boolean(),
};

const ChoiceOption = z.strictObject({
  value: TemplateId,
  label: Label,
});

/** 2–20 options with distinct values. */
const ChoiceOptions = z
  .array(ChoiceOption)
  .min(2)
  .max(20)
  .refine(
    (options) => new Set(options.map((option) => option.value)).size === options.length,
    'duplicate option value',
  );

/**
 * One input the project asks for. The `type` decides which extra settings apply:
 * - `text`: one line, `longText`: paragraphs (both with a length cap)
 * - `date`: a calendar day, `dateRange`: a start and end day
 * - `choice`: pick one option, `multiChoice`: pick one or more
 * - `fileReferences`: files the user selects (references only, never copied or read here)
 */
export const TemplateInputField = z.discriminatedUnion('type', [
  z.strictObject({ ...fieldBase, type: z.literal('text'), maxLength: z.int().min(1).max(500) }),
  z.strictObject({
    ...fieldBase,
    type: z.literal('longText'),
    maxLength: z.int().min(1).max(20_000),
  }),
  z.strictObject({ ...fieldBase, type: z.literal('date') }),
  z.strictObject({ ...fieldBase, type: z.literal('dateRange') }),
  z.strictObject({ ...fieldBase, type: z.literal('choice'), options: ChoiceOptions }),
  z.strictObject({ ...fieldBase, type: z.literal('multiChoice'), options: ChoiceOptions }),
  z.strictObject({
    ...fieldBase,
    type: z.literal('fileReferences'),
    maxFiles: z.int().min(1).max(50),
  }),
]);
export type TemplateInputField = z.infer<typeof TemplateInputField>;
export type TemplateInputFieldType = TemplateInputField['type'];

/** The same list of types as a plain enum, for summaries (a test keeps the two lists equal). */
export const InputFieldType = z.enum([
  'text',
  'longText',
  'date',
  'dateRange',
  'choice',
  'multiChoice',
  'fileReferences',
]);

/** File formats a template's outputs are written as. */
export const ArtifactFormat = z.enum(['markdown', 'csv', 'text']);
export type ArtifactFormat = z.infer<typeof ArtifactFormat>;

export const TemplateArtifactType = z.strictObject({
  id: TemplateId,
  name: Label,
  format: ArtifactFormat,
  description: Help,
});
export type TemplateArtifactType = z.infer<typeof TemplateArtifactType>;

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

export const ProjectTemplateManifest = z
  .strictObject({
    schemaVersion: z.literal(PROJECT_TEMPLATE_SCHEMA_VERSION),
    kind: z.literal('project-template'),
    id: TemplateId,
    version: TemplateVersion,
    name: Label,
    description: z.string().trim().min(1).max(500),
    publisher: Label,
    source: z.strictObject({ type: z.literal('bundled') }),
    /** Always true in M1: the manifest describes the template but runs nothing. */
    metadataOnly: z.literal(true),
    /** Plain-language note on what is not implemented yet, shown next to the template. */
    metadataOnlyNote: Help,
    inputFields: z.array(TemplateInputField).min(1).max(30),
    artifactTypes: z.array(TemplateArtifactType).min(1).max(20),
    /** What this template can't do without a network or extra tools. Shown to the user. */
    offlineLimitations: z.array(Help).max(20),
  })
  .superRefine((manifest, ctx) => {
    if (hasDuplicates(manifest.inputFields.map((field) => field.key))) {
      ctx.addIssue({ code: 'custom', path: ['inputFields'], message: 'duplicate field key' });
    }
    if (hasDuplicates(manifest.artifactTypes.map((artifact) => artifact.id))) {
      ctx.addIssue({ code: 'custom', path: ['artifactTypes'], message: 'duplicate artifact id' });
    }
  });
export type ProjectTemplateManifest = z.infer<typeof ProjectTemplateManifest>;

// ---- `template.list` -------------------------------------------------------------------

/** Takes no payload. Anything sent along (even `{}`) is rejected, not ignored. */
export const TemplateListInput = z.undefined();
export type TemplateListInput = z.infer<typeof TemplateListInput>;

/** Why a bundled template couldn't be offered. Details stay in the main-process log. */
export const TemplateUnavailableReason = z.enum([
  'invalid_manifest', // the file failed the schema above
  'location_mismatch', // its folder doesn't match its ID or version
  'too_many_templates', // files beyond MAX_PROJECT_TEMPLATES (reported once, not per file)
]);
export type TemplateUnavailableReason = z.infer<typeof TemplateUnavailableReason>;

const AvailableTemplateSummary = z.strictObject({
  status: z.literal('available'),
  id: TemplateId,
  version: TemplateVersion,
  name: Label,
  description: z.string().max(500),
  metadataOnly: z.literal(true),
  metadataOnlyNote: Help,
  inputFields: z
    .array(
      z.strictObject({
        key: FieldKey,
        label: Label,
        type: InputFieldType,
        required: z.boolean(),
      }),
    )
    .max(30),
  artifactTypes: z
    .array(z.strictObject({ id: TemplateId, name: Label, format: ArtifactFormat }))
    .max(20),
  offlineLimitations: z.array(Help).max(20),
});

const UnavailableTemplateSummary = z.strictObject({
  status: z.literal('unavailable'),
  /** Bundled folder relative to resources/project-templates, e.g. `generic/1.0.0`. */
  location: z.string().max(200),
  reason: TemplateUnavailableReason,
});

export const TemplateSummary = z.discriminatedUnion('status', [
  AvailableTemplateSummary,
  UnavailableTemplateSummary,
]);
export type TemplateSummary = z.infer<typeof TemplateSummary>;

export const TemplateListOutput = z.strictObject({
  templates: z.array(TemplateSummary).max(MAX_PROJECT_TEMPLATES + 1),
});
export type TemplateListOutput = z.infer<typeof TemplateListOutput>;

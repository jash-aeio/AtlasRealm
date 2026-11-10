import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  InputFieldType,
  ProjectTemplateManifest,
  TemplateInputField,
  TemplateId,
  TemplateVersion,
} from '../../src/common/contracts/project-template';

const TEMPLATES = join(import.meta.dirname, '..', '..', 'resources', 'project-templates');

function readTemplate(folder: string): unknown {
  return JSON.parse(readFileSync(join(TEMPLATES, folder, '1.0.0', 'template.json'), 'utf8'));
}

const generic = ProjectTemplateManifest.parse(readTemplate('generic'));
const campaign = ProjectTemplateManifest.parse(readTemplate('content-campaign'));

type Manifest = ProjectTemplateManifest;

/** A copy of the Generic manifest with one input field changed (or replaced). */
function withField(index: number, patch: Record<string, unknown>): unknown {
  return {
    ...generic,
    inputFields: generic.inputFields.map((field, at) =>
      at === index ? { ...field, ...patch } : field,
    ),
  };
}

/** A copy of the Generic manifest with one extra input field appended. */
function withExtraField(field: Record<string, unknown>): unknown {
  return { ...generic, inputFields: [...generic.inputFields, field] };
}

function withoutTextMaxLength(): unknown {
  return {
    ...generic,
    inputFields: generic.inputFields.map((field) =>
      field.type === 'text'
        ? { key: field.key, label: field.label, required: true, type: 'text' }
        : field,
    ),
  };
}

function refused(input: unknown): boolean {
  return !ProjectTemplateManifest.safeParse(input).success;
}

describe('bundled project templates', () => {
  it('both validate and say they are metadata only', () => {
    for (const template of [generic, campaign]) {
      expect(template.metadataOnly).toBe(true);
      expect(template.metadataOnlyNote).toMatch(/M3\/M4/);
      expect(template.source).toEqual({ type: 'bundled' });
    }
    expect(generic.id).toBe('builtin.generic');
    expect(campaign.id).toBe('builtin.content-campaign');
  });

  it('Generic asks for the PRD §18.1 inputs', () => {
    expect(generic.inputFields.map((field) => field.key)).toEqual([
      'goal',
      'requirements',
      'referenceFiles',
      'expectedDeliverable',
      'deadline',
    ]);
    const required = generic.inputFields.filter((f) => f.required).map((f) => f.key);
    expect(required).toEqual(['goal', 'requirements', 'expectedDeliverable']);
  });

  it('Content Campaign asks for the PRD §18.2 inputs and outputs a CSV calendar', () => {
    expect(campaign.inputFields.map((field) => field.key)).toEqual([
      'organizationDescription',
      'audience',
      'objective',
      'tone',
      'channels',
      'campaignDates',
      'contentConstraints',
      'sourceMaterials',
    ]);
    expect(campaign.artifactTypes.find((a) => a.id === 'content-calendar')?.format).toBe('csv');
  });

  // PRD §18.6: renaming agents or swapping artwork is not evidence of extensibility. The two
  // templates must differ in what they actually ask for.
  it('the two templates have genuinely different input fields (§18.6)', () => {
    const genericKeys = new Set(generic.inputFields.map((f) => f.key));
    const campaignKeys = campaign.inputFields.map((f) => f.key);
    expect(campaignKeys.filter((key) => genericKeys.has(key))).toEqual([]);

    const genericTypes = new Set(generic.inputFields.map((f) => f.type));
    const campaignTypes = new Set(campaign.inputFields.map((f) => f.type));
    // Campaign uses field types Generic doesn't (choice, multiChoice, dateRange).
    expect([...campaignTypes].filter((type) => !genericTypes.has(type)).sort()).toEqual([
      'choice',
      'dateRange',
      'multiChoice',
    ]);
    // And they produce different artifact formats (Generic has no CSV).
    expect(generic.artifactTypes.map((a) => a.format)).not.toContain('csv');
  });
});

describe('malformed template fixtures are refused', () => {
  it('accepts the unmodified fixture (so the refusals below are meaningful)', () => {
    expect(refused(withField(0, {}))).toBe(false);
  });

  const choice = { key: 'size', label: 'Size', required: true, type: 'choice' };
  it.each<[string, (m: Manifest) => unknown]>([
    ['unknown top-level field', (m) => ({ ...m, extra: true })],
    ['workflows (not in M1)', (m) => ({ ...m, workflows: [] })],
    ['agents (not in M1)', (m) => ({ ...m, agents: [] })],
    ['metadataOnly false', (m) => ({ ...m, metadataOnly: false })],
    ['newer schemaVersion', (m) => ({ ...m, schemaVersion: 2 })],
    ['wrong kind', (m) => ({ ...m, kind: 'skill' })],
    ['non-bundled source', (m) => ({ ...m, source: { type: 'github' } })],
    ['no input fields', (m) => ({ ...m, inputFields: [] })],
    ['no artifact types', (m) => ({ ...m, artifactTypes: [] })],
    ['empty name', (m) => ({ ...m, name: '   ' })],
    ['unknown field on an input', () => withField(0, { script: 'x' })],
    ['unknown input type', () => withField(0, { type: 'html' })],
    ['text input without maxLength', () => withoutTextMaxLength()],
    ['duplicate field key', () => withField(1, { key: 'goal' })],
    ['field key with a path', () => withField(0, { key: '../x' })],
    [
      'choice with one option',
      () => withExtraField({ ...choice, options: [{ value: 'one', label: 'One' }] }),
    ],
    [
      'choice with duplicate options',
      () =>
        withExtraField({
          ...choice,
          options: [
            { value: 'one', label: 'One' },
            { value: 'one', label: 'Uno' },
          ],
        }),
    ],
    [
      'unknown artifact format',
      (m) => ({ ...m, artifactTypes: m.artifactTypes.map((a) => ({ ...a, format: 'exe' })) }),
    ],
  ])('refuses %s', (_name, malform) => {
    expect(refused(malform(generic))).toBe(true);
  });

  it.each(['1.0', '01.0.0', 'v1.0.0', '1.0.0-beta', '1.0.0+build', '10000.0.0', '', '1.0.0 '])(
    'refuses bad version %j',
    (version) => {
      expect(TemplateVersion.safeParse(version).success).toBe(false);
      expect(refused({ ...generic, version })).toBe(true);
    },
  );

  it.each([
    '../generic',
    'builtin/generic',
    'builtin\\generic',
    'Builtin.Generic',
    'builtin..generic',
    '.generic',
    'generic.',
    'c:generic',
    'gen eric',
    '',
    'a'.repeat(101),
  ])('refuses unsafe id %j', (id) => {
    expect(TemplateId.safeParse(id).success).toBe(false);
    expect(refused({ ...generic, id })).toBe(true);
  });

  it('accepts ordinary versions and ids', () => {
    expect(TemplateVersion.safeParse('0.1.0').success).toBe(true);
    expect(TemplateVersion.safeParse('12.3.45').success).toBe(true);
    expect(TemplateId.safeParse('builtin.content-campaign').success).toBe(true);
  });

  it('the summary enum lists exactly the input field types the manifest accepts', () => {
    const unionTypes = TemplateInputField.options.map((option) => option.shape.type.value);
    expect([...unionTypes].sort()).toEqual([...InputFieldType.options].sort());
  });

  it('refuses non-object input', () => {
    for (const input of [null, undefined, 'template', 42, []]) expect(refused(input)).toBe(true);
  });
});

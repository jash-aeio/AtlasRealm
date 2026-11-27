// The one manifest "envelope" for agent, skill and tool packages (DATA_MODEL §10.1; M3-1 #111).
//
// Every package carries a `manifest.json` in this shape. Shared fields describe the package
// (who made it, its license, what it needs); a kind-specific block adds what only an agent or a
// tool has. The catalog loader (M3-2) parses bundled packages with `parseResourceManifest`, and
// later imports will use the same function on untrusted community packages.
//
// The MVP path is declarative only (§10.3): a package is text and metadata, never code. So
// `executable: true`, install scripts, entry points and paths that leave the package folder are
// refused here with a named reason, before anything else looks at the package.
//
// `declaredPermissions` are *requests*. Nothing in this module turns them into access: the
// permission broker (M3-10) decides at run time, and the user grants (SECURITY §13.2).
import { z } from 'zod';

import {
  CapabilityId,
  isScopeAllowed,
  PermissionScope,
  REFUSED_IN_PACKAGES,
} from '../security/capabilities';
import { hasHiddenCharacters } from '../text/hidden-characters';
import { DisplayName } from './display-name';
import { TemplateVersion } from './project-template';

/** Bump when the manifest shape changes in a way old readers can't handle. */
export const RESOURCE_MANIFEST_SCHEMA_VERSION = 1;

/**
 * Namespaced package ID: two or more lowercase words joined by dots, each word may contain
 * dashes, e.g. `builtin.structured-brief`. Like template IDs it is stored and may name a
 * folder, so it can't contain slashes, `..` or uppercase. The namespace before the first dot
 * says who publishes it (`builtin` = bundled with the app).
 */
export const ResourceId = z
  .string()
  .max(100)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/,
    'namespaced id such as "builtin.structured-brief"',
  );
export type ResourceId = z.infer<typeof ResourceId>;

/** Plain semantic version `MAJOR.MINOR.PATCH`, the same rule as project templates. */
export const ResourceVersion = TemplateVersion;
export type ResourceVersion = z.infer<typeof ResourceVersion>;

// ---- Version ranges (ADR-0034) ---------------------------------------------------------

/**
 * Which versions of another package are accepted. Only two forms, on purpose (ADR-0034):
 * - `1.2.0`: exactly that version
 * - `^1.2.0`: that version or a newer compatible one, with npm's caret meaning: the leftmost
 *   non-zero part stays fixed (`^1.2.0` = 1.x.x from 1.2.0; `^0.3.1` = 0.3.x from 0.3.1;
 *   `^0.0.4` = only 0.0.4), because before 1.0.0 every minor release may break things.
 */
export const VersionRange = z
  .string()
  .max(15)
  .regex(
    /^\^?(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/,
    'version "1.2.0" or caret range "^1.2.0"',
  );
export type VersionRange = z.infer<typeof VersionRange>;

type VersionParts = readonly [number, number, number];

function versionParts(version: string): VersionParts {
  const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
  return [major, minor, patch];
}

/** Negative if `a` is older than `b`, 0 if equal, positive if newer. Inputs must be valid. */
export function compareVersions(a: ResourceVersion, b: ResourceVersion): number {
  const left = versionParts(a);
  const right = versionParts(b);
  for (let index = 0; index < 3; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** True if `version` is accepted by `range`. Returns false for malformed input. */
export function satisfiesRange(range: string, version: string): boolean {
  if (!VersionRange.safeParse(range).success || !ResourceVersion.safeParse(version).success) {
    return false;
  }
  if (!range.startsWith('^')) return range === version;

  const base = range.slice(1);
  if (compareVersions(version, base) < 0) return false;
  const [baseMajor, baseMinor, basePatch] = versionParts(base);
  const [major, minor, patch] = versionParts(version);
  if (baseMajor > 0) return major === baseMajor;
  if (baseMinor > 0) return major === 0 && minor === baseMinor;
  return major === 0 && minor === 0 && patch === basePatch;
}

// ---- Refusal reasons -------------------------------------------------------------------

/** Why a manifest was refused. Shown to the user as a plain reason; details go to the log. */
export const ManifestRefusalReason = z.enum([
  'not_an_object', // not a JSON object at all
  'unsupported_schema_version', // `schemaVersion` missing or not one this app reads
  'install_script', // asks to run something on install (§10.3)
  'executable_content', // `executable: true`, an entry point, or running programs (§10.3)
  'unknown_key', // a field this schema version doesn't define
  'unsafe_path', // a referenced file could leave the package folder
  'unknown_capability', // a capability ID the app doesn't know (§21.2)
  'permission_mismatch', // a needed capability isn't declared, or the scope doesn't fit it
  'origin_mismatch', // claims to be bundled with the app, but wasn't found in the app's own folder
  'invalid_manifest', // anything else that fails the schema
]);
export type ManifestRefusalReason = z.infer<typeof ManifestRefusalReason>;

// Refinements tag their issues with `params.reason`, so the parser can name the refusal
// without matching message text.
const tagged = (reason: ManifestRefusalReason, error: string) => ({ error, params: { reason } });

// ---- Package-relative paths ------------------------------------------------------------

/**
 * One folder or file name: letters, digits, `_`, `-`, and dots or spaces inside the name.
 * The allowlist alone refuses `..`, `.`, hidden dotfiles, drive colons, alternate data
 * streams (`a.md:stream`), backslashes, wildcards and control characters, and the first and
 * last character rule refuses names Windows silently changes (`notes.` → `notes`).
 */
const SAFE_SEGMENT = /^[A-Za-z0-9_-](?:[A-Za-z0-9._ -]{0,62}[A-Za-z0-9_-])?$/;

/**
 * Windows device names. `NUL.md` or `com1.txt` still opens the device, whatever the folder
 * and extension, so the part before the first dot is checked. Includes the superscript-digit
 * forms (`COM¹`) that Windows also treats as devices.
 */
const DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])$/i;

const MAX_PATH_SEGMENTS = 8;

/**
 * True if `path` is a plain relative path inside the package folder: forward slashes only, no
 * leading slash (absolute), no empty segment (which also catches `//server` UNC paths), and
 * every segment safe. This is a text check; the loader re-checks the real file on disk with
 * `realpath` in M3-2, because a link inside the package could still point elsewhere.
 */
export function isSafePackagePath(path: string): boolean {
  if (path.length === 0 || path.length > 200) return false;
  const segments = path.split('/');
  if (segments.length > MAX_PATH_SEGMENTS) return false;
  return segments.every((segment) => {
    if (!SAFE_SEGMENT.test(segment)) return false;
    const stem = segment.split('.')[0] ?? segment;
    return !DEVICE_NAME.test(stem.trimEnd());
  });
}

export const PackageRelativePath = z
  .string()
  .max(400)
  .refine(isSafePackagePath, tagged('unsafe_path', 'path must stay inside the package folder'));

// ---- Shared field rules ----------------------------------------------------------------

/** DisplayName's character rules (no control or hidden characters) with a longer limit. */
const Description = z
  .string()
  // `abort` stops here for oversized text, so the scans below never run on megabytes
  // (#111 security review L2).
  .max(1100, { abort: true })
  .trim()
  .min(1)
  .refine((text) => Array.from(text).length <= 500, 'description is too long')
  .refine(
    (text) => !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(text) && !hasHiddenCharacters(text),
    'invalid characters',
  );

/**
 * An SPDX license identifier (`MIT`, `Apache-2.0`), a custom `LicenseRef-…`, or `UNLICENSED`
 * for proprietary packages such as our bundled ones (ADR-0008). The spec example's
 * `PROJECT_LICENSE_TO_BE_SELECTED` placeholder is refused: it isn't a license.
 */
export const LicenseId = z
  .string()
  .max(64)
  .regex(/^(?:LicenseRef-)?[A-Za-z0-9][A-Za-z0-9.+-]*$/, 'SPDX license identifier');

/** A capability ID that must be in the registry. Unknown IDs get their own refusal reason. */
const KnownCapability = z
  .custom<CapabilityId>(
    (value) => CapabilityId.safeParse(value).success,
    tagged('unknown_capability', 'unknown capability'),
  )
  .refine(
    (id) => !REFUSED_IN_PACKAGES.has(id),
    tagged('executable_content', 'running programs is not allowed in packages'),
  );

/** Model features a package can need (AI_PROVIDERS §11.3). */
export const ModelCapability = z.enum(['text', 'tool-calling', 'image-input', 'structured-output']);
export type ModelCapability = z.infer<typeof ModelCapability>;

/** Another package this one needs, and which of its versions work. */
export const PackageReference = z.strictObject({
  id: ResourceId,
  versionRange: VersionRange,
});
export type PackageReference = z.infer<typeof PackageReference>;

/**
 * A request for one capability within one scope. It is only a request: the broker (M3-10)
 * checks it against the user's grants at run time. There is deliberately no "grant" type here.
 */
export const PermissionRequest = z.strictObject({
  capability: KnownCapability,
  scope: PermissionScope,
});
export type PermissionRequest = z.infer<typeof PermissionRequest>;

const MAX_REFERENCES = 20;
const MAX_CAPABILITIES = CapabilityId.options.length;

const References = z.array(PackageReference).max(MAX_REFERENCES);
const Capabilities = z.array(KnownCapability).max(MAX_CAPABILITIES);

const envelope = {
  schemaVersion: z.literal(RESOURCE_MANIFEST_SCHEMA_VERSION),
  id: ResourceId,
  version: ResourceVersion,
  name: DisplayName,
  description: Description,
  publisher: DisplayName,
  license: LicenseId,
  /** Where the package came from. Only bundled packages exist until imports arrive. */
  source: z.strictObject({ type: z.literal('bundled') }),
  runtimeCompatibility: z.strictObject({
    manifestSchema: z.literal(RESOURCE_MANIFEST_SCHEMA_VERSION),
  }),
  requirements: z.strictObject({
    modelCapabilities: z.array(ModelCapability).max(ModelCapability.options.length),
    toolCapabilities: Capabilities,
    packages: References.default([]),
  }),
  /** The package's instructions (for an agent: its role instructions). */
  instructionsPath: PackageRelativePath,
  /** Always false in the declarative MVP path (§10.3). */
  executable: z.literal(false),
  declaredPermissions: z.array(PermissionRequest).max(MAX_CAPABILITIES * 2),
};

const SkillManifest = z.strictObject({ ...envelope, kind: z.literal('skill') });

const AgentManifest = z.strictObject({
  ...envelope,
  kind: z.literal('agent'),
  agent: z.strictObject({
    /** Skills assigned to a new instance of this agent until the user changes them. */
    defaultSkills: References,
    /** Tools bound to a new instance until the user changes them. */
    defaultTools: References,
  }),
});

const ToolManifest = z.strictObject({
  ...envelope,
  kind: z.literal('tool'),
  tool: z.strictObject({
    /** The capabilities this tool performs. Each must also be a declared permission. */
    implements: Capabilities.min(1),
  }),
});

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated];
}

export const ResourceManifest = z
  .discriminatedUnion('kind', [SkillManifest, AgentManifest, ToolManifest])
  .superRefine((manifest, ctx) => {
    const mismatch = tagged('permission_mismatch', '');
    const declared = manifest.declaredPermissions;

    declared.forEach((request, index) => {
      if (!isScopeAllowed(request.capability, request.scope)) {
        ctx.addIssue({
          code: 'custom',
          path: ['declaredPermissions', index, 'scope'],
          message: `scope "${request.scope}" does not fit ${request.capability}`,
          params: mismatch.params,
        });
      }
    });
    if (duplicates(declared.map((request) => request.capability)).length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['declaredPermissions'],
        message: 'capability declared more than once',
      });
    }

    // Everything the package will use must be visible in its permission requests, so an
    // import preview (§10.3) shows the full picture.
    const declaredIds = new Set(declared.map((request) => request.capability));
    const needed = [
      ...manifest.requirements.toolCapabilities,
      ...(manifest.kind === 'tool' ? manifest.tool.implements : []),
    ];
    for (const capability of new Set(needed)) {
      if (!declaredIds.has(capability)) {
        ctx.addIssue({
          code: 'custom',
          path: ['declaredPermissions'],
          message: `${capability} is needed but not declared`,
          params: mismatch.params,
        });
      }
    }

    const lists: [string[], (string | number)[]][] = [
      [manifest.requirements.toolCapabilities, ['requirements', 'toolCapabilities']],
      [manifest.requirements.modelCapabilities, ['requirements', 'modelCapabilities']],
      [manifest.requirements.packages.map((ref) => ref.id), ['requirements', 'packages']],
    ];
    if (manifest.kind === 'agent') {
      lists.push(
        [manifest.agent.defaultSkills.map((ref) => ref.id), ['agent', 'defaultSkills']],
        [manifest.agent.defaultTools.map((ref) => ref.id), ['agent', 'defaultTools']],
      );
    }
    if (manifest.kind === 'tool') lists.push([manifest.tool.implements, ['tool', 'implements']]);
    for (const [values, path] of lists) {
      if (duplicates(values).length > 0) {
        ctx.addIssue({ code: 'custom', path, message: 'duplicate entry' });
      }
      if (values.includes(manifest.id)) {
        ctx.addIssue({ code: 'custom', path, message: 'a package cannot depend on itself' });
      }
    }
  });
export type ResourceManifest = z.infer<typeof ResourceManifest>;
export type ResourceKind = ResourceManifest['kind'];

// ---- Parsing with a named reason -------------------------------------------------------

/**
 * Top-level keys that ask for something to run on install or on use. They are unknown keys
 * anyway, but get their own reasons so the user sees *why* the package can't be installed.
 */
const INSTALL_SCRIPT_KEYS = new Set([
  'scripts',
  'install',
  'preinstall',
  'postinstall',
  'prepare',
  'setup',
  'hooks',
  'installScript',
]);
const EXECUTABLE_KEYS = new Set(['main', 'bin', 'entrypoint', 'entryPoint', 'command', 'exec']);

const MAX_REPORTED_ISSUES = 10;

export type ManifestParseResult =
  | { readonly ok: true; readonly manifest: ResourceManifest }
  | {
      readonly ok: false;
      readonly reason: ManifestRefusalReason;
      /** Short `path: message` lines for the main-process log. Never sent to the renderer. */
      readonly issues: readonly string[];
    };

function refuse(reason: ManifestRefusalReason, issues: string[] = []): ManifestParseResult {
  return { ok: false, reason, issues: issues.slice(0, MAX_REPORTED_ISSUES) };
}

/** Shows a control character as its code, e.g. a newline as `\u000a`. */
function escapeControl(char: string): string {
  return `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`;
}

/**
 * Messages can quote attacker-controlled text (an unknown key's name), so control and line
 * separator characters are escaped: a manifest can't forge extra log lines or send terminal
 * escape codes (#111 security review L1).
 */
function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join('.') || '(root)';
  return `${path}: ${issue.message}`
    .slice(0, 400)
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, escapeControl)
    .slice(0, 200);
}

function issueReason(issue: z.core.$ZodIssue): ManifestRefusalReason | undefined {
  if (issue.code === 'unrecognized_keys') return 'unknown_key';
  if (issue.code === 'custom') {
    const parsed = ManifestRefusalReason.safeParse(issue.params?.['reason']);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}

// When several things are wrong, the most specific reason wins.
const REASON_ORDER: readonly ManifestRefusalReason[] = [
  'executable_content',
  'unknown_key',
  'unsafe_path',
  'unknown_capability',
  'permission_mismatch',
];

/**
 * Where the code that found the manifest says it came from. A manifest's own `source` field
 * is only a claim: an imported file could say anything (#111 security review M1).
 * - `bundled`: read from the app's own resources folder
 * - `import`: anything else, such as a package the user imports
 */
export type ManifestOrigin = 'bundled' | 'import';

/** The `builtin` namespace belongs to packages that ship with the app. */
const BUNDLED_NAMESPACE = 'builtin.';

/**
 * Validates an already JSON-parsed manifest. Checks run in a fixed order so the reason is
 * stable: shape, schema version, install scripts, executable content, the full schema, and
 * finally whether the manifest's claimed origin matches `origin`. The caller must cap the
 * file size before `JSON.parse` (M3-2).
 */
export function parseResourceManifest(raw: unknown, origin: ManifestOrigin): ManifestParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return refuse('not_an_object');
  }
  const record = raw as Record<string, unknown>;
  if (record['schemaVersion'] !== RESOURCE_MANIFEST_SCHEMA_VERSION) {
    return refuse('unsupported_schema_version');
  }
  const keys = Object.keys(record);
  const scriptKeys = keys.filter((key) => INSTALL_SCRIPT_KEYS.has(key));
  if (scriptKeys.length > 0) {
    return refuse(
      'install_script',
      scriptKeys.map((key) => `${key}: install scripts are not allowed`),
    );
  }
  const runKeys = keys.filter((key) => EXECUTABLE_KEYS.has(key));
  if (record['executable'] !== false && record['executable'] !== undefined) {
    return refuse('executable_content', ['executable: only declarative packages are supported']);
  }
  if (runKeys.length > 0) {
    return refuse(
      'executable_content',
      runKeys.map((key) => `${key}: entry points are not allowed`),
    );
  }

  const result = ResourceManifest.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues;
    const reasons = new Set(issues.map(issueReason));
    const reason = REASON_ORDER.find((candidate) => reasons.has(candidate)) ?? 'invalid_manifest';
    return refuse(reason, issues.slice(0, MAX_REPORTED_ISSUES).map(describeIssue));
  }

  const manifest = result.data;
  // `source.type` can only be `bundled` so far, so every imported manifest claims to be bundled
  // and stops here. When imports add their own source types, keep refusing an imported
  // `source.type: 'bundled'` and the reserved `builtin.*` namespace: an imported
  // `builtin.structured-brief` 9.0.0 must never pass for a newer bundled package.
  if (origin !== 'bundled') {
    const detail = manifest.id.startsWith(BUNDLED_NAMESPACE)
      ? 'id: the builtin namespace is reserved for bundled packages'
      : 'source: claims to be bundled with the app';
    return refuse('origin_mismatch', [detail]);
  }
  return { ok: true, manifest };
}

// Shared pieces for the product repositories (profile settings, worlds, projects): stable
// error codes, input limits, validation and the expected-revision update.
//
// The schema's CHECK constraints (migrations/index.ts, v2) are the last line of defence; the
// checks here run first so callers get a stable error code instead of a raw SQLite message.
import type { Database, SQLInputValue } from '../database';

/** Stable codes. Application services map them to IPC errors; never match on messages. */
export type RepositoryErrorCode =
  | 'not_found'
  | 'already_exists'
  | 'invalid_input'
  /** The caller's expected revision is out of date: someone changed the record first. */
  | 'revision_conflict'
  /** The record is in a state that doesn't allow this change (e.g. archiving a trashed project). */
  | 'invalid_transition';

export class RepositoryError extends Error {
  constructor(
    readonly code: RepositoryErrorCode,
    message: string,
    /** Set for `revision_conflict`: the revision the record really has now. */
    readonly currentRevision?: number,
  ) {
    super(message);
    this.name = 'RepositoryError';
  }
}

/** Must match the CHECK constraints in migration 2. Lengths are in characters (code points). */
export const LIMITS = {
  nameMaxChars: 80,
  goalMaxChars: 2000,
  slugMaxChars: 64,
  timezoneMaxChars: 64,
  templateVersionMaxChars: 32,
  preferencesMaxChars: 16_384,
  gridMin: 16,
  gridMax: 256,
} as const;

export type Row = Record<string, unknown>;

/** Characters as SQLite's length() counts them (code points), not UTF-16 units. */
export function charCount(value: string): number {
  // Array.from walks a string by code point, which is exactly what SQLite counts.
  return Array.from(value).length;
}

// SQLite's length() stops at a NUL byte, so control characters are refused here, not there.
// \p{Cc} is the Unicode "control character" category (NUL, escape, DEL, ...).
const CONTROL_CHARS = /\p{Cc}/u;
const CONTROL_CHARS_EXCEPT_LINE_BREAKS_AND_TABS = /(?![\t\n\r])\p{Cc}/u;
// Invisible characters that can disguise text ("Trojan Source" spoofing): zero-width space,
// left/right marks, bidi embeddings, overrides and isolates. Zero-width (non-)joiners stay
// allowed: emoji sequences and scripts such as Persian need them.
const SPOOFING_CHARS = /[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;
// Unicode line and paragraph separators: a "single line" name must not contain them.
const LINE_SEPARATORS = /[\p{Zl}\p{Zp}]/u;
// In a `u` regex, a surrogate range matches only *unpaired* halves. SQLite would silently
// replace one with U+FFFD, so the stored text would differ from the input.
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

function assertCleanText(value: string, field: string, allowLineBreaks: boolean): void {
  const control = allowLineBreaks ? CONTROL_CHARS_EXCEPT_LINE_BREAKS_AND_TABS : CONTROL_CHARS;
  if (
    control.test(value) ||
    SPOOFING_CHARS.test(value) ||
    (!allowLineBreaks && LINE_SEPARATORS.test(value))
  ) {
    throw new RepositoryError('invalid_input', `${field} contains control characters.`);
  }
  if (LONE_SURROGATE.test(value)) {
    throw new RepositoryError('invalid_input', `${field} is not valid Unicode text.`);
  }
}

/** A display name: trimmed, 1–80 characters, single line. Returns the trimmed value. */
export function normalizeName(value: string, field: string): string {
  const name = value.trim();
  if (name.length === 0) throw new RepositoryError('invalid_input', `${field} is empty.`);
  if (charCount(name) > LIMITS.nameMaxChars) {
    throw new RepositoryError(
      'invalid_input',
      `${field} is longer than ${String(LIMITS.nameMaxChars)} characters.`,
    );
  }
  assertCleanText(name, field, false);
  return name;
}

/** Free text such as a project goal: trimmed, may be empty, may span lines. */
export function normalizeText(value: string, field: string, maxChars: number): string {
  const text = value.trim();
  if (charCount(text) > maxChars) {
    throw new RepositoryError(
      'invalid_input',
      `${field} is longer than ${String(maxChars)} characters.`,
    );
  }
  assertCleanText(text, field, true);
  return text;
}

const SLUG = /^[a-z0-9-]+$/;

/** A lowercase slug ID such as `generic` or `content-campaign`. */
export function assertSlug(value: string, field: string): string {
  if (value.length > LIMITS.slugMaxChars || !SLUG.test(value)) {
    throw new RepositoryError(
      'invalid_input',
      `${field} must be 1–${String(LIMITS.slugMaxChars)} characters of a-z, 0-9 and "-".`,
    );
  }
  return value;
}

// MAJOR.MINOR.PATCH with an optional pre-release/build suffix, lowercase.
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9a-z.+-]+)?$/;

export function assertVersion(value: string, field: string): string {
  if (value.length > LIMITS.templateVersionMaxChars || !SEMVER.test(value)) {
    throw new RepositoryError('invalid_input', `${field} must be a version like 1.0.0.`);
  }
  return value;
}

// IANA IDs start with a letter (`Europe/Amsterdam`, `UTC`, `Etc/GMT+2`). Intl also accepts
// bare offsets such as `+02:00`, which are not IANA IDs and don't follow daylight saving time.
const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+\-/]*$/;

/**
 * An IANA timezone ID the runtime knows, returned in its canonical spelling
 * (`europe/amsterdam` → `Europe/Amsterdam`), so schedules can compare zones as strings.
 */
export function canonicalTimezone(value: string): string {
  const invalid = new RepositoryError('invalid_input', 'Timezone is not a valid IANA timezone ID.');
  if (value.length > LIMITS.timezoneMaxChars || !IANA_SHAPE.test(value)) throw invalid;
  let canonical: string;
  try {
    // Throws a RangeError for an unknown zone.
    canonical = new Intl.DateTimeFormat('en', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw invalid;
  }
  if (canonical.length > LIMITS.timezoneMaxChars || !IANA_SHAPE.test(canonical)) throw invalid;
  return canonical;
}

export function assertGridSize(value: number, field: string): number {
  if (!Number.isInteger(value) || value < LIMITS.gridMin || value > LIMITS.gridMax) {
    throw new RepositoryError(
      'invalid_input',
      `${field} must be a whole number from ${String(LIMITS.gridMin)} to ${String(LIMITS.gridMax)}.`,
    );
  }
  return value;
}

function assertRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RepositoryError('invalid_input', 'Expected revision must be a positive integer.');
  }
}

// --- Reading rows -----------------------------------------------------------------------------
// node:sqlite returns loosely typed values. These helpers fail loudly if the schema and the
// code disagree, instead of letting a wrong type travel further into the app.

export function text(row: Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw new Error(`Column ${column} is not TEXT.`);
  return value;
}

export function nullableText(row: Row, column: string): string | null {
  return row[column] === null ? null : text(row, column);
}

export function integer(row: Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Column ${column} is not INTEGER.`);
  }
  return value;
}

// --- Expected-revision update -----------------------------------------------------------------

export interface GuardedUpdate {
  /** Compile-time constants only: they are interpolated into the SQL. */
  readonly table: 'profile_settings' | 'worlds' | 'projects';
  readonly keyColumn: 'profile_id' | 'id';
  readonly key: string;
  readonly expectedRevision: number;
  /** SET assignments using named parameters, e.g. `name = :name`. A constant string. */
  readonly set: string;
  readonly params?: Record<string, SQLInputValue>;
  /** An extra WHERE condition on the current state, and the message if it doesn't hold. */
  readonly guard?: { readonly sql: string; readonly refusal: string };
  readonly now: Date;
}

/**
 * Optimistic concurrency: applies `set` only if the record still has `expectedRevision` (and
 * passes `guard`), bumping `revision` and `updated_at`. It is one UPDATE statement, so it is
 * atomic without opening a transaction; that lets callers group it with other writes in their
 * own transaction. If nothing changed, a follow-up read explains why, and nothing is written:
 * `not_found`, `revision_conflict` (with the current revision) or `invalid_transition`.
 */
export function guardedUpdate(db: Database, update: GuardedUpdate): Row {
  assertRevision(update.expectedRevision);
  const guard = update.guard === undefined ? '' : ` AND (${update.guard.sql})`;
  const row = db
    .prepare(
      `UPDATE ${update.table}
       SET ${update.set}, updated_at = :updated_at, revision = revision + 1
       WHERE ${update.keyColumn} = :key AND revision = :expected_revision${guard}
       RETURNING *`,
    )
    .get({
      ...update.params,
      key: update.key,
      expected_revision: update.expectedRevision,
      updated_at: update.now.toISOString(),
    });
  if (row !== undefined) return row;

  const current = db
    .prepare(`SELECT revision FROM ${update.table} WHERE ${update.keyColumn} = ?`)
    .get(update.key);
  if (current === undefined) {
    throw new RepositoryError('not_found', `No ${update.table} record with that ID.`);
  }
  const currentRevision = integer(current, 'revision');
  if (currentRevision !== update.expectedRevision) {
    throw new RepositoryError(
      'revision_conflict',
      `The record changed since it was read (revision ${String(currentRevision)}, ` +
        `expected ${String(update.expectedRevision)}). Reload it and try again.`,
      currentRevision,
    );
  }
  throw new RepositoryError('invalid_transition', update.guard?.refusal ?? 'Update refused.');
}

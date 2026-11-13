// Repository for `profile_settings`: the only code that reads or writes that table.
// Each profile has its own database (ADR-0014), so this normally holds one row, keyed by the
// profile's local ID (`default` or a UUID). Every change takes the revision the caller last
// read; see guardedUpdate.
import type { Database, SQLInputValue } from '../database';
import { PROFILE_ID_PATTERN } from '../profiles/profile-id';
import {
  assertSlug,
  canonicalTimezone,
  charCount,
  guardedUpdate,
  integer,
  LIMITS,
  normalizeName,
  nullableText,
  RepositoryError,
  type Row,
  text,
} from './repository-support';

/** Bounded, validated configuration (DATA_MODEL §9.2). The shape grows with later milestones. */
export type ProfilePreferences = Readonly<Record<string, unknown>>;

export interface ProfileSettings {
  readonly profileId: string;
  readonly displayName: string;
  /** null until the user picks an avatar (the avatar step can be skipped). */
  readonly avatarPreset: string | null;
  readonly avatarColour: string | null;
  readonly timezone: string;
  readonly preferences: ProfilePreferences;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface NewProfileSettings {
  readonly profileId: string;
  readonly displayName: string;
  readonly timezone: string;
  readonly avatarPreset?: string | null;
  readonly avatarColour?: string | null;
  readonly preferences?: ProfilePreferences;
}

/** Fields to change. Omitted fields stay as they are; `null` clears an avatar field. */
export interface ProfileSettingsPatch {
  readonly displayName?: string;
  readonly avatarPreset?: string | null;
  readonly avatarColour?: string | null;
  readonly timezone?: string;
  readonly preferences?: ProfilePreferences;
}

const PROFILE_ID = PROFILE_ID_PATTERN;
const COLOUR = /^#[0-9a-f]{6}$/;

function assertProfileId(value: string): string {
  if (!PROFILE_ID.test(value)) {
    throw new RepositoryError('invalid_input', 'Profile ID must be "default" or a lowercase UUID.');
  }
  return value;
}

function avatarPreset(value: string | null): string | null {
  return value === null ? null : assertSlug(value, 'Avatar preset');
}

function avatarColour(value: string | null): string | null {
  if (value !== null && !COLOUR.test(value)) {
    throw new RepositoryError('invalid_input', 'Avatar colour must look like #a1b2c3.');
  }
  return value;
}

/** Deeper than this is refused (SQLite's own JSON limit is 1000, which gives a raw error). */
const PREFERENCES_MAX_DEPTH = 32;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * True if `value` is plain JSON data (null, boolean, finite number, string, array, plain
 * object) no deeper than `depthLeft`. Anything else (Date, Map, BigInt, undefined, NaN, a
 * class instance) would be silently changed or refused by JSON.stringify, so it is refused
 * here instead. The depth cap also stops circular references.
 */
function isJsonData(value: unknown, depthLeft: number): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depthLeft === 0) return false;
  if (Array.isArray(value)) return value.every((item) => isJsonData(item, depthLeft - 1));
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((item) => isJsonData(item, depthLeft - 1));
}

function preferencesJson(value: ProfilePreferences): string {
  // Checked at run time too: callers may pass values that don't match the type.
  if (!isPlainObject(value) || !isJsonData(value, PREFERENCES_MAX_DEPTH)) {
    throw new RepositoryError(
      'invalid_input',
      `Preferences must be a JSON object of plain data, nested at most ` +
        `${String(PREFERENCES_MAX_DEPTH)} levels.`,
    );
  }
  const json = JSON.stringify(value);
  if (charCount(json) > LIMITS.preferencesMaxChars) {
    throw new RepositoryError(
      'invalid_input',
      `Preferences are larger than ${String(LIMITS.preferencesMaxChars)} characters.`,
    );
  }
  return json;
}

function toProfileSettings(row: Row): ProfileSettings {
  return {
    profileId: text(row, 'profile_id'),
    displayName: text(row, 'display_name'),
    avatarPreset: nullableText(row, 'avatar_preset'),
    avatarColour: nullableText(row, 'avatar_colour'),
    timezone: text(row, 'timezone'),
    preferences: JSON.parse(text(row, 'preferences_json')) as ProfilePreferences,
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: integer(row, 'revision'),
  };
}

export class ProfileSettingsRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(input: NewProfileSettings): ProfileSettings {
    const profileId = assertProfileId(input.profileId);
    const values = [
      profileId,
      normalizeName(input.displayName, 'Display name'),
      avatarPreset(input.avatarPreset ?? null),
      avatarColour(input.avatarColour ?? null),
      canonicalTimezone(input.timezone),
      preferencesJson(input.preferences ?? {}),
    ];
    const at = this.now().toISOString();
    // One statement, so no other connection can slip a row in between a check and the insert:
    // an existing row means nothing is inserted and nothing is returned.
    const row = this.db
      .prepare(
        `INSERT INTO profile_settings (profile_id, display_name, avatar_preset, avatar_colour,
                                       timezone, preferences_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (profile_id) DO NOTHING
         RETURNING *`,
      )
      .get(...values, at, at);
    if (row === undefined) {
      throw new RepositoryError('already_exists', 'Settings for this profile already exist.');
    }
    return toProfileSettings(row);
  }

  get(profileId: string): ProfileSettings | undefined {
    const row = this.db
      .prepare('SELECT * FROM profile_settings WHERE profile_id = ?')
      .get(profileId);
    return row === undefined ? undefined : toProfileSettings(row);
  }

  update(
    profileId: string,
    expectedRevision: number,
    patch: ProfileSettingsPatch,
  ): ProfileSettings {
    // Column names come from this fixed list, never from the caller.
    const assignments: string[] = [];
    const params: Record<string, SQLInputValue> = {};
    const assign = (column: string, value: SQLInputValue): void => {
      assignments.push(`${column} = :${column}`);
      params[column] = value;
    };
    if (patch.displayName !== undefined) {
      assign('display_name', normalizeName(patch.displayName, 'Display name'));
    }
    if (patch.avatarPreset !== undefined) assign('avatar_preset', avatarPreset(patch.avatarPreset));
    if (patch.avatarColour !== undefined) assign('avatar_colour', avatarColour(patch.avatarColour));
    if (patch.timezone !== undefined) assign('timezone', canonicalTimezone(patch.timezone));
    if (patch.preferences !== undefined) {
      assign('preferences_json', preferencesJson(patch.preferences));
    }
    if (assignments.length === 0) {
      throw new RepositoryError('invalid_input', 'Nothing to update.');
    }

    return toProfileSettings(
      guardedUpdate(this.db, {
        table: 'profile_settings',
        keyColumn: 'profile_id',
        key: profileId,
        expectedRevision,
        set: assignments.join(', '),
        params,
        now: this.now(),
      }),
    );
  }
}

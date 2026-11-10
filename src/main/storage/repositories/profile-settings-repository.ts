// Repository for `profile_settings`: the only code that reads or writes that table.
// Each profile has its own database (ADR-0014), so this normally holds one row, keyed by the
// profile's local ID (`default` or a UUID). Every change takes the revision the caller last
// read; see guardedUpdate.
import type { Database, SQLInputValue } from '../database';
import {
  assertSlug,
  assertTimezone,
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

const PROFILE_ID = /^(?:default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
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

function preferencesJson(value: ProfilePreferences): string {
  // Checked at run time too: callers may pass parsed JSON that doesn't match the type.
  if (typeof value !== 'object' || (value as unknown) === null || Array.isArray(value)) {
    throw new RepositoryError('invalid_input', 'Preferences must be a JSON object.');
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
      assertTimezone(input.timezone),
      preferencesJson(input.preferences ?? {}),
    ];
    if (this.get(profileId) !== undefined) {
      throw new RepositoryError('already_exists', 'Settings for this profile already exist.');
    }
    const at = this.now().toISOString();
    const row = this.db
      .prepare(
        `INSERT INTO profile_settings (profile_id, display_name, avatar_preset, avatar_colour,
                                       timezone, preferences_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .get(...values, at, at);
    if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');
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
    if (patch.timezone !== undefined) assign('timezone', assertTimezone(patch.timezone));
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

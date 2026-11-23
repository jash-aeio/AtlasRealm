// IPC contracts for profiles and profile settings (M1-6 #33, ARCHITECTURE §16.1).
//
// Every command works on the **active** profile only. The renderer never names a profile
// folder; profile IDs it receives are for display and later switching (M1-8), and the main
// process validates any ID it is sent. `profile.switch` (M1-8 #35) changes which profile is
// active and then reloads the window. Avatar setup is optional: a profile is fully usable
// with the defaults (no avatar, the system timezone).
import { z } from 'zod';

import { AtlasViewChange, AtlasViews } from '../preferences/atlas-view';
import { ComfortPatch, ComfortPreferences } from '../preferences/comfort';
import { WorldId } from './world';
import { DisplayName, Revision, Timestamp } from './display-name';

/** At most this many local profiles, so `profile.list` stays bounded without paging. */
export const MAX_PROFILES = 50;

/** `default` (adopted from M0) or a lowercase UUID. Same rule as the main-process validator. */
export const ProfileIdText = z
  .string()
  .regex(/^(?:default|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/);

/**
 * Bundled avatar presets. The art bible plans one user avatar (ART_BIBLE §34.4), so
 * there is one preset and the colour personalises it. New presets extend this list.
 */
export const AvatarPreset = z.enum(['default']);
export type AvatarPreset = z.infer<typeof AvatarPreset>;

/** Lowercase hex colour such as `#3a7bd5`. */
export const AvatarColour = z.string().regex(/^#[0-9a-f]{6}$/);

/**
 * An IANA timezone ID such as `Europe/Amsterdam`. Only the shape is checked here; the main
 * process checks the zone exists and stores its canonical spelling.
 */
export const TimezoneId = z
  .string()
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+\-/]*$/);

export const ProfileSummary = z.strictObject({
  id: ProfileIdText,
  displayName: DisplayName,
  isActive: z.boolean(),
});
export type ProfileSummary = z.infer<typeof ProfileSummary>;

export const ProfileSettings = z.strictObject({
  profileId: ProfileIdText,
  displayName: DisplayName,
  /** null until the user picks one (the avatar step can be skipped). */
  avatarPreset: AvatarPreset.nullable(),
  avatarColour: AvatarColour.nullable(),
  timezone: TimezoneId,
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: Revision,
});
export type ProfileSettings = z.infer<typeof ProfileSettings>;

// ---- profile.list ----------------------------------------------------------------------

export const ProfileListInput = z.undefined();
export type ProfileListInput = z.infer<typeof ProfileListInput>;

export const ProfileListOutput = z.strictObject({
  profiles: z.array(ProfileSummary).min(1).max(MAX_PROFILES),
  activeProfileId: ProfileIdText,
});
export type ProfileListOutput = z.infer<typeof ProfileListOutput>;

// ---- profile.create --------------------------------------------------------------------

/** Creates a profile with default settings. It does not switch to it (`profile.switch` does). */
export const ProfileCreateInput = z.strictObject({ displayName: DisplayName });
export type ProfileCreateInput = z.infer<typeof ProfileCreateInput>;

export const ProfileCreateOutput = z.strictObject({ profile: ProfileSummary });
export type ProfileCreateOutput = z.infer<typeof ProfileCreateOutput>;

// ---- profile.rename --------------------------------------------------------------------

/** Renames the active profile (ADR-0019): the picker list and its settings change together. */
export const ProfileRenameInput = z.strictObject({
  displayName: DisplayName,
  expectedRevision: Revision,
});
export type ProfileRenameInput = z.infer<typeof ProfileRenameInput>;

export const ProfileSettingsOutput = z.strictObject({ settings: ProfileSettings });
export type ProfileSettingsOutput = z.infer<typeof ProfileSettingsOutput>;

// ---- profile.settings.get / profile.settings.update -------------------------------------

export const ProfileSettingsGetInput = z.undefined();
export type ProfileSettingsGetInput = z.infer<typeof ProfileSettingsGetInput>;

/**
 * Omitted fields stay as they are; `null` clears an avatar field. At least one field must be
 * given. The display name changes only through `profile.rename`.
 */
export const ProfileSettingsUpdateInput = z
  .strictObject({
    expectedRevision: Revision,
    avatarPreset: AvatarPreset.nullable().optional(),
    avatarColour: AvatarColour.nullable().optional(),
    timezone: TimezoneId.optional(),
  })
  .refine(
    (input) =>
      input.avatarPreset !== undefined ||
      input.avatarColour !== undefined ||
      input.timezone !== undefined,
    'nothing to update',
  );
export type ProfileSettingsUpdateInput = z.infer<typeof ProfileSettingsUpdateInput>;

// ---- profile.switch --------------------------------------------------------------------

/**
 * Makes another listed profile the active one (ADR-0014, ADR-0021). On success the main process
 * replies, then reloads the window, so no renderer state from the old profile survives. If the
 * target can't be opened, the reply is `profile_unavailable` and the current profile stays
 * active. Commands sent while the switch runs are refused with `profile_switching`.
 */
export const ProfileSwitchInput = z.strictObject({ profileId: ProfileIdText });
export type ProfileSwitchInput = z.infer<typeof ProfileSwitchInput>;

export const ProfileSwitchOutput = z.strictObject({
  activeProfileId: ProfileIdText,
  /** Always true: the window reloads right after this reply. */
  reloading: z.literal(true),
});
export type ProfileSwitchOutput = z.infer<typeof ProfileSwitchOutput>;

// ---- profile.preferences.get / profile.preferences.update -------------------------------

/**
 * Comfort preferences of the active profile (M2-14 #79, ADR-0028). Unlike the settings above,
 * an update takes no revision and doesn't bump the settings revision: each change is merged
 * into the stored preferences and the last write wins. They are cosmetic, and the camera is
 * saved often, so a revision would only make the avatar and name forms report conflicts.
 */
export const ProfilePreferencesGetInput = z.undefined();
export type ProfilePreferencesGetInput = z.infer<typeof ProfilePreferencesGetInput>;

export const ProfilePreferencesUpdateInput = ComfortPatch;
export type ProfilePreferencesUpdateInput = z.infer<typeof ProfilePreferencesUpdateInput>;

export const ProfilePreferencesOutput = z.strictObject({ preferences: ComfortPreferences });
export type ProfilePreferencesOutput = z.infer<typeof ProfilePreferencesOutput>;

// ---- profile.atlasView.get / profile.atlasView.update -----------------------------------

/**
 * Realm Atlas display preferences of the active profile, per world (M2-12 #77, ADR-0031).
 * Stored next to the comfort preferences and handled the same way: no revision, each change is
 * merged and the last write wins. A pinned project ID is only a display choice; nothing reads
 * it to decide access.
 */
export const ProfileAtlasViewGetInput = z.undefined();
export type ProfileAtlasViewGetInput = z.infer<typeof ProfileAtlasViewGetInput>;

export const ProfileAtlasViewUpdateInput = z.strictObject({
  worldId: WorldId,
  change: AtlasViewChange,
});
export type ProfileAtlasViewUpdateInput = z.infer<typeof ProfileAtlasViewUpdateInput>;

export const ProfileAtlasViewOutput = z.strictObject({ views: AtlasViews });
export type ProfileAtlasViewOutput = z.infer<typeof ProfileAtlasViewOutput>;

// Application service for profiles and profile settings (M1-6 #33). The IPC handlers call
// this; it combines the profiles index (one file for all profiles) with the active profile's
// `profile_settings` row (inside that profile's own database).
//
// The display name is stored in both places: the index, so the picker can list profiles
// without opening every database, and the settings row. Only the active profile can be
// renamed, and both copies change together (ADR-0019).
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import { MAX_PROFILES } from '../../common/contracts/profile';
import { CommandError } from '../ipc/router';
import { createProfileDatabase, profilePaths } from '../storage/app-database';
import type { Database } from '../storage/database';
import { newProfileId, type ProfileId } from '../storage/profiles/profile-id';
import {
  type ProfileEntry,
  type ProfilesIndex,
  readProfilesIndex,
  writeProfilesIndex,
} from '../storage/profiles/profiles-index';
import {
  type ProfileSettings,
  ProfileSettingsRepository,
  type ProfileSettingsPatch,
} from '../storage/repositories/profile-settings-repository';
import { canonicalTimezone } from '../storage/repositories/repository-support';
import type { ActiveProfile } from './active-profile';

export interface ProfileListing {
  readonly profiles: readonly (ProfileEntry & { readonly isActive: boolean })[];
  readonly activeProfileId: ProfileId;
}

/** The system's IANA timezone in canonical spelling, or `UTC` if it can't be determined. */
export function systemTimezone(): string {
  try {
    return canonicalTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return 'UTC';
  }
}

/**
 * Makes sure the profile has a settings row whose name matches the index (run at startup,
 * ADR-0019). A missing row is created with defaults: no avatar, the system timezone. A name
 * that differs from the index (a rename interrupted between its two writes) is repaired from
 * the index, which is what the picker showed.
 */
export function ensureProfileSettings(
  db: Database,
  profileId: ProfileId,
  displayName: string,
  now: () => Date = () => new Date(),
): ProfileSettings {
  const repository = new ProfileSettingsRepository(db, now);
  const existing = repository.get(profileId);
  if (existing === undefined) {
    return repository.create({ profileId, displayName, timezone: systemTimezone() });
  }
  if (existing.displayName === displayName) return existing;
  return repository.update(profileId, existing.revision, { displayName });
}

/** Names are not keys, but two profiles that look the same in the picker are confusing. */
// NFC first: "é" can be one code point or "e" plus a combining accent, and both look the same.
function sameName(a: string, b: string): boolean {
  const key = (name: string) => name.normalize('NFC').toLocaleLowerCase('en');
  return key(a) === key(b);
}

function duplicateName(): CommandError {
  return new CommandError('already_exists', 'A profile with that name already exists.');
}

export class ProfileService {
  // Index writes are async (temp file, flush, rename). This chain runs one profile change at a
  // time, so two changes can't both read the old index and the second silently undo the first.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly active: ActiveProfile,
    private readonly now: () => Date = () => new Date(),
    private readonly newId: () => ProfileId = newProfileId,
  ) {}

  list(): ProfileListing {
    const { profileId } = this.active.current();
    return {
      profiles: this.readIndex().profiles.map((entry) => ({
        ...entry,
        isActive: entry.id === profileId,
      })),
      activeProfileId: profileId,
    };
  }

  /**
   * Creates a profile folder, its migrated database with default settings, and its index
   * entry. It does not switch to the new profile (that is M1-8). If the index can't be written,
   * the folder this call just created is removed again, so no half-made profile is left.
   */
  create(displayName: string): Promise<ProfileEntry> {
    return this.exclusive(async () => {
      const index = this.readIndex();
      if (index.profiles.length >= MAX_PROFILES) {
        throw new CommandError(
          'limit_reached',
          `There are already ${String(MAX_PROFILES)} profiles.`,
        );
      }
      if (index.profiles.some((entry) => sameName(entry.displayName, displayName))) {
        throw duplicateName();
      }

      const userDataDir = this.active.userDataDir;
      const profileId = this.newId();
      const entry: ProfileEntry = { id: profileId, displayName };
      // Claim the folder first: a non-recursive mkdir fails with EEXIST if it is already there,
      // before any cleanup is armed. So the cleanup below can only ever remove a folder this
      // call created itself, never existing data (#33 security L1).
      const { profileDir } = profilePaths(userDataDir, profileId);
      await mkdir(dirname(profileDir), { recursive: true });
      await mkdir(profileDir);
      try {
        const db = await createProfileDatabase(userDataDir, profileId);
        try {
          new ProfileSettingsRepository(db, this.now).create({
            profileId,
            displayName,
            timezone: systemTimezone(),
          });
        } finally {
          db.close();
        }
        await writeProfilesIndex(userDataDir, { ...index, profiles: [...index.profiles, entry] });
      } catch (error) {
        await rm(profileDir, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
        throw error;
      }
      return entry;
    });
  }

  /**
   * Renames the active profile. Order: check the revision, write the index, update the
   * settings row. If the row update fails (for example someone changed the settings while the
   * index was being written), the old index is written back. A crash between the two writes is
   * repaired at the next start by ensureProfileSettings.
   */
  rename(displayName: string, expectedRevision: number): Promise<ProfileSettings> {
    return this.exclusive(async () => {
      const { profileId, db } = this.active.current();
      const repository = new ProfileSettingsRepository(db, this.now);
      const current = this.settingsOf(repository, profileId);
      if (current.revision !== expectedRevision) {
        throw new CommandError(
          'revision_conflict',
          'This profile changed since it was loaded. Reload it and try again.',
          current.revision,
        );
      }
      const index = this.readIndex();
      const others = index.profiles.filter((entry) => entry.id !== profileId);
      if (others.some((entry) => sameName(entry.displayName, displayName))) throw duplicateName();

      const renamed: ProfilesIndex = {
        ...index,
        profiles: index.profiles.map((entry) =>
          entry.id === profileId ? { ...entry, displayName } : entry,
        ),
      };
      await writeProfilesIndex(this.active.userDataDir, renamed);
      try {
        return repository.update(profileId, expectedRevision, { displayName });
      } catch (error) {
        await writeProfilesIndex(this.active.userDataDir, index).catch((rollbackError: unknown) => {
          // Startup repairs the settings name from the index, so this is not data loss.
          console.error(
            '[profiles] could not restore the index after a failed rename',
            rollbackError,
          );
        });
        throw error;
      }
    });
  }

  getSettings(): ProfileSettings {
    const { profileId, db } = this.active.current();
    return this.settingsOf(new ProfileSettingsRepository(db, this.now), profileId);
  }

  updateSettings(
    expectedRevision: number,
    patch: Pick<ProfileSettingsPatch, 'avatarPreset' | 'avatarColour' | 'timezone'>,
  ): ProfileSettings {
    const { profileId, db } = this.active.current();
    return new ProfileSettingsRepository(db, this.now).update(profileId, expectedRevision, patch);
  }

  private settingsOf(repository: ProfileSettingsRepository, profileId: ProfileId): ProfileSettings {
    const settings = repository.get(profileId);
    // Startup creates the row (ensureProfileSettings), so this is a bug, not a user error.
    if (settings === undefined) throw new Error('The active profile has no settings row.');
    return settings;
  }

  private readIndex(): ProfilesIndex {
    const read = readProfilesIndex(this.active.userDataDir);
    // Startup wrote or read the index, so a missing one means it was deleted while running.
    if (read.kind === 'missing') throw new Error('The profiles index is missing.');
    return read.index;
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

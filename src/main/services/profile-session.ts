// Switches the active profile (M1-8 #35, ARCHITECTURE §7.4, ADR-0014, ADR-0021).
//
// Order, chosen so a failure can never leave the app without a working profile:
//   1. close the gate: every command is refused with `profile_switching` from here on
//   2. open the target's database (migrations + pre-migration backup) next to the current one
//      and make sure it has a settings row. If anything here fails, the target is closed again
//      and the current profile stays active, untouched: no fallback to an empty database
//   3. record the target as last used in profiles-index.json (atomic write)
//   4. pause the worker: its pending requests fail with `worker_stopped`, never retried
//   5. close the old database and put the new one in place
//   6. start a fresh worker for the new profile
//   7. reply, then reload the window so no renderer state from the old profile survives. The
//      gate opens again only once the old page is gone (or the reload gave up)
import { existsSync } from 'node:fs';

import { CommandError } from '../ipc/router';
import { type ActiveProfile, profileSwitchingError } from '../profiles/active-profile';
import { ensureProfileSettings } from '../profiles/profile-service';
import {
  type AppDatabase,
  openAppDatabase,
  ProfileDataMissingError,
  profilePaths,
} from '../storage/app-database';
import type { ProfileId } from '../storage/profiles/profile-id';
import { readProfilesIndex, writeProfilesIndex } from '../storage/profiles/profiles-index';

/** The part of the worker bridge a switch needs. */
export interface SwitchableWorker {
  pause(): void;
  resume(): void;
}

export interface ProfileSessionOptions {
  readonly active: ActiveProfile;
  readonly worker: SwitchableWorker;
  /**
   * Reloads the window. Resolves once the old page has been replaced (or the reload gave up).
   * Called after the switch's reply has been sent.
   */
  readonly reloadRenderer: () => Promise<void>;
  /** Opens and migrates a profile's database. Tests replace it to slow down or fail an open. */
  readonly openProfile?: (userDataDir: string, profileId: ProfileId) => Promise<AppDatabase>;
}

function unavailable(): CommandError {
  return new CommandError(
    'profile_unavailable',
    'That profile could not be opened. Your current profile is still active, and nothing was deleted.',
  );
}

async function openExistingProfile(
  userDataDir: string,
  profileId: ProfileId,
): Promise<AppDatabase> {
  // Checked first so a missing file usually isn't even created; requireExisting covers the
  // file vanishing between this check and the open (same rule as startup).
  if (!existsSync(profilePaths(userDataDir, profileId).databaseFile)) {
    throw new ProfileDataMissingError();
  }
  return openAppDatabase(userDataDir, profileId, { requireExisting: true });
}

export class ProfileSession {
  readonly #active: ActiveProfile;
  readonly #worker: SwitchableWorker;
  readonly #reloadRenderer: () => Promise<void>;
  readonly #openProfile: (userDataDir: string, profileId: ProfileId) => Promise<AppDatabase>;

  constructor(options: ProfileSessionOptions) {
    this.#active = options.active;
    this.#worker = options.worker;
    this.#reloadRenderer = options.reloadRenderer;
    this.#openProfile = options.openProfile ?? openExistingProfile;
  }

  /**
   * Makes `target` the active profile. Resolves once the new profile is in place; the window
   * reload (and the end of the gate) follows on its own right after.
   */
  async switchTo(target: ProfileId): Promise<{ readonly profileId: ProfileId }> {
    if (!this.#active.beginSwitch()) throw profileSwitchingError();
    try {
      // Same queue as profile.create and profile.rename, so index writes never overlap.
      await this.#active.exclusive(() => this.#swap(target));
    } catch (error) {
      this.#active.endSwitch();
      throw error;
    }
    // After the reply: setImmediate runs once the handler's promise has settled and the
    // router has handed the reply back to Electron.
    setImmediate(() => {
      void this.#reloadAndOpenGate();
    });
    return { profileId: target };
  }

  async #swap(target: ProfileId): Promise<void> {
    const userDataDir = this.#active.userDataDir;
    const current = this.#active.stateDuringSwitch();
    if (target === current.profileId) {
      throw new CommandError('invalid_transition', 'That profile is already active.');
    }
    const read = readProfilesIndex(userDataDir);
    // Startup wrote or read the index, so a missing one means it was deleted while running.
    if (read.kind === 'missing') throw new Error('The profiles index is missing.');
    const entry = read.index.profiles.find((profile) => profile.id === target);
    if (entry === undefined) throw new CommandError('not_found', 'No such profile.');

    let opened: AppDatabase;
    try {
      opened = await this.#openProfile(userDataDir, target);
    } catch (error) {
      // Details (which may include paths) go to the local log only.
      console.error(
        '[profiles] could not open the target profile; staying on the current one',
        error,
      );
      throw unavailable();
    }
    try {
      ensureProfileSettings(opened.db, target, entry.displayName);
      await writeProfilesIndex(userDataDir, { ...read.index, lastUsedProfileId: target });
    } catch (error) {
      opened.db.close();
      console.error('[profiles] could not finish opening the target profile', error);
      throw unavailable();
    }

    // From here on nothing can fail back to the old profile: it is being closed.
    this.#worker.pause();
    try {
      current.db.close();
    } catch (error) {
      // The old handle is unusable either way. SQLite's WAL keeps its committed data safe.
      console.error('[profiles] closing the previous profile database failed', error);
    }
    this.#active.replace({ profileId: target, db: opened.db });
    try {
      this.#worker.resume();
    } catch (error) {
      // Like at startup: the next worker request tries again and reports the error.
      console.error('[runtime] could not start the worker for the new profile', error);
    }
    console.info(
      `[profiles] switched to profile ${target}, schema v${String(opened.migration.toVersion)}, ` +
        `launch #${String(opened.launch.launchCount)}`,
    );
  }

  async #reloadAndOpenGate(): Promise<void> {
    try {
      await this.#reloadRenderer();
    } catch (error) {
      console.error('[profiles] reloading the window after a profile switch failed', error);
    } finally {
      this.#active.endSwitch();
    }
  }
}

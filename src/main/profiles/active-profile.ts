// Which profile is open right now. Command handlers ask this holder for the current profile
// on every call instead of keeping a database handle of their own, so profile switching
// (M1-8 #35) only has to swap what this holds and every command follows.
//
// While a switch is under way, current() refuses with `profile_switching` (ADR-0014): a
// command must never run against a profile that is being closed or one that isn't fully open.
import type { z } from 'zod';

import { CommandError, type CommandHandler } from '../ipc/router';
import type { Database } from '../storage/database';
import type { ProfileId } from '../storage/profiles/profile-id';

export interface ActiveProfileState {
  readonly profileId: ProfileId;
  readonly db: Database;
}

export function profileSwitchingError(): CommandError {
  return new CommandError(
    'profile_switching',
    'The app is switching profiles. Try again once it has reloaded.',
  );
}

/**
 * Wraps a command handler so it is refused with `profile_switching` while a switch is under
 * way. registerIpcHandlers wraps every command with it, including ones that never touch the
 * profile: the window reloads right after a switch, and a plain refusal is easier to reason
 * about than a mix of answers from two profiles (ADR-0014).
 */
export function refuseWhileSwitching<I extends z.ZodType, O extends z.ZodType>(
  active: ActiveProfile,
  handler: CommandHandler<I, O>,
): CommandHandler<I, O> {
  return (input) => {
    if (active.isSwitching) throw profileSwitchingError();
    return handler(input);
  };
}

export class ActiveProfile {
  #state: ActiveProfileState;
  #switching = false;
  /** The target database while a switch opens it, so a quit in the middle can close it too. */
  #opening: Database | undefined;
  // Index writes are async (temp file, flush, rename). This chain runs one profile change at a
  // time (create, rename, switch), so two changes can't both read the old index and the second
  // silently undo the first.
  #queue: Promise<unknown> = Promise.resolve();

  constructor(
    /** The app's data folder (holds profiles-index.json and profiles/). */
    readonly userDataDir: string,
    state: ActiveProfileState,
  ) {
    this.#state = state;
  }

  /** The open profile. Throws `profile_switching` while a switch is under way. */
  current(): ActiveProfileState {
    if (this.#switching) throw profileSwitchingError();
    return this.#state;
  }

  get isSwitching(): boolean {
    return this.#switching;
  }

  /**
   * Starts a switch: from now on current() refuses. Returns false if one is already running.
   * Only ProfileSession calls this, and it always calls endSwitch() afterwards.
   */
  beginSwitch(): boolean {
    if (this.#switching) return false;
    this.#switching = true;
    return true;
  }

  /** The state during a switch, for the switch itself. Never for command handlers. */
  stateDuringSwitch(): ActiveProfileState {
    if (!this.#switching) throw new Error('No profile switch is under way.');
    return this.#state;
  }

  /** Puts the newly opened profile in place. Only valid during a switch. */
  replace(state: ActiveProfileState): void {
    if (!this.#switching) throw new Error('No profile switch is under way.');
    this.#state = state;
  }

  /** Records (or clears) the target database a switch has opened but not yet put in place. */
  trackOpening(db: Database | undefined): void {
    this.#opening = db;
  }

  endSwitch(): void {
    this.#switching = false;
    this.#opening = undefined;
  }

  /** Every database to close at quit time, including one a switch is still opening. */
  databasesForShutdown(): Database[] {
    return this.#opening === undefined || this.#opening === this.#state.db
      ? [this.#state.db]
      : [this.#state.db, this.#opening];
  }

  /** Runs one profile change at a time (see #queue). A failed change doesn't block the next. */
  exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(work, work);
    this.#queue = run.catch(() => undefined);
    return run;
  }
}

// Which profile is open right now. Command handlers ask this holder for the current profile
// on every call instead of keeping a database handle of their own, so profile switching
// (M1-8 #35) only has to swap what this holds and every command follows.
import type { Database } from '../storage/database';
import type { ProfileId } from '../storage/profiles/profile-id';

export interface ActiveProfileState {
  readonly profileId: ProfileId;
  readonly db: Database;
}

export class ActiveProfile {
  constructor(
    /** The app's data folder (holds profiles-index.json and profiles/). */
    readonly userDataDir: string,
    // Readonly until M1-8 adds the switch that replaces it.
    private readonly state: ActiveProfileState,
  ) {}

  current(): ActiveProfileState {
    return this.state;
  }
}

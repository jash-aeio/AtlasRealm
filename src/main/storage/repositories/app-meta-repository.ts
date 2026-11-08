// Repository for `app_meta`: the only code that reads or writes that table. Callers get
// typed methods instead of SQL, so the schema can change without touching them.
import { type Database, withTransaction } from '../database';

/** Known keys. A closed list keeps the table from becoming a junk drawer. */
export type AppMetaKey = 'first_launched_at' | 'last_launched_at' | 'launch_count';

export interface AppLaunchRecord {
  readonly launchCount: number;
  readonly firstLaunchedAt: string;
  readonly lastLaunchedAt: string;
}

export class AppMetaRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(key: AppMetaKey): string | undefined {
    const row = this.db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key);
    return row === undefined ? undefined : String(row['value']);
  }

  /** Inserts or updates `key`, bumping `updated_at` and `revision` on update. */
  set(key: AppMetaKey, value: string): void {
    const at = this.now().toISOString();
    this.db
      .prepare(
        `INSERT INTO app_meta (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at,
           revision = revision + 1`,
      )
      .run(key, value, at, at);
  }

  /** Counts this app start. Reads and writes in one transaction, so no launch is lost. */
  recordLaunch(): AppLaunchRecord {
    return withTransaction(this.db, () => {
      const at = this.now().toISOString();
      const launchCount = Number(this.get('launch_count') ?? '0') + 1;
      const firstLaunchedAt = this.get('first_launched_at') ?? at;
      this.set('launch_count', String(launchCount));
      this.set('first_launched_at', firstLaunchedAt);
      this.set('last_launched_at', at);
      return { launchCount, firstLaunchedAt, lastLaunchedAt: at };
    });
  }
}

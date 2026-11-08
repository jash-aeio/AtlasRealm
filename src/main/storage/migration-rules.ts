// Rules every migration list must follow before the runner touches a database.
// Kept apart from the runner so the rules can be read (and tested) on their own.

/** One schema change. `up` is plain SQL; it runs inside a transaction the runner opens. */
export interface Migration {
  /** 1, 2, 3, ... Once released, a migration's version and SQL never change. */
  readonly version: number;
  /** Short snake_case description, recorded in `schema_migrations` for humans. */
  readonly name: string;
  readonly up: string;
}

/**
 * Throws if `migrations` is not exactly versions 1, 2, 3, ... in order.
 *
 * Why so strict? The database stores only the last applied version (`PRAGMA user_version`).
 * The runner applies every migration with a higher version, in list order. A gap, duplicate
 * or out-of-order entry would mean two installs of the same app version could end up with
 * different schemas, which is the bug migrations exist to prevent.
 */
export function assertMigrationsAreValid(migrations: readonly Migration[]): void {
  // One rule covers every failure: the migration at position `index` must be version
  // `index + 1`. That rules out gaps, duplicates, wrong order, a list not starting at 1 and
  // fractional versions. An empty list passes: a new app with no schema yet.
  migrations.forEach((migration, index) => {
    const expected = index + 1;
    if (migration.version !== expected) {
      throw new Error(
        `Migration "${migration.name}" has version ${String(migration.version)}, ` +
          `expected ${String(expected)} (versions must be 1, 2, 3, ... in order).`,
      );
    }
  });
}

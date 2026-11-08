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
  // TODO(you): implement the checks. Tests: tests/integration/storage-migration-rules.test.ts
  // (remove `.skip` there first, then run `corepack pnpm test storage-migration-rules`).
  //
  // Hints:
  // - Loop with the index: `migrations.forEach((migration, index) => { ... })`.
  //   The migration at `index` must have `version === index + 1`. That single rule already
  //   rules out gaps, duplicates, wrong order and a list that doesn't start at 1.
  // - Also reject a version that isn't a whole number (`Number.isInteger`).
  // - Throw an `Error` whose message names the offending migration (version and name), e.g.
  //   `Migration "add_x" has version 3, expected 2`. Future-you reads this message, not the code.
  // - An empty list is valid: a brand-new app with no schema yet.
  if (migrations.length === 0) return; // placeholder: replace with the real checks
}

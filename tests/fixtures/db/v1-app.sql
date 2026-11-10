-- Frozen snapshot of a schema v1 profile database, as v0.1.0-m0 leaves it after three
-- launches. Used by tests/integration/storage-migration-v2.test.ts to prove the v1 → v2
-- upgrade on a realistic file. Never regenerate this from the current migrations: its job is
-- to stay what real users have on disk. A test checks it still matches migration 1.

CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT    NOT NULL,
  applied_at TEXT    NOT NULL
) STRICT;

CREATE TABLE app_meta (
  key        TEXT    PRIMARY KEY,
  value      TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  updated_at TEXT    NOT NULL,
  revision   INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
) STRICT;

INSERT INTO schema_migrations (version, name, applied_at)
VALUES (1, 'create_app_meta', '2026-11-08T09:00:00.000Z');

INSERT INTO app_meta (key, value, created_at, updated_at, revision) VALUES
  ('launch_count',      '3',                        '2026-11-08T09:00:00.010Z', '2026-11-10T18:30:00.000Z', 3),
  ('first_launched_at', '2026-11-08T09:00:00.010Z', '2026-11-08T09:00:00.010Z', '2026-11-10T18:30:00.000Z', 3),
  ('last_launched_at',  '2026-11-10T18:30:00.000Z', '2026-11-08T09:00:00.010Z', '2026-11-10T18:30:00.000Z', 3);

PRAGMA user_version = 1;

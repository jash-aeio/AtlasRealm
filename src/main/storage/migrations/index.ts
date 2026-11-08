// The app's schema history, oldest first. Append new migrations; never edit or reorder a
// released one: users' databases already contain its result (see migration-rules.ts).
import type { Migration } from '../migration-rules';

const m0001AppMeta: Migration = {
  version: 1,
  name: 'create_app_meta',
  up: `
    -- Small app-level facts (e.g. first launch time). Not for product data: projects,
    -- runs and the rest get real tables with constraints (DATA_MODEL §9.3).
    CREATE TABLE app_meta (
      key        TEXT    PRIMARY KEY,
      value      TEXT    NOT NULL,
      created_at TEXT    NOT NULL,  -- UTC ISO-8601 instant
      updated_at TEXT    NOT NULL,  -- UTC ISO-8601 instant
      revision   INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
    ) STRICT;
  `,
};

export const MIGRATIONS: readonly Migration[] = [m0001AppMeta];

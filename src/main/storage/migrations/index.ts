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

// Spelled out in full (no shared SQL helpers) so a later refactor can't silently change the
// SQL of a released migration. Notes for reading the CHECKs:
//   - trim(x, char(9, 10, 13, 32)) strips tab, newline, carriage return and space; plain
//     trim(x) strips only spaces. A name must equal its trimmed self.
//   - length() counts characters (code points) for TEXT. The same limits live in
//     repositories/repository-support.ts, which checks them first with clearer errors.
//   - `x NOT GLOB '*[^a-z0-9-]*'` means "x contains no character outside a-z, 0-9 and -".
//   - UUID columns GLOB the exact 8-4-4-4-12 lowercase hex shape.
//   - length() stops at a NUL character, so text columns also require instr(x, char(0)) = 0.
const m0002ProfileWorldsProjects: Migration = {
  version: 2,
  name: 'create_profile_settings_worlds_projects',
  up: `
    -- Settings of a local profile. Each profile has its own database file (ADR-0014), so in
    -- practice this holds one row: the profile that owns the file.
    CREATE TABLE profile_settings (
      profile_id       TEXT    PRIMARY KEY CHECK (
                         profile_id = 'default' OR
                         profile_id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
      display_name     TEXT    NOT NULL CHECK (
                         length(display_name) BETWEEN 1 AND 80 AND instr(display_name, char(0)) = 0 AND
                         display_name = trim(display_name, char(9, 10, 13, 32))),
      avatar_preset    TEXT    CHECK (                 -- NULL: avatar step skipped
                         avatar_preset IS NULL OR
                         (length(avatar_preset) BETWEEN 1 AND 64 AND
                          avatar_preset NOT GLOB '*[^a-z0-9-]*')),
      avatar_colour    TEXT    CHECK (                 -- '#rrggbb', lowercase
                         avatar_colour IS NULL OR
                         (length(avatar_colour) = 7 AND
                          avatar_colour GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]')),
      timezone         TEXT    NOT NULL CHECK (    -- IANA ID, e.g. Europe/Amsterdam
                         length(timezone) BETWEEN 1 AND 64 AND timezone GLOB '[A-Za-z]*' AND
                         timezone NOT GLOB '*[^A-Za-z0-9_+/-]*' AND instr(timezone, '..') = 0),
      preferences_json TEXT    NOT NULL DEFAULT '{}' CHECK (
                         length(preferences_json) <= 16384 AND
                         json_valid(preferences_json) AND
                         json_type(preferences_json) = 'object'),
      created_at       TEXT    NOT NULL,  -- UTC ISO-8601 instant
      updated_at       TEXT    NOT NULL,  -- UTC ISO-8601 instant
      revision         INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
    ) STRICT;

    CREATE TABLE worlds (
      id          TEXT    PRIMARY KEY CHECK (
                    id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
      name        TEXT    NOT NULL CHECK (
                    length(name) BETWEEN 1 AND 80 AND instr(name, char(0)) = 0 AND
                    name = trim(name, char(9, 10, 13, 32))),
      theme_id    TEXT    NOT NULL CHECK (
                    length(theme_id) BETWEEN 1 AND 64 AND theme_id NOT GLOB '*[^a-z0-9-]*'),
      grid_width  INTEGER NOT NULL DEFAULT 64 CHECK (grid_width BETWEEN 16 AND 256),
      grid_height INTEGER NOT NULL DEFAULT 64 CHECK (grid_height BETWEEN 16 AND 256),
      archived_at TEXT,  -- UTC ISO-8601 instant; NULL while the world is in use
      created_at  TEXT    NOT NULL,
      updated_at  TEXT    NOT NULL,
      revision    INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
    ) STRICT;

    -- A project's identity is its id; the name can change freely (PRODUCT_RULES §3.1). Rows
    -- are not deleted in M1: archive and trash are status + timestamp changes (PRD §5.6).
    -- A world with projects can't be deleted (RESTRICT), so no project is ever orphaned.
    CREATE TABLE projects (
      id               TEXT    PRIMARY KEY CHECK (
                    id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
      world_id         TEXT    NOT NULL REFERENCES worlds (id) ON DELETE RESTRICT,
      name             TEXT    NOT NULL CHECK (
                         length(name) BETWEEN 1 AND 80 AND instr(name, char(0)) = 0 AND
                    name = trim(name, char(9, 10, 13, 32))),
      goal             TEXT    NOT NULL DEFAULT '' CHECK (
                         length(goal) <= 2000 AND instr(goal, char(0)) = 0 AND
                         goal = trim(goal, char(9, 10, 13, 32))),
      template_id      TEXT    NOT NULL CHECK (
                         length(template_id) BETWEEN 1 AND 64 AND
                         template_id NOT GLOB '*[^a-z0-9-]*'),
      template_version TEXT    NOT NULL CHECK (    -- semver, e.g. 1.0.0
                         length(template_version) BETWEEN 5 AND 32 AND
                         template_version NOT GLOB '*[^0-9a-z.+-]*'),
      status           TEXT    NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active', 'archived', 'trashed')),
      archived_at      TEXT,  -- kept while trashed, so restoring from trash knows where to go
      trashed_at       TEXT,
      created_at       TEXT    NOT NULL,
      updated_at       TEXT    NOT NULL,
      revision         INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      -- The status and the timestamps must tell the same story.
      CHECK (
        (status = 'active'   AND archived_at IS NULL     AND trashed_at IS NULL) OR
        (status = 'archived' AND archived_at IS NOT NULL AND trashed_at IS NULL) OR
        (status = 'trashed'  AND trashed_at IS NOT NULL)
      )
    ) STRICT;

    -- The main query path: a world's projects filtered by status (project list, M1-7).
    CREATE INDEX projects_by_world_status ON projects (world_id, status);
  `,
};

export const MIGRATIONS: readonly Migration[] = [m0001AppMeta, m0002ProfileWorldsProjects];

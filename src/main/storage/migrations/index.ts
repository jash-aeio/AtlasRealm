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

// Graph entities (GRAPH_MODEL §30.5): the stable node IDs the Realm Atlas and imports build on.
// An entity has its own UUID, never a name or a position; layout is cosmetic and gets its own
// table later (graph_view_states). Entities are tombstoned, not deleted.
// Adding kinds (file, note, ...) later means rebuilding this table, as SQLite can't alter a CHECK.
const m0003GraphEntities: Migration = {
  version: 3,
  name: 'create_graph_entities',
  up: `
    -- Lets graph_entities check that a project entity's world is the project's own world.
    CREATE UNIQUE INDEX projects_id_world ON projects (id, world_id);

    CREATE TABLE graph_entities (
      id             TEXT    PRIMARY KEY CHECK (
                       id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
      kind           TEXT    NOT NULL CHECK (kind IN ('world', 'project')),
      -- Scope: every entity lives in a world; project-level entities also name their project.
      world_id       TEXT    NOT NULL REFERENCES worlds (id) ON DELETE RESTRICT,
      project_id     TEXT,
      -- app_owned: the app created it. external: it mirrors something outside the app (an
      -- imported file, an Obsidian note) found at source_locator.
      ownership      TEXT    NOT NULL CHECK (ownership IN ('app_owned', 'external')),
      source_locator TEXT    CHECK (
                       source_locator IS NULL OR
                       (length(source_locator) BETWEEN 1 AND 1024 AND
                        instr(source_locator, char(0)) = 0)),
      tombstoned_at  TEXT,  -- UTC ISO-8601 instant; NULL while the entity is live
      created_at     TEXT    NOT NULL,
      updated_at     TEXT    NOT NULL,
      revision       INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      FOREIGN KEY (project_id, world_id) REFERENCES projects (id, world_id) ON DELETE RESTRICT,
      CHECK (
        (kind = 'world'   AND project_id IS NULL) OR
        (kind = 'project' AND project_id IS NOT NULL)
      ),
      CHECK (ownership = 'app_owned' OR source_locator IS NOT NULL)
    ) STRICT;

    -- One entity per world and per project, which is also how they are looked up.
    CREATE UNIQUE INDEX graph_entities_one_per_world
      ON graph_entities (world_id) WHERE kind = 'world';
    CREATE UNIQUE INDEX graph_entities_one_per_project
      ON graph_entities (project_id) WHERE kind = 'project';

    -- Backfill worlds and projects created under v2. randomblob() builds a version 4 UUID:
    -- the third group starts with 4 and the fourth with 8, 9, a or b. Trashed projects start
    -- tombstoned, from the moment they were trashed.
    INSERT INTO graph_entities (id, kind, world_id, project_id, ownership, created_at, updated_at)
    SELECT
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
        substr(lower(hex(randomblob(2))), 2) || '-' ||
        substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
        lower(hex(randomblob(6))),
      'world', id, NULL, 'app_owned', created_at, created_at
    FROM worlds;

    INSERT INTO graph_entities (id, kind, world_id, project_id, ownership, tombstoned_at,
                                created_at, updated_at)
    SELECT
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
        substr(lower(hex(randomblob(2))), 2) || '-' ||
        substr('89ab', 1 + (random() & 3), 1) || substr(lower(hex(randomblob(2))), 2) || '-' ||
        lower(hex(randomblob(6))),
      'project', world_id, id, 'app_owned', trashed_at, created_at, coalesce(trashed_at, created_at)
    FROM projects;
  `,
};

// Template IDs in the spec format (M1-7 #34, ADR-0020). v2 allowed only `a-z0-9-` (max 64), but
// template IDs are namespaced, e.g. `builtin.generic` (DATA_MODEL §10.1, TemplateId), so no
// project could be created from a bundled template. SQLite can't alter a CHECK, so `projects`
// is rebuilt. `graph_entities` references it and is rebuilt too, in an order that never leaves
// a dangling reference, so foreign keys stay on throughout:
//   copy graph rows aside → drop graph_entities → swap in the new projects → recreate
//   graph_entities (same definition as v3) → copy the rows back.
// Every column, value and index is kept; only the template_id rule changes.
const m0004TemplateIdNamespaces: Migration = {
  version: 4,
  name: 'allow_namespaced_template_ids',
  up: `
    CREATE TABLE projects_v4 (
      id               TEXT    PRIMARY KEY CHECK (
                    id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
      world_id         TEXT    NOT NULL REFERENCES worlds (id) ON DELETE RESTRICT,
      name             TEXT    NOT NULL CHECK (
                         length(name) BETWEEN 1 AND 80 AND instr(name, char(0)) = 0 AND
                    name = trim(name, char(9, 10, 13, 32))),
      goal             TEXT    NOT NULL DEFAULT '' CHECK (
                         length(goal) <= 2000 AND instr(goal, char(0)) = 0 AND
                         goal = trim(goal, char(9, 10, 13, 32))),
      -- Lowercase words joined by single "." or "-": builtin.generic, content-campaign.
      template_id      TEXT    NOT NULL CHECK (
                         length(template_id) BETWEEN 1 AND 100 AND
                         template_id NOT GLOB '*[^a-z0-9.-]*' AND
                         template_id NOT GLOB '[.-]*' AND
                         template_id NOT GLOB '*[.-]' AND
                         template_id NOT GLOB '*[.-][.-]*'),
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

    INSERT INTO projects_v4 (id, world_id, name, goal, template_id, template_version, status,
                             archived_at, trashed_at, created_at, updated_at, revision)
    SELECT id, world_id, name, goal, template_id, template_version, status,
           archived_at, trashed_at, created_at, updated_at, revision
    FROM projects;

    CREATE TEMP TABLE graph_entities_v3 AS SELECT * FROM graph_entities;
    DROP TABLE graph_entities;
    DROP TABLE projects;
    ALTER TABLE projects_v4 RENAME TO projects;

    CREATE INDEX projects_by_world_status ON projects (world_id, status);
    CREATE UNIQUE INDEX projects_id_world ON projects (id, world_id);

    CREATE TABLE graph_entities (
      id             TEXT    PRIMARY KEY CHECK (
                       id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
      kind           TEXT    NOT NULL CHECK (kind IN ('world', 'project')),
      world_id       TEXT    NOT NULL REFERENCES worlds (id) ON DELETE RESTRICT,
      project_id     TEXT,
      ownership      TEXT    NOT NULL CHECK (ownership IN ('app_owned', 'external')),
      source_locator TEXT    CHECK (
                       source_locator IS NULL OR
                       (length(source_locator) BETWEEN 1 AND 1024 AND
                        instr(source_locator, char(0)) = 0)),
      tombstoned_at  TEXT,
      created_at     TEXT    NOT NULL,
      updated_at     TEXT    NOT NULL,
      revision       INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      FOREIGN KEY (project_id, world_id) REFERENCES projects (id, world_id) ON DELETE RESTRICT,
      CHECK (
        (kind = 'world'   AND project_id IS NULL) OR
        (kind = 'project' AND project_id IS NOT NULL)
      ),
      CHECK (ownership = 'app_owned' OR source_locator IS NOT NULL)
    ) STRICT;

    INSERT INTO graph_entities (id, kind, world_id, project_id, ownership, source_locator,
                                tombstoned_at, created_at, updated_at, revision)
    SELECT id, kind, world_id, project_id, ownership, source_locator,
           tombstoned_at, created_at, updated_at, revision
    FROM temp.graph_entities_v3;
    DROP TABLE temp.graph_entities_v3;

    CREATE UNIQUE INDEX graph_entities_one_per_world
      ON graph_entities (world_id) WHERE kind = 'world';
    CREATE UNIQUE INDEX graph_entities_one_per_project
      ON graph_entities (project_id) WHERE kind = 'project';
  `,
};

export const MIGRATIONS: readonly Migration[] = [
  m0001AppMeta,
  m0002ProfileWorldsProjects,
  m0003GraphEntities,
  m0004TemplateIdNamespaces,
];

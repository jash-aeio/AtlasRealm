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
// Every column, value and index is kept; only the template_id rule changes, and it only gets
// looser, so the copy can never fail on an existing row.
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
      -- A superset of v2's rule (adds "." and allows up to 100 characters), so every
      -- existing row is guaranteed to copy over. The repository (assertTemplateId) enforces
      -- the exact shape for new rows: lowercase words joined by single "." or "-".
      template_id      TEXT    NOT NULL CHECK (
                         length(template_id) BETWEEN 1 AND 100 AND
                         template_id NOT GLOB '*[^a-z0-9.-]*'),
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

// Building placements and hotbar slots (M2-2 #67, ADR-0023). Both are *representations* of a
// project, never the project itself (PRODUCT_RULES §3.1): rows here can be deleted freely, and
// nothing in them can delete, rename or move a project (the project references are RESTRICT).
// "Unplaced" simply means a project has no placement row, so existing projects start unplaced
// and no data is copied. The database enforces identity and uniqueness only; footprints,
// bounds and collisions are application rules (M2-1), because they depend on the world's size
// and on each appearance's footprint.
const m0005PlacementsAndHotbar: Migration = {
  version: 5,
  name: 'create_building_placements_hotbar_slots',
  up: `
    CREATE TABLE building_placements (
      id            TEXT    PRIMARY KEY CHECK (
                      id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
      world_id      TEXT    NOT NULL REFERENCES worlds (id) ON DELETE RESTRICT,
      -- The target: a project's building, or a service structure (Guild, Tool Shops, ...).
      project_id    TEXT,
      -- Slug shape only; the exact list lives in code (src/common/world/service-kinds.ts).
      service_kind  TEXT    CHECK (
                      service_kind IS NULL OR
                      (length(service_kind) BETWEEN 1 AND 64 AND
                       service_kind NOT GLOB '*[^a-z0-9-]*')),
      -- A versioned asset ID such as placeholder.building.2x2 (asset manifest, ADR-0013).
      appearance_id TEXT    NOT NULL CHECK (
                      length(appearance_id) BETWEEN 1 AND 100 AND
                      appearance_id NOT GLOB '*[^a-z0-9.-]*'),
      -- Grid tile of the footprint's anchor corner, never screen pixels (UI_SPEC §17.1). 0-255
      -- is only a sanity range (the largest grid is 256); the world's real size is checked in
      -- application code.
      tile_x        INTEGER NOT NULL CHECK (tile_x BETWEEN 0 AND 255),
      tile_y        INTEGER NOT NULL CHECK (tile_y BETWEEN 0 AND 255),
      rotation      INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0, 90, 180, 270)),
      created_at    TEXT    NOT NULL,
      updated_at    TEXT    NOT NULL,
      revision      INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      -- A project's building stands in the project's own world.
      FOREIGN KEY (project_id, world_id) REFERENCES projects (id, world_id) ON DELETE RESTRICT,
      -- Exactly one target.
      CHECK ((project_id IS NULL) <> (service_kind IS NULL))
    ) STRICT;

    -- At most one building per project (PRODUCT_RULES §3.1). NULLs never collide in a UNIQUE
    -- index, so service structures are not limited by it.
    CREATE UNIQUE INDEX building_placements_one_per_project ON building_placements (project_id);
    -- The main query path: every building in a world (drawing the map, collision checks).
    CREATE INDEX building_placements_by_world ON building_placements (world_id);

    -- Ten shortcut slots per world, keys 1-9 and 0 (slot 0 is key 1, slot 9 is key 0).
    CREATE TABLE hotbar_slots (
      world_id     TEXT    NOT NULL REFERENCES worlds (id) ON DELETE RESTRICT,
      slot         INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 9),
      target_type  TEXT    NOT NULL CHECK (target_type IN ('project', 'service')),
      project_id   TEXT,
      service_kind TEXT    CHECK (
                     service_kind IS NULL OR
                     (length(service_kind) BETWEEN 1 AND 64 AND
                      service_kind NOT GLOB '*[^a-z0-9-]*')),
      created_at   TEXT    NOT NULL,
      updated_at   TEXT    NOT NULL,
      revision     INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      PRIMARY KEY (world_id, slot),
      -- A pinned project belongs to this world.
      FOREIGN KEY (project_id, world_id) REFERENCES projects (id, world_id) ON DELETE RESTRICT,
      -- The filled column matches the target type, and only that one is filled.
      CHECK (
        (target_type = 'project' AND project_id IS NOT NULL AND service_kind IS NULL) OR
        (target_type = 'service' AND service_kind IS NOT NULL AND project_id IS NULL)
      )
    ) STRICT;

    -- Each target is pinned at most once per world (ADR-0023). Partial indexes: each covers
    -- only the rows of its own target type.
    CREATE UNIQUE INDEX hotbar_slots_one_per_project
      ON hotbar_slots (world_id, project_id) WHERE project_id IS NOT NULL;
    CREATE UNIQUE INDEX hotbar_slots_one_per_service
      ON hotbar_slots (world_id, service_kind) WHERE service_kind IS NOT NULL;
  `,
};

// User-made links between projects (M2-11 #76, ADR-0029, GRAPH_MODEL §30.4). A link is
// descriptive only: nothing in scheduling, permissions or file access may read this table.
// Every type is directed and the source → target order *is* the direction (no separate column
// that could disagree with it). Both ends point at the same world's project through composite
// foreign keys, so a cross-world link can't exist even through raw SQL. Nothing references this
// table, so a later migration can widen its CHECKs (more origins, evidence) with a cheap rebuild.
// Links of a trashed project stay here; the graph query hides them (ADR-0029).
const m0006ProjectRelations: Migration = {
  version: 6,
  name: 'create_project_relations',
  up: `
    CREATE TABLE project_relations (
      id                 TEXT    PRIMARY KEY CHECK (
                           id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
      world_id           TEXT    NOT NULL REFERENCES worlds (id) ON DELETE RESTRICT,
      source_project_id  TEXT    NOT NULL,
      target_project_id  TEXT    NOT NULL,
      relation_type      TEXT    NOT NULL
                         CHECK (relation_type IN ('depends_on', 'supports', 'references')),
      -- Only user links exist so far; parsed, execution and ai_proposed come later (§30.4).
      origin             TEXT    NOT NULL DEFAULT 'user' CHECK (origin IN ('user')),
      confirmation_state TEXT    NOT NULL DEFAULT 'confirmed'
                         CHECK (confirmation_state IN ('proposed', 'confirmed', 'rejected')),
      created_at         TEXT    NOT NULL,
      updated_at         TEXT    NOT NULL,
      revision           INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      -- Both ends are projects of this link's world.
      FOREIGN KEY (source_project_id, world_id) REFERENCES projects (id, world_id)
        ON DELETE RESTRICT,
      FOREIGN KEY (target_project_id, world_id) REFERENCES projects (id, world_id)
        ON DELETE RESTRICT,
      CHECK (source_project_id <> target_project_id),
      -- A link the user made is confirmed by making it.
      CHECK (origin <> 'user' OR confirmation_state = 'confirmed')
    ) STRICT;

    -- One link of each type per direction. A → B and B → A are different links.
    CREATE UNIQUE INDEX project_relations_unique
      ON project_relations (source_project_id, target_project_id, relation_type);
    -- Finding a project's incoming links (the unique index already covers outgoing ones).
    CREATE INDEX project_relations_by_target ON project_relations (target_project_id);
    -- The graph query: a world's links in a stable order.
    CREATE INDEX project_relations_by_world ON project_relations (world_id, created_at, id);
  `,
};

// Resource packages and the agent team (M3-3 #113, ADR-0036, DATA_MODEL §9.3). A package
// version is identified by (package_id, version); there is no agent_templates table, the
// installed agent package is the template. Nothing here holds a secret: credentials live in
// the vault and are referenced from provider/integration tables later (SECURITY §21).
//
// "Kind inside the foreign key": a CHECK only sees its own row, so each user of an installed
// package carries a fixed kind column ('agent', 'skill', 'tool') and points at
// world_resources (world_id, package_id, package_version, kind). The database then refuses a
// package that isn't installed in *this* world, or one of the wrong kind, even via raw SQL.
//
// Deletion behavior: package records and installed packages are RESTRICT while used;
// dependency rows go with their package and skill bindings with their agent (CASCADE).
// Projects and worlds are never deleted here (RESTRICT, as everywhere else).
const m0007ResourcesAndTeam: Migration = {
  version: 7,
  name: 'create_resource_packages_agent_instances_bindings',
  up: `
    -- One known package version. Rows are recorded when a world installs the package; the
    -- repository refuses the same id@version with a different digest (ADR-0036).
    CREATE TABLE resource_packages (
      -- Namespaced ID such as builtin.structured-brief. Shape only; the exact rule is
      -- ResourceId in src/common/contracts/resource-manifest.ts, checked by the repository.
      package_id      TEXT    NOT NULL CHECK (
                        length(package_id) BETWEEN 3 AND 100 AND instr(package_id, '.') > 0 AND
                        package_id NOT GLOB '*[^a-z0-9.-]*'),
      version         TEXT    NOT NULL CHECK (    -- MAJOR.MINOR.PATCH
                        length(version) BETWEEN 5 AND 14 AND version NOT GLOB '*[^0-9.]*'),
      kind            TEXT    NOT NULL CHECK (kind IN ('agent', 'skill', 'tool')),
      name            TEXT    NOT NULL CHECK (
                        length(name) BETWEEN 1 AND 80 AND instr(name, char(0)) = 0 AND
                        name = trim(name, char(9, 10, 13, 32))),
      publisher       TEXT    NOT NULL CHECK (
                        length(publisher) BETWEEN 1 AND 80 AND instr(publisher, char(0)) = 0 AND
                        publisher = trim(publisher, char(9, 10, 13, 32))),
      -- Wide enough for imports (M6), so adding them needs no rebuild of this referenced table.
      source          TEXT    NOT NULL CHECK (source IN ('bundled', 'local', 'github')),
      -- A git commit or tag for a GitHub source; NULL for bundled packages. Never a URL: no
      -- ":" or "@", so a clone URL with a credential in it can't be stored (SECURITY §21).
      source_revision TEXT    CHECK (
                        source_revision IS NULL OR
                        (length(source_revision) BETWEEN 1 AND 200 AND
                         source_revision NOT GLOB '*[^A-Za-z0-9._/-]*')),
      digest_sha256   TEXT    NOT NULL CHECK (
                        length(digest_sha256) = 64 AND digest_sha256 NOT GLOB '*[^0-9a-f]*'),
      license         TEXT    NOT NULL CHECK (    -- SPDX identifier, e.g. UNLICENSED
                        length(license) BETWEEN 1 AND 64 AND
                        license NOT GLOB '*[^A-Za-z0-9.+-]*'),
      review_state    TEXT    NOT NULL
                      CHECK (review_state IN ('trusted', 'unreviewed', 'approved', 'blocked')),
      created_at      TEXT    NOT NULL,
      updated_at      TEXT    NOT NULL,
      revision        INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      PRIMARY KEY (package_id, version),
      -- "trusted" means bundled with the app, and only bundled packages are trusted. The
      -- builtin.* namespace belongs to bundled packages only (ADR-0034), so an imported package
      -- can't take a bundled package's name or pose as one.
      CHECK ((source = 'bundled') = (review_state = 'trusted')),
      CHECK ((source = 'bundled') = (package_id GLOB 'builtin.*'))
    ) STRICT;

    -- The foreign key target that carries the kind (see the note above).
    CREATE UNIQUE INDEX resource_packages_id_version_kind
      ON resource_packages (package_id, version, kind);

    -- What a package version needs. Part of the immutable package record: never edited,
    -- deleted with the package.
    CREATE TABLE resource_dependencies (
      package_id       TEXT    NOT NULL,
      package_version  TEXT    NOT NULL,
      -- requires: manifest requirements.packages; default_skill / default_tool: the skills
      -- and tools a new instance of this agent starts with.
      requirement_kind TEXT    NOT NULL
                       CHECK (requirement_kind IN ('requires', 'default_skill', 'default_tool')),
      dependency_id    TEXT    NOT NULL CHECK (
                         length(dependency_id) BETWEEN 3 AND 100 AND instr(dependency_id, '.') > 0 AND
                         dependency_id NOT GLOB '*[^a-z0-9.-]*'),
      -- "1.2.0" (exactly) or "^1.2.0" (compatible), ADR-0034.
      version_range    TEXT    NOT NULL CHECK (
                         length(version_range) BETWEEN 5 AND 15 AND
                         version_range NOT GLOB '*[^0-9.^]*'),
      created_at       TEXT    NOT NULL,
      PRIMARY KEY (package_id, package_version, requirement_kind, dependency_id),
      FOREIGN KEY (package_id, package_version) REFERENCES resource_packages (package_id, version)
        ON DELETE CASCADE,
      CHECK (dependency_id <> package_id)
    ) STRICT;

    -- "Who needs this package?" (readiness, uninstall messages).
    CREATE INDEX resource_dependencies_by_dependency ON resource_dependencies (dependency_id);

    -- A package installed in a world. One version per package per world (ADR-0036).
    -- Installed and enabled are different (DATA_MODEL §10.2); installing never grants access.
    CREATE TABLE world_resources (
      world_id        TEXT    NOT NULL REFERENCES worlds (id) ON DELETE RESTRICT,
      package_id      TEXT    NOT NULL,
      package_version TEXT    NOT NULL,
      kind            TEXT    NOT NULL CHECK (kind IN ('agent', 'skill', 'tool')),
      enabled         INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      created_at      TEXT    NOT NULL,
      updated_at      TEXT    NOT NULL,
      revision        INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      PRIMARY KEY (world_id, package_id),
      -- A package record can't be removed while a world has it installed.
      FOREIGN KEY (package_id, package_version, kind)
        REFERENCES resource_packages (package_id, version, kind) ON DELETE RESTRICT
    ) STRICT;

    CREATE UNIQUE INDEX world_resources_installed
      ON world_resources (world_id, package_id, package_version, kind);
    -- Finding the worlds that use a package record (and the FK check when one is deleted).
    CREATE INDEX world_resources_by_package ON world_resources (package_id, package_version);

    -- A recruited agent: one project's member, made from an installed agent package.
    -- Recruiting starts no work (PRD §5.3). Dismissing deletes the row (ADR-0036).
    CREATE TABLE agent_instances (
      id               TEXT    PRIMARY KEY CHECK (
                         id GLOB '[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f]-[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
      world_id         TEXT    NOT NULL REFERENCES worlds (id) ON DELETE RESTRICT,
      project_id       TEXT    NOT NULL,
      template_id      TEXT    NOT NULL,
      template_version TEXT    NOT NULL,
      template_kind    TEXT    NOT NULL DEFAULT 'agent' CHECK (template_kind = 'agent'),
      -- NULL: shown with the template's name. Same rule as other display names.
      nickname         TEXT    CHECK (
                         nickname IS NULL OR
                         (length(nickname) BETWEEN 1 AND 80 AND instr(nickname, char(0)) = 0 AND
                          nickname = trim(nickname, char(9, 10, 13, 32)))),
      -- A versioned asset ID; NULL: the template's default look.
      appearance_id    TEXT    CHECK (
                         appearance_id IS NULL OR
                         (length(appearance_id) BETWEEN 1 AND 100 AND
                          appearance_id NOT GLOB '*[^a-z0-9.-]*')),
      created_at       TEXT    NOT NULL,
      updated_at       TEXT    NOT NULL,
      revision         INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),  -- configuration revision
      FOREIGN KEY (project_id, world_id) REFERENCES projects (id, world_id) ON DELETE RESTRICT,
      FOREIGN KEY (world_id, template_id, template_version, template_kind)
        REFERENCES world_resources (world_id, package_id, package_version, kind)
        ON DELETE RESTRICT
    ) STRICT;

    -- The target for bindings, which must stay in the agent's world.
    CREATE UNIQUE INDEX agent_instances_id_world ON agent_instances (id, world_id);
    -- The team panel: a project's agents in recruit order.
    CREATE INDEX agent_instances_by_project ON agent_instances (project_id, created_at, id);
    CREATE INDEX agent_instances_by_template
      ON agent_instances (world_id, template_id, template_version, template_kind);

    -- A skill an agent uses. Deleted with the agent.
    CREATE TABLE agent_skill_bindings (
      agent_instance_id TEXT    NOT NULL,
      world_id          TEXT    NOT NULL,
      skill_id          TEXT    NOT NULL,
      skill_version     TEXT    NOT NULL,
      skill_kind        TEXT    NOT NULL DEFAULT 'skill' CHECK (skill_kind = 'skill'),
      enabled           INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      created_at        TEXT    NOT NULL,
      updated_at        TEXT    NOT NULL,
      revision          INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      PRIMARY KEY (agent_instance_id, skill_id),
      FOREIGN KEY (agent_instance_id, world_id) REFERENCES agent_instances (id, world_id)
        ON DELETE CASCADE,
      FOREIGN KEY (world_id, skill_id, skill_version, skill_kind)
        REFERENCES world_resources (world_id, package_id, package_version, kind)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX agent_skill_bindings_by_skill
      ON agent_skill_bindings (world_id, skill_id, skill_version, skill_kind);

    -- A tool a project may use, with the capabilities the user switched on. This is NOT a
    -- permission grant (SECURITY §13.2): grants are their own table (M3-10).
    CREATE TABLE project_tool_bindings (
      project_id           TEXT    NOT NULL,
      world_id             TEXT    NOT NULL,
      tool_id              TEXT    NOT NULL,
      tool_version         TEXT    NOT NULL,
      tool_kind            TEXT    NOT NULL DEFAULT 'tool' CHECK (tool_kind = 'tool'),
      -- JSON array of capability IDs; the repository checks each against the registry.
      enabled_capabilities TEXT    NOT NULL DEFAULT '[]' CHECK (
                             length(enabled_capabilities) <= 4096 AND
                             json_valid(enabled_capabilities) AND
                             json_type(enabled_capabilities) = 'array'),
      created_at           TEXT    NOT NULL,
      updated_at           TEXT    NOT NULL,
      revision             INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
      PRIMARY KEY (project_id, tool_id),
      FOREIGN KEY (project_id, world_id) REFERENCES projects (id, world_id) ON DELETE RESTRICT,
      FOREIGN KEY (world_id, tool_id, tool_version, tool_kind)
        REFERENCES world_resources (world_id, package_id, package_version, kind)
        ON DELETE RESTRICT
    ) STRICT;

    CREATE INDEX project_tool_bindings_by_tool
      ON project_tool_bindings (world_id, tool_id, tool_version, tool_kind);
  `,
};

export const MIGRATIONS: readonly Migration[] = [
  m0001AppMeta,
  m0002ProfileWorldsProjects,
  m0003GraphEntities,
  m0004TemplateIdNamespaces,
  m0005PlacementsAndHotbar,
  m0006ProjectRelations,
  m0007ResourcesAndTeam,
];

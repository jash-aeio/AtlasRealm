-- Frozen snapshot of a schema v4 profile database, as v0.2.0-m1 leaves it after some use:
-- a profile, an active and an archived world, and projects in every status with their graph
-- entities. Used by tests/integration/storage-migration-v5.test.ts to prove the v4 → v5
-- upgrade on a realistic file. Never regenerate this from the current migrations: its job is
-- to stay what real users have on disk. A test checks it still matches migrations 1–4.
-- The CREATE statements are exactly what SQLite stored for migrations 1–4 (sqlite_schema).

CREATE TABLE schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT    NOT NULL,
    applied_at TEXT    NOT NULL  -- UTC ISO-8601 instant
  ) STRICT;

CREATE TABLE app_meta (
      key        TEXT    PRIMARY KEY,
      value      TEXT    NOT NULL,
      created_at TEXT    NOT NULL,  -- UTC ISO-8601 instant
      updated_at TEXT    NOT NULL,  -- UTC ISO-8601 instant
      revision   INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1)
    ) STRICT;

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

CREATE TABLE "projects" (
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

CREATE UNIQUE INDEX graph_entities_one_per_world
      ON graph_entities (world_id) WHERE kind = 'world';

CREATE UNIQUE INDEX graph_entities_one_per_project
      ON graph_entities (project_id) WHERE kind = 'project';

INSERT INTO schema_migrations (version, name, applied_at) VALUES
  (1, 'create_app_meta', '2026-11-08T09:00:00.000Z'),
  (2, 'create_profile_settings_worlds_projects', '2026-11-12T10:15:00.000Z'),
  (3, 'create_graph_entities', '2026-11-13T08:00:00.000Z'),
  (4, 'allow_namespaced_template_ids', '2026-11-14T09:30:00.000Z');
INSERT INTO app_meta (key, value, created_at, updated_at, revision) VALUES
  ('launch_count',      '9',                        '2026-11-08T09:00:00.010Z', '2026-11-19T17:45:00.000Z', 9),
  ('first_launched_at', '2026-11-08T09:00:00.010Z', '2026-11-08T09:00:00.010Z', '2026-11-19T17:45:00.000Z', 9),
  ('last_launched_at',  '2026-11-19T17:45:00.000Z', '2026-11-08T09:00:00.010Z', '2026-11-19T17:45:00.000Z', 9);

INSERT INTO profile_settings (profile_id, display_name, avatar_preset, avatar_colour, timezone,
                              preferences_json, created_at, updated_at, revision) VALUES
  ('default', 'Robin', 'wanderer', '#3a7bd5', 'Europe/Amsterdam', '{}',
   '2026-11-12T10:15:01.000Z', '2026-11-18T09:00:00.000Z', 2);

INSERT INTO worlds (id, name, theme_id, grid_width, grid_height, archived_at, created_at,
                    updated_at, revision) VALUES
  ('3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b', 'Home realm', 'meadow', 64, 64, NULL,
   '2026-11-12T10:16:00.000Z', '2026-11-12T10:16:00.000Z', 1),
  ('9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d', 'Old experiments', 'meadow', 32, 48,
   '2026-11-17T14:00:00.000Z', '2026-11-13T11:00:00.000Z', '2026-11-17T14:00:00.000Z', 2);

INSERT INTO projects (id, world_id, name, goal, template_id, template_version, status,
                      archived_at, trashed_at, created_at, updated_at, revision) VALUES
  ('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
   'Launch plan', 'Ship the beta by December', 'builtin.generic', '1.0.0', 'active',
   NULL, NULL, '2026-11-14T10:00:00.000Z', '2026-11-15T08:30:00.000Z', 3),
  ('b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
   'Newsletter', '', 'builtin.content-campaign', '1.0.0', 'archived',
   '2026-11-16T12:00:00.000Z', NULL, '2026-11-14T10:05:00.000Z', '2026-11-16T12:00:00.000Z', 2),
  ('c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f', '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
   'Old draft', 'Superseded', 'builtin.generic', '1.0.0', 'trashed',
   '2026-11-15T09:00:00.000Z', '2026-11-16T09:00:00.000Z', '2026-11-14T11:00:00.000Z',
   '2026-11-16T09:00:00.000Z', 3),
  ('d4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80', '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
   'Garden notes', '', 'generic', '1.0.0', 'active',
   NULL, NULL, '2026-11-13T11:05:00.000Z', '2026-11-13T11:05:00.000Z', 1);

INSERT INTO graph_entities (id, kind, world_id, project_id, ownership, source_locator,
                            tombstoned_at, created_at, updated_at, revision) VALUES
  ('e5f6a7b8-c9d0-4e1f-8a3b-4c5d6e7f8091', 'world', '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
   NULL, 'app_owned', NULL, NULL, '2026-11-12T10:16:00.000Z', '2026-11-12T10:16:00.000Z', 1),
  ('f6a7b8c9-d0e1-4f2a-9b4c-5d6e7f8091a2', 'world', '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
   NULL, 'app_owned', NULL, NULL, '2026-11-13T11:00:00.000Z', '2026-11-13T11:00:00.000Z', 1),
  ('07b8c9d0-e1f2-4a3b-8c5d-6e7f8091a2b3', 'project', '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
   'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', 'app_owned', NULL, NULL,
   '2026-11-14T10:00:00.000Z', '2026-11-14T10:00:00.000Z', 1),
  ('18c9d0e1-f2a3-4b4c-9d6e-7f8091a2b3c4', 'project', '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
   'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', 'app_owned', NULL, NULL,
   '2026-11-14T10:05:00.000Z', '2026-11-14T10:05:00.000Z', 1),
  ('29d0e1f2-a3b4-4c5d-8e7f-8091a2b3c4d5', 'project', '3f2b8c1e-5a4d-4e6f-9b7a-1c2d3e4f5a6b',
   'c3d4e5f6-a7b8-4c9d-8e1f-2a3b4c5d6e7f', 'app_owned', NULL, '2026-11-16T09:00:00.000Z',
   '2026-11-14T11:00:00.000Z', '2026-11-16T09:00:00.000Z', 2),
  ('3ae1f2a3-b4c5-4d6e-9f80-91a2b3c4d5e6', 'project', '9d8c7b6a-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
   'd4e5f6a7-b8c9-4d0e-9f2a-3b4c5d6e7f80', 'app_owned', NULL, NULL,
   '2026-11-13T11:05:00.000Z', '2026-11-13T11:05:00.000Z', 1);

PRAGMA user_version = 4;

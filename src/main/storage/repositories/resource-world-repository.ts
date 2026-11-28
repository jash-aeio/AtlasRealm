// Repository for `world_resources`: the only code that reads or writes that table.
//
// A package installed in a world (ADR-0036): one version per package per world. Installed and
// enabled are different (DATA_MODEL §10.2), and installing never grants access (SECURITY
// §13.2): nothing here writes a grant. Uninstalling deletes only the installed row, and is
// refused while an agent instance or binding uses the package; the package record, projects
// and artifacts stay. Whether an archived world may change is a service rule (M3-5).
import type { Database } from '../database';
import { oneOf, RESOURCE_KINDS, type ResourceKind } from './resource-package-repository';
import {
  assertRevision,
  explainUnchanged,
  integer,
  RepositoryError,
  type Row,
  text,
} from './repository-support';

export interface WorldResource {
  readonly worldId: string;
  readonly packageId: string;
  readonly packageVersion: string;
  readonly kind: ResourceKind;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

/** What uses an installed package, so a refusal can name it (M3-5). */
export interface PackageUsers {
  /** Agent instances made from it (agent packages). */
  readonly agentInstanceIds: readonly string[];
  /** Agent instances with it as a skill (skill packages). */
  readonly skillBoundAgentIds: readonly string[];
  /** Projects with it as a tool (tool packages). */
  readonly toolBoundProjectIds: readonly string[];
}

function toWorldResource(row: Row): WorldResource {
  return {
    worldId: text(row, 'world_id'),
    packageId: text(row, 'package_id'),
    packageVersion: text(row, 'package_version'),
    kind: oneOf(row, 'kind', RESOURCE_KINDS),
    enabled: integer(row, 'enabled') === 1,
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: integer(row, 'revision'),
  };
}

function assertBoolean(value: boolean): void {
  // `enabled` may come from outside TypeScript; 0/1 or "true" are not booleans.
  if (typeof value !== 'boolean') {
    throw new RepositoryError('invalid_input', 'Enabled must be true or false.');
  }
}

const ids = (rows: Row[], column: string): string[] => rows.map((row) => text(row, column));

const SELECT_REVISION =
  'SELECT revision FROM world_resources WHERE world_id = :world_id AND package_id = :package_id';
const NOT_INSTALLED = 'That package is not installed in this world.';

export class WorldResourceRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(worldId: string, packageId: string): WorldResource | undefined {
    const row = this.db
      .prepare('SELECT * FROM world_resources WHERE world_id = ? AND package_id = ?')
      .get(worldId, packageId);
    return row === undefined ? undefined : toWorldResource(row);
  }

  /** The world's installed packages, by package ID. */
  listByWorld(worldId: string): WorldResource[] {
    return this.db
      .prepare('SELECT * FROM world_resources WHERE world_id = ? ORDER BY package_id')
      .all(worldId)
      .map(toWorldResource);
  }

  /**
   * Installs a recorded package version in a world. The kind comes from the package record.
   * Refuses with `not_found` for a missing world or package record, and `already_exists` if
   * the world already has any version of that package (one per world, ADR-0036).
   */
  install(input: {
    readonly worldId: string;
    readonly packageId: string;
    readonly packageVersion: string;
    readonly enabled: boolean;
  }): WorldResource {
    assertBoolean(input.enabled);
    if (this.db.prepare('SELECT 1 FROM worlds WHERE id = ?').get(input.worldId) === undefined) {
      throw new RepositoryError('not_found', 'No world with that ID.');
    }
    const record = this.db
      .prepare('SELECT kind FROM resource_packages WHERE package_id = ? AND version = ?')
      .get(input.packageId, input.packageVersion);
    if (record === undefined) {
      throw new RepositoryError('not_found', 'No package record with that ID and version.');
    }
    const installed = this.get(input.worldId, input.packageId);
    if (installed !== undefined) {
      throw new RepositoryError(
        'already_exists',
        `This world already has ${input.packageId} ${installed.packageVersion} installed.`,
      );
    }

    const at = this.now().toISOString();
    const row = this.db
      .prepare(
        `INSERT INTO world_resources (world_id, package_id, package_version, kind, enabled,
                                      created_at, updated_at)
         VALUES (:world_id, :package_id, :version, :kind, :enabled, :at, :at)
         RETURNING *`,
      )
      .get({
        world_id: input.worldId,
        package_id: input.packageId,
        version: input.packageVersion,
        kind: text(record, 'kind'),
        enabled: input.enabled ? 1 : 0,
        at,
      });
    if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');
    return toWorldResource(row);
  }

  /** Switches an installed package on or off. Refuses with `not_found` or `revision_conflict`. */
  setEnabled(
    worldId: string,
    packageId: string,
    enabled: boolean,
    expectedRevision: number,
  ): WorldResource {
    assertBoolean(enabled);
    assertRevision(expectedRevision);
    const params = { world_id: worldId, package_id: packageId };
    const row = this.db
      .prepare(
        `UPDATE world_resources
         SET enabled = :enabled, updated_at = :at, revision = revision + 1
         WHERE world_id = :world_id AND package_id = :package_id AND revision = :expected
         RETURNING *`,
      )
      .get({
        ...params,
        enabled: enabled ? 1 : 0,
        at: this.now().toISOString(),
        expected: expectedRevision,
      });
    if (row !== undefined) return toWorldResource(row);
    explainUnchanged(this.db, SELECT_REVISION, params, expectedRevision, {
      notFound: NOT_INSTALLED,
      refusal: 'Update refused.',
    });
  }

  /** Everything in this world that uses the installed package. Empty lists when unused. */
  usersOf(worldId: string, packageId: string): PackageUsers {
    return {
      agentInstanceIds: ids(
        this.db
          .prepare(
            `SELECT id FROM agent_instances WHERE world_id = ? AND template_id = ?
             ORDER BY created_at, id`,
          )
          .all(worldId, packageId),
        'id',
      ),
      skillBoundAgentIds: ids(
        this.db
          .prepare(
            `SELECT agent_instance_id FROM agent_skill_bindings WHERE world_id = ? AND skill_id = ?
             ORDER BY agent_instance_id`,
          )
          .all(worldId, packageId),
        'agent_instance_id',
      ),
      toolBoundProjectIds: ids(
        this.db
          .prepare(
            `SELECT project_id FROM project_tool_bindings WHERE world_id = ? AND tool_id = ?
             ORDER BY project_id`,
          )
          .all(worldId, packageId),
        'project_id',
      ),
    };
  }

  /**
   * Removes the installed row only; the package record stays. Refuses with `invalid_transition`
   * while anything uses the package (see usersOf; the foreign keys back this up), and with
   * `not_found` or `revision_conflict`. Returns the removed row.
   */
  uninstall(worldId: string, packageId: string, expectedRevision: number): WorldResource {
    assertRevision(expectedRevision);
    const users = this.usersOf(worldId, packageId);
    const count =
      users.agentInstanceIds.length +
      users.skillBoundAgentIds.length +
      users.toolBoundProjectIds.length;
    const params = { world_id: worldId, package_id: packageId };
    if (count > 0) {
      // A stale revision is still reported as a conflict first: the caller saw old data.
      const current = this.db.prepare(SELECT_REVISION).get(params);
      if (current !== undefined && integer(current, 'revision') === expectedRevision) {
        throw new RepositoryError(
          'invalid_transition',
          `${packageId} is still used by ${String(count)} agent(s) or binding(s) in this world.`,
        );
      }
    }
    const row = this.db
      .prepare(
        `DELETE FROM world_resources
         WHERE world_id = :world_id AND package_id = :package_id AND revision = :expected
         RETURNING *`,
      )
      .get({ ...params, expected: expectedRevision });
    if (row !== undefined) return toWorldResource(row);
    explainUnchanged(this.db, SELECT_REVISION, params, expectedRevision, {
      notFound: NOT_INSTALLED,
      refusal: 'Uninstall refused.',
    });
  }
}

// Repository for `agent_skill_bindings` and `project_tool_bindings`: the only code that reads or
// writes those tables.
//
// A skill binding says an agent uses a skill installed in its world; a tool binding says a
// project may use a tool installed in its world, with the capabilities the user switched on
// (ADR-0036). The installed version is read from `world_resources`, never taken from the
// caller. A tool binding is NOT a permission grant (SECURITY §13.2): the broker (M3-10) checks
// grants, and nothing here writes one. Removing a binding deletes only that row. Whether a
// capability belongs to the tool's manifest is a service rule (M3-6), because the manifest is
// not in the database.
import { CapabilityId, REFUSED_IN_PACKAGES } from '../../../common/security/capabilities';
import type { Database, SQLInputValue } from '../database';
import {
  assertRevision,
  explainUnchanged,
  integer,
  RepositoryError,
  type Row,
  text,
} from './repository-support';

export interface SkillBinding {
  readonly agentInstanceId: string;
  readonly worldId: string;
  readonly skillId: string;
  readonly skillVersion: string;
  readonly enabled: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface ToolBinding {
  readonly projectId: string;
  readonly worldId: string;
  readonly toolId: string;
  readonly toolVersion: string;
  /** What the user switched on. Not a grant. */
  readonly enabledCapabilities: readonly CapabilityId[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

function toSkillBinding(row: Row): SkillBinding {
  return {
    agentInstanceId: text(row, 'agent_instance_id'),
    worldId: text(row, 'world_id'),
    skillId: text(row, 'skill_id'),
    skillVersion: text(row, 'skill_version'),
    enabled: integer(row, 'enabled') === 1,
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: integer(row, 'revision'),
  };
}

/**
 * Reads the stored list leniently (ADR-0033): a capability the app no longer knows is dropped,
 * so it can never count as switched on, and one old value can't break the whole list.
 */
function readCapabilities(row: Row): CapabilityId[] {
  const parsed: unknown = JSON.parse(text(row, 'enabled_capabilities'));
  if (!Array.isArray(parsed)) throw new Error('Column enabled_capabilities is not an array.');
  return parsed.flatMap((value) => {
    const result = CapabilityId.safeParse(value);
    return result.success ? [result.data] : [];
  });
}

function toToolBinding(row: Row): ToolBinding {
  return {
    projectId: text(row, 'project_id'),
    worldId: text(row, 'world_id'),
    toolId: text(row, 'tool_id'),
    toolVersion: text(row, 'tool_version'),
    enabledCapabilities: readCapabilities(row),
    createdAt: text(row, 'created_at'),
    updatedAt: text(row, 'updated_at'),
    revision: integer(row, 'revision'),
  };
}

function assertBoolean(value: boolean): void {
  if (typeof value !== 'boolean') {
    throw new RepositoryError('invalid_input', 'Enabled must be true or false.');
  }
}

/**
 * Known capability IDs a package may use (never one refused in packages, such as running
 * programs), each once. Returns the JSON text to store.
 */
function capabilitiesJson(values: readonly CapabilityId[]): string {
  if (!Array.isArray(values) || values.length > CapabilityId.options.length) {
    throw new RepositoryError('invalid_input', 'Enabled capabilities must be a short list.');
  }
  for (const value of values) {
    const result = CapabilityId.safeParse(value);
    if (!result.success) throw new RepositoryError('invalid_input', 'Unknown capability.');
    if (REFUSED_IN_PACKAGES.has(result.data)) {
      throw new RepositoryError('invalid_input', 'That capability is not allowed for tools.');
    }
  }
  if (new Set(values).size !== values.length) {
    throw new RepositoryError('invalid_input', 'A capability is listed more than once.');
  }
  return JSON.stringify(values);
}

const SKILL_REVISION =
  'SELECT revision FROM agent_skill_bindings WHERE agent_instance_id = :owner AND skill_id = :id';
const TOOL_REVISION =
  'SELECT revision FROM project_tool_bindings WHERE project_id = :owner AND tool_id = :id';

export class BindingRepository {
  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {}

  // ---- Skills ------------------------------------------------------------------------------

  getSkill(agentInstanceId: string, skillId: string): SkillBinding | undefined {
    const row = this.db
      .prepare('SELECT * FROM agent_skill_bindings WHERE agent_instance_id = ? AND skill_id = ?')
      .get(agentInstanceId, skillId);
    return row === undefined ? undefined : toSkillBinding(row);
  }

  /** An agent's skills, by skill ID. */
  listSkills(agentInstanceId: string): SkillBinding[] {
    return this.db
      .prepare('SELECT * FROM agent_skill_bindings WHERE agent_instance_id = ? ORDER BY skill_id')
      .all(agentInstanceId)
      .map(toSkillBinding);
  }

  /**
   * Gives an agent a skill installed in its world. Refuses with `not_found` for an unknown
   * agent or a skill not installed there (an agent or tool ID counts as not installed), and
   * `already_exists` if the agent already has it.
   */
  bindSkill(input: {
    readonly agentInstanceId: string;
    readonly skillId: string;
    readonly enabled: boolean;
  }): SkillBinding {
    assertBoolean(input.enabled);
    const agent = this.db
      .prepare('SELECT world_id FROM agent_instances WHERE id = ?')
      .get(input.agentInstanceId);
    if (agent === undefined) throw new RepositoryError('not_found', 'No agent with that ID.');
    const worldId = text(agent, 'world_id');
    const version = this.installedVersion(worldId, input.skillId, 'skill');
    if (this.getSkill(input.agentInstanceId, input.skillId) !== undefined) {
      throw new RepositoryError('already_exists', 'This agent already has that skill.');
    }
    const at = this.now().toISOString();
    const row = this.db
      .prepare(
        `INSERT INTO agent_skill_bindings (agent_instance_id, world_id, skill_id, skill_version,
                                           enabled, created_at, updated_at)
         VALUES (:agent, :world_id, :skill_id, :version, :enabled, :at, :at)
         RETURNING *`,
      )
      .get({
        agent: input.agentInstanceId,
        world_id: worldId,
        skill_id: input.skillId,
        version,
        enabled: input.enabled ? 1 : 0,
        at,
      });
    if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');
    return toSkillBinding(row);
  }

  /** Switches an agent's skill on or off. Refuses with `not_found` or `revision_conflict`. */
  setSkillEnabled(
    agentInstanceId: string,
    skillId: string,
    enabled: boolean,
    expectedRevision: number,
  ): SkillBinding {
    assertBoolean(enabled);
    const row = this.guardedWrite(
      `UPDATE agent_skill_bindings
       SET enabled = :enabled, updated_at = :at, revision = revision + 1
       WHERE agent_instance_id = :owner AND skill_id = :id AND revision = :expected
       RETURNING *`,
      { enabled: enabled ? 1 : 0, at: this.now().toISOString() },
      SKILL_REVISION,
      { owner: agentInstanceId, id: skillId },
      expectedRevision,
      'That agent does not have that skill.',
    );
    return toSkillBinding(row);
  }

  /** Takes a skill away from an agent. Refuses with `not_found` or `revision_conflict`. */
  unbindSkill(agentInstanceId: string, skillId: string, expectedRevision: number): SkillBinding {
    const row = this.guardedWrite(
      `DELETE FROM agent_skill_bindings
       WHERE agent_instance_id = :owner AND skill_id = :id AND revision = :expected
       RETURNING *`,
      {},
      SKILL_REVISION,
      { owner: agentInstanceId, id: skillId },
      expectedRevision,
      'That agent does not have that skill.',
    );
    return toSkillBinding(row);
  }

  // ---- Tools -------------------------------------------------------------------------------

  getTool(projectId: string, toolId: string): ToolBinding | undefined {
    const row = this.db
      .prepare('SELECT * FROM project_tool_bindings WHERE project_id = ? AND tool_id = ?')
      .get(projectId, toolId);
    return row === undefined ? undefined : toToolBinding(row);
  }

  /** A project's tools, by tool ID. */
  listTools(projectId: string): ToolBinding[] {
    return this.db
      .prepare('SELECT * FROM project_tool_bindings WHERE project_id = ? ORDER BY tool_id')
      .all(projectId)
      .map(toToolBinding);
  }

  /**
   * Binds a tool installed in the project's world, with the capabilities switched on. Writes
   * no grant. Refuses with `not_found` for an unknown project or a tool not installed there,
   * `already_exists` if the project already has it, and `invalid_input` for unknown or
   * repeated capabilities.
   */
  bindTool(input: {
    readonly projectId: string;
    readonly toolId: string;
    readonly enabledCapabilities: readonly CapabilityId[];
  }): ToolBinding {
    const capabilities = capabilitiesJson(input.enabledCapabilities);
    const project = this.db
      .prepare('SELECT world_id FROM projects WHERE id = ?')
      .get(input.projectId);
    if (project === undefined) throw new RepositoryError('not_found', 'No project with that ID.');
    const worldId = text(project, 'world_id');
    const version = this.installedVersion(worldId, input.toolId, 'tool');
    if (this.getTool(input.projectId, input.toolId) !== undefined) {
      throw new RepositoryError('already_exists', 'This project already has that tool.');
    }
    const at = this.now().toISOString();
    const row = this.db
      .prepare(
        `INSERT INTO project_tool_bindings (project_id, world_id, tool_id, tool_version,
                                            enabled_capabilities, created_at, updated_at)
         VALUES (:project_id, :world_id, :tool_id, :version, :capabilities, :at, :at)
         RETURNING *`,
      )
      .get({
        project_id: input.projectId,
        world_id: worldId,
        tool_id: input.toolId,
        version,
        capabilities,
        at,
      });
    if (row === undefined) throw new Error('INSERT … RETURNING returned no row.');
    return toToolBinding(row);
  }

  /** Replaces the switched-on capabilities. Refuses with `not_found`, `revision_conflict`, `invalid_input`. */
  setToolCapabilities(
    projectId: string,
    toolId: string,
    enabledCapabilities: readonly CapabilityId[],
    expectedRevision: number,
  ): ToolBinding {
    const capabilities = capabilitiesJson(enabledCapabilities);
    const row = this.guardedWrite(
      `UPDATE project_tool_bindings
       SET enabled_capabilities = :capabilities, updated_at = :at, revision = revision + 1
       WHERE project_id = :owner AND tool_id = :id AND revision = :expected
       RETURNING *`,
      { capabilities, at: this.now().toISOString() },
      TOOL_REVISION,
      { owner: projectId, id: toolId },
      expectedRevision,
      'That project does not have that tool.',
    );
    return toToolBinding(row);
  }

  /** Removes a tool from a project. Refuses with `not_found` or `revision_conflict`. */
  unbindTool(projectId: string, toolId: string, expectedRevision: number): ToolBinding {
    const row = this.guardedWrite(
      `DELETE FROM project_tool_bindings
       WHERE project_id = :owner AND tool_id = :id AND revision = :expected
       RETURNING *`,
      {},
      TOOL_REVISION,
      { owner: projectId, id: toolId },
      expectedRevision,
      'That project does not have that tool.',
    );
    return toToolBinding(row);
  }

  // ---- Shared ------------------------------------------------------------------------------

  /** The version of `packageId` installed in the world, if it is installed with that kind. */
  private installedVersion(worldId: string, packageId: string, kind: 'skill' | 'tool'): string {
    const row = this.db
      .prepare(
        `SELECT package_version FROM world_resources
         WHERE world_id = ? AND package_id = ? AND kind = ?`,
      )
      .get(worldId, packageId, kind);
    if (row === undefined) {
      throw new RepositoryError('not_found', `That ${kind} is not installed in this world.`);
    }
    return text(row, 'package_version');
  }

  /**
   * One expected-revision UPDATE or DELETE on a two-column key (`:owner`, `:id`), explained by
   * explainUnchanged when it matches nothing. Statements are constants from this file.
   */
  private guardedWrite(
    statement: string,
    params: Record<string, SQLInputValue>,
    selectRevision: string,
    key: { readonly owner: string; readonly id: string },
    expectedRevision: number,
    notFound: string,
  ): Row {
    assertRevision(expectedRevision);
    const row = this.db.prepare(statement).get({ ...params, ...key, expected: expectedRevision });
    if (row !== undefined) return row;
    explainUnchanged(this.db, selectRevision, key, expectedRevision, {
      notFound,
      refusal: 'Change refused.',
    });
  }
}

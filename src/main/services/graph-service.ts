// Application service for project links and the Realm Atlas graph (M2-11 #76, ADR-0029). The
// `relation.*` and `graph.*` IPC handlers call this; it checks the world and the projects, then
// lets ProjectRelationRepository read or write. Repository errors pass through and the handlers
// map them.
//
// A link is descriptive only (GRAPH_MODEL §30.4): nothing here writes to `projects`, and
// nothing in scheduling, permissions or file access reads links. Removing a link deletes only
// the link (§30.5). Links of a trashed project are kept but hidden from the graph and its
// counts; restoring the project brings them back.
import { GRAPH_MAX_EDGES, GRAPH_MAX_NODES } from '../../common/contracts/graph';
import type { GraphWorldConnectionsOutput } from '../../common/contracts/graph';
import {
  MAX_RELATIONS_PER_WORLD,
  type RelationSummary,
  type RelationType,
} from '../../common/contracts/relation';
import { CommandError } from '../ipc/router';
import type { ActiveProfile } from '../profiles/active-profile';
import {
  type ProjectRelation,
  ProjectRelationRepository,
} from '../storage/repositories/project-relation-repository';
import { RepositoryError } from '../storage/repositories/repository-support';
import { type World, WorldRepository } from '../storage/repositories/world-repository';
import type { ProjectService } from './project-service';

/** The one reason every link change gives while its world is archived (F5, #59). */
export const ARCHIVED_WORLD_LINK_REFUSAL =
  'This world is archived. Restore it before changing its links.';

export const TRASHED_PROJECT_LINK_REFUSAL =
  'A project in the trash cannot be linked. Restore it first.';

export const SELF_LINK_REFUSAL = 'A project cannot be linked to itself.';

export const DUPLICATE_LINK_MESSAGE = 'Those projects already have that link.';

export const LINK_LIMIT_MESSAGE = `This world already has ${String(MAX_RELATIONS_PER_WORLD)} links (links of projects in the trash included).`;

export class GraphService {
  constructor(
    private readonly active: ActiveProfile,
    private readonly projects: ProjectService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Links `source` → `target`. Both must be projects of this world and not trashed (archived is
   * fine, as for placements and pins). Refuses a self-link and a duplicate of the same source,
   * target and type; nothing is written on refusal.
   */
  create(input: {
    readonly worldId: string;
    readonly sourceProjectId: string;
    readonly targetProjectId: string;
    readonly type: RelationType;
  }): RelationSummary {
    const world = this.mutableWorld(input.worldId);
    // The contract refuses this too; checked again so no caller can skip it.
    if (input.sourceProjectId === input.targetProjectId) {
      throw new CommandError('invalid_payload', SELF_LINK_REFUSAL);
    }
    for (const id of [input.sourceProjectId, input.targetProjectId]) {
      // Same `not_found` for an unknown project, another world's and another profile's.
      if (this.projects.get(world.id, id).status === 'trashed') {
        throw new CommandError('invalid_transition', TRASHED_PROJECT_LINK_REFUSAL);
      }
    }
    const relations = this.relations();
    if (relations.find(input.sourceProjectId, input.targetProjectId, input.type) !== undefined) {
      throw new CommandError('already_exists', DUPLICATE_LINK_MESSAGE);
    }
    // Count and insert run synchronously, so no other command can slip in between them.
    if (relations.countByWorld(world.id) >= MAX_RELATIONS_PER_WORLD) {
      throw new CommandError('limit_reached', LINK_LIMIT_MESSAGE);
    }
    return summary(relations.create({ ...input, worldId: world.id }));
  }

  /**
   * Removes one link, only if it is in this world and still has `expectedRevision`. Both
   * projects are untouched, in any status. Returns the removed link, for undo.
   */
  remove(input: {
    readonly worldId: string;
    readonly relationId: string;
    readonly expectedRevision: number;
  }): RelationSummary {
    const world = this.mutableWorld(input.worldId);
    const relations = this.relations();
    // Another world's link answers like an unknown one (ADR-0020).
    if (relations.get(input.relationId)?.worldId !== world.id) {
      throw new RepositoryError('not_found', 'No link with that ID in this world.');
    }
    return summary(relations.remove(input.relationId, input.expectedRevision));
  }

  /** The bounded Connections graph for the world context. Works in an archived world. */
  worldConnections(worldId: string): GraphWorldConnectionsOutput {
    const world = this.world(worldId);
    const graph = this.relations().connections(world.id, {
      maxNodes: GRAPH_MAX_NODES,
      maxEdges: GRAPH_MAX_EDGES,
    });
    return {
      nodes: [...graph.nodes],
      edges: graph.edges.map(summary),
      totalNodes: graph.totalNodes,
      totalEdges: graph.totalEdges,
      omittedNodes: graph.totalNodes - graph.nodes.length,
      omittedEdges: graph.totalEdges - graph.edges.length,
    };
  }

  // Asked for on every call, so a profile switch (M1-8) is picked up immediately.
  private db() {
    return this.active.current().db;
  }

  private relations(): ProjectRelationRepository {
    return new ProjectRelationRepository(this.db(), this.now);
  }

  private world(worldId: string): World {
    const world = new WorldRepository(this.db()).get(worldId);
    if (world === undefined) throw new RepositoryError('not_found', 'No world with that ID.');
    return world;
  }

  /** The world must exist and not be archived (F5, #59). */
  private mutableWorld(worldId: string): World {
    const world = this.world(worldId);
    if (world.archivedAt !== null) {
      throw new CommandError('invalid_transition', ARCHIVED_WORLD_LINK_REFUSAL);
    }
    return world;
  }
}

function summary(relation: ProjectRelation): RelationSummary {
  return { ...relation };
}

// What a building placement or a hotbar slot stands for: a project, or a service structure
// (Guild, Tool Shops, ...). Shared by PlacementRepository and HotbarRepository, which store it
// as two columns (`project_id` / `service_kind`) so the database can check the project
// reference with a foreign key (ADR-0023). Callers only ever see this tagged shape.
import { isServiceKind, type ServiceKind } from '../../../common/world/service-kinds';
import type { Database, SQLInputValue } from '../database';
import { nullableText, RepositoryError, type Row } from './repository-support';

export type RepresentationTarget =
  | { readonly type: 'project'; readonly id: string }
  | { readonly type: 'service'; readonly id: ServiceKind };

/** The two target columns as stored. Exactly one is non-null. */
export interface TargetColumns extends Record<string, SQLInputValue> {
  readonly project_id: string | null;
  readonly service_kind: ServiceKind | null;
}

/**
 * Checks a target against the world it is meant for and returns its column values. A project
 * must exist *in this world*; a service must be on the fixed list. Either failure is
 * `not_found`/`invalid_input` before anything is written. The project's status is not
 * checked here: whether an archived or trashed project may be placed or pinned is a service
 * rule (M2-3, M2-4).
 */
export function resolveTarget(
  db: Database,
  worldId: string,
  target: RepresentationTarget,
): TargetColumns {
  if (db.prepare('SELECT 1 FROM worlds WHERE id = ?').get(worldId) === undefined) {
    throw new RepositoryError('not_found', 'No world with that ID.');
  }
  // `target` can come from outside TypeScript (IPC payloads after Zod), so check the tag too.
  switch (target.type) {
    case 'project': {
      const found = db
        .prepare('SELECT 1 FROM projects WHERE id = ? AND world_id = ?')
        .get(target.id, worldId);
      if (found === undefined) {
        throw new RepositoryError('not_found', 'No project with that ID in this world.');
      }
      return { project_id: target.id, service_kind: null };
    }
    case 'service': {
      if (!isServiceKind(target.id)) {
        throw new RepositoryError('invalid_input', 'Unknown service.');
      }
      return { project_id: null, service_kind: target.id };
    }
    default:
      throw new RepositoryError('invalid_input', 'Unknown target type.');
  }
}

/** Reads the target back from a row; fails loudly if the row breaks the one-target rule. */
export function targetFromRow(row: Row): RepresentationTarget {
  const projectId = nullableText(row, 'project_id');
  const serviceKind = nullableText(row, 'service_kind');
  if (projectId !== null && serviceKind === null) return { type: 'project', id: projectId };
  if (serviceKind !== null && projectId === null && isServiceKind(serviceKind)) {
    return { type: 'service', id: serviceKind };
  }
  throw new Error('Row has no valid representation target.');
}

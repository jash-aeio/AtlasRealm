// Contract tests for `relation.*` and `graph.worldConnections` (M2-11 #76, ADR-0029) through
// the real router, against a real profile database in a temp directory. Covers forged and
// cross-world IDs, self-links, duplicates, trashed and archived ends, unplaced projects, the
// 150 / 300 bound with exact omitted counts, removal that touches nothing but the link,
// survival across a restart, and profile isolation.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { GRAPH_MAX_EDGES, GRAPH_MAX_NODES } from '../../src/common/contracts/graph';
import type { RelationSummary, RelationType } from '../../src/common/contracts/relation';
import { APP_ENTRY_URL } from '../../src/main/bootstrap/app-origin';
import {
  createGraphWorldConnectionsHandler,
  graphWorldConnectionsCommand,
} from '../../src/main/ipc/commands/graph';
import {
  createRelationCreateHandler,
  createRelationRemoveHandler,
  relationCreateCommand,
  relationRemoveCommand,
} from '../../src/main/ipc/commands/relation';
import {
  type CommandDefinition,
  type CommandHandler,
  createCommandHandler,
  trustRendererEntry,
} from '../../src/main/ipc/router';
import { ActiveProfile } from '../../src/main/profiles/active-profile';
import {
  ARCHIVED_WORLD_LINK_REFUSAL,
  DUPLICATE_LINK_MESSAGE,
  GraphService,
  SELF_LINK_REFUSAL,
  TRASHED_PROJECT_LINK_REFUSAL,
} from '../../src/main/services/graph-service';
import { ProjectService } from '../../src/main/services/project-service';
import { openStartupProfile, type StartupProfile } from '../../src/main/storage/profiles/startup';
import { PlacementRepository } from '../../src/main/storage/repositories/placement-repository';
import type { Project } from '../../src/main/storage/repositories/project-repository';
import { type World, WorldRepository } from '../../src/main/storage/repositories/world-repository';
import { bundledTemplateFiles } from '../../src/main/templates/bundled-templates';
import { buildTemplateCatalog } from '../../src/main/templates/catalog';

const isTrusted = trustRendererEntry(APP_ENTRY_URL);
const trusted = { senderFrame: { url: APP_ENTRY_URL, parent: null } };
const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';
const catalog = buildTemplateCatalog(bundledTemplateFiles(), () => undefined);

interface Session {
  readonly userData: string;
  readonly opened: StartupProfile;
  readonly projects: ProjectService;
  readonly graph: GraphService;
}

let session: Session;
let world: World;
let otherWorld: World;

async function openSession(userData: string): Promise<Session> {
  const opened = await openStartupProfile(userData);
  const active = new ActiveProfile(userData, { profileId: opened.profileId, db: opened.db });
  const projects = new ProjectService(active, catalog);
  return { userData, opened, projects, graph: new GraphService(active, projects) };
}

function call<I extends z.ZodType, O extends z.ZodType>(
  definition: CommandDefinition<I, O>,
  handler: CommandHandler<I, O>,
  payload: unknown,
) {
  return createCommandHandler(definition, handler, isTrusted)(trusted, payload);
}

const create = (payload: unknown, s = session) =>
  call(relationCreateCommand, createRelationCreateHandler(s.graph), payload);
const remove = (payload: unknown, s = session) =>
  call(relationRemoveCommand, createRelationRemoveHandler(s.graph), payload);
const connections = (payload: unknown, s = session) =>
  call(graphWorldConnectionsCommand, createGraphWorldConnectionsHandler(s.graph), payload);

function newProject(name = 'Launch plan', worldId = world.id, s = session): Project {
  return s.projects.create({
    worldId,
    templateId: 'builtin.generic',
    templateVersion: '1.0.0',
    name,
    goal: '',
  });
}

const linkInput = (source: Project, target: Project, type: RelationType = 'depends_on') => ({
  worldId: source.worldId,
  sourceProjectId: source.id,
  targetProjectId: target.id,
  type,
});

async function linked(
  source: Project,
  target: Project,
  type: RelationType = 'depends_on',
  s = session,
): Promise<RelationSummary> {
  const result = await create(linkInput(source, target, type), s);
  if (!result.ok) throw new Error(result.error.code);
  return result.data.relation;
}

async function graphOf(worldId = world.id, s = session) {
  const result = await connections({ worldId }, s);
  if (!result.ok) throw new Error(result.error.code);
  return result.data;
}

const lifecycle = (project: Project) => ({
  worldId: project.worldId,
  projectId: project.id,
  expectedRevision: session.projects.get(project.worldId, project.id).revision,
});

/** Every table a link must never change, plus the links themselves. */
function snapshot(): Record<string, unknown> {
  const rows = (table: string) =>
    session.opened.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
  return {
    links: rows('project_relations'),
    projects: rows('projects'),
    worlds: rows('worlds'),
    entities: rows('graph_entities'),
    placements: rows('building_placements'),
    hotbar: rows('hotbar_slots'),
  };
}

beforeEach(async () => {
  session = await openSession(mkdtempSync(join(tmpdir(), 'atlas-relation-cmd-')));
  const worlds = new WorldRepository(session.opened.db);
  world = worlds.create({ name: 'Home', themeId: 'meadow' });
  otherWorld = worlds.create({ name: 'Other', themeId: 'meadow' });
});

afterEach(() => {
  if (session.opened.db.isOpen) session.opened.db.close();
  rmSync(session.userData, { recursive: true, force: true });
});

describe('relation.create', () => {
  it('stores a directed, confirmed user link', async () => {
    const launch = newProject('Launch plan');
    const newsletter = newProject('Newsletter');
    const result = await create(linkInput(launch, newsletter, 'supports'));
    expect(result).toMatchObject({
      ok: true,
      data: {
        relation: {
          worldId: world.id,
          sourceProjectId: launch.id,
          targetProjectId: newsletter.id,
          type: 'supports',
          origin: 'user',
          confirmationState: 'confirmed',
          revision: 1,
        },
      },
    });
  });

  it('allows the reverse direction and another type, and refuses a duplicate', async () => {
    const a = newProject('A');
    const b = newProject('B');
    await linked(a, b);
    await linked(b, a);
    await linked(a, b, 'references');
    const before = snapshot();
    expect(await create(linkInput(a, b))).toEqual({
      ok: false,
      error: { code: 'already_exists', message: DUPLICATE_LINK_MESSAGE },
    });
    expect(snapshot()).toEqual(before);
  });

  it('refuses a self-link at the contract', async () => {
    const a = newProject('A');
    const result = await create(linkInput(a, a));
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
    // And again in the service, for any caller that skips the contract.
    expect(() => session.graph.create(linkInput(a, a))).toThrow(SELF_LINK_REFUSAL);
  });

  it.each([
    ['an unknown type', { type: 'blocks' }],
    ['an extra field', { origin: 'ai_proposed' }],
    ['a non-UUID project', { targetProjectId: 'newsletter' }],
  ])('refuses %s at the contract', async (_label, change) => {
    const a = newProject('A');
    const b = newProject('B');
    const result = await create({ ...linkInput(a, b), ...change });
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_payload' } });
  });

  it('answers not_found for a forged project, another world’s project and a forged world', async () => {
    const a = newProject('A');
    const b = newProject('B');
    const garden = newProject('Garden', otherWorld.id);
    const before = snapshot();
    for (const payload of [
      { ...linkInput(a, b), targetProjectId: UNKNOWN_ID },
      { ...linkInput(a, b), sourceProjectId: garden.id },
      { ...linkInput(a, b), targetProjectId: garden.id },
      { ...linkInput(a, b), worldId: otherWorld.id },
      { ...linkInput(a, b), worldId: UNKNOWN_ID },
    ]) {
      expect(await create(payload)).toMatchObject({ ok: false, error: { code: 'not_found' } });
    }
    expect(snapshot()).toEqual(before);
  });

  it('refuses a trashed end and allows an archived one', async () => {
    const a = newProject('A');
    const b = newProject('B');
    const c = newProject('C');
    session.projects.trash(lifecycle(b));
    session.projects.archive(lifecycle(c));
    expect(await create(linkInput(a, b))).toEqual({
      ok: false,
      error: { code: 'invalid_transition', message: TRASHED_PROJECT_LINK_REFUSAL },
    });
    expect(await create(linkInput(b, a))).toMatchObject({
      ok: false,
      error: { code: 'invalid_transition' },
    });
    expect(await create(linkInput(a, c))).toMatchObject({ ok: true });
  });

  it('refuses changes in an archived world', async () => {
    const a = newProject('A');
    const b = newProject('B');
    const relation = await linked(a, b);
    const worlds = new WorldRepository(session.opened.db);
    worlds.archive(world.id, world.revision);
    expect(await create(linkInput(b, a))).toEqual({
      ok: false,
      error: { code: 'invalid_transition', message: ARCHIVED_WORLD_LINK_REFUSAL },
    });
    expect(
      await remove({ worldId: world.id, relationId: relation.id, expectedRevision: 1 }),
    ).toMatchObject({ ok: false, error: { code: 'invalid_transition' } });
    // Reading still works.
    expect((await graphOf()).edges).toHaveLength(1);
  });

  it('never changes a project, a building, a pin or a graph entity', async () => {
    const a = newProject('A');
    const b = newProject('B');
    const before = snapshot();
    await linked(a, b);
    const after = snapshot();
    expect({ ...after, links: [] }).toEqual({ ...before, links: [] });
  });
});

describe('relation.remove', () => {
  it('deletes only the link and returns it', async () => {
    const a = newProject('A');
    const b = newProject('B');
    const before = snapshot();
    const relation = await linked(a, b);
    const result = await remove({
      worldId: world.id,
      relationId: relation.id,
      expectedRevision: 1,
    });
    expect(result).toEqual({ ok: true, data: { relation } });
    expect(snapshot()).toEqual(before);
  });

  it('refuses a stale revision, an unknown link and another world’s link', async () => {
    const a = newProject('A');
    const b = newProject('B');
    const relation = await linked(a, b);
    const before = snapshot();
    expect(
      await remove({ worldId: world.id, relationId: relation.id, expectedRevision: 2 }),
    ).toMatchObject({ ok: false, error: { code: 'revision_conflict', currentRevision: 1 } });
    expect(
      await remove({ worldId: world.id, relationId: UNKNOWN_ID, expectedRevision: 1 }),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(
      await remove({ worldId: otherWorld.id, relationId: relation.id, expectedRevision: 1 }),
    ).toMatchObject({ ok: false, error: { code: 'not_found' } });
    expect(snapshot()).toEqual(before);
  });
});

describe('graph.worldConnections', () => {
  it('includes unplaced projects and says which ones have a building', async () => {
    const a = newProject('A');
    const b = newProject('B');
    new PlacementRepository(session.opened.db).create({
      worldId: world.id,
      target: { type: 'project', id: a.id },
      appearanceId: 'placeholder.building.2x2',
      tileX: 10,
      tileY: 10,
      rotation: 0,
    });
    const relation = await linked(a, b);
    expect(await graphOf()).toEqual({
      nodes: [
        { projectId: a.id, name: 'A', status: 'active', placed: true, linkCount: 1 },
        { projectId: b.id, name: 'B', status: 'active', placed: false, linkCount: 1 },
      ],
      edges: [relation],
      totalNodes: 2,
      totalEdges: 1,
      omittedNodes: 0,
      omittedEdges: 0,
    });
  });

  it('shows only the asked world', async () => {
    newProject('A');
    newProject('Garden', otherWorld.id);
    expect((await graphOf()).nodes.map((n) => n.name)).toEqual(['A']);
    expect(await connections({ worldId: UNKNOWN_ID })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('hides a trashed project and its links from nodes, edges and counts, and restore brings them back', async () => {
    const a = newProject('A');
    const b = newProject('B');
    const c = newProject('C');
    const ab = await linked(a, b);
    await linked(c, b);
    session.projects.trash(lifecycle(b));

    const hidden = await graphOf();
    expect(hidden.nodes.map((n) => n.projectId)).toEqual([a.id, c.id]);
    expect(hidden.nodes.every((n) => n.linkCount === 0)).toBe(true);
    expect(hidden).toMatchObject({ edges: [], totalNodes: 2, totalEdges: 0, omittedEdges: 0 });

    session.projects.restoreFromTrash(lifecycle(b));
    const back = await graphOf();
    expect(back.totalEdges).toBe(2);
    expect(back.edges[0]).toEqual(ab);
  });

  it('shows an archived project with its status, after the active ones', async () => {
    const a = newProject('A');
    const b = newProject('B');
    await linked(a, b);
    session.projects.archive(lifecycle(a));
    const graph = await graphOf();
    expect(graph.nodes.map((n) => [n.name, n.status])).toEqual([
      ['B', 'active'],
      ['A', 'archived'],
    ]);
    expect(graph.edges).toHaveLength(1);
  });

  it(`returns at most ${String(GRAPH_MAX_NODES)} nodes and ${String(GRAPH_MAX_EDGES)} edges with exact omitted counts`, async () => {
    const all = Array.from({ length: GRAPH_MAX_NODES + 10 }, (_, i) =>
      newProject(`P${String(i).padStart(3, '0')}`),
    );
    // 310 links among the first 30 projects (every ordered pair has two types to spare).
    const hub = all.slice(0, 30);
    let made = 0;
    outer: for (const type of ['depends_on', 'supports'] as const) {
      for (const source of hub) {
        for (const target of hub) {
          if (source === target) continue;
          await linked(source, target, type);
          made += 1;
          if (made === GRAPH_MAX_EDGES + 10) break outer;
        }
      }
    }
    // The two newest projects get one link, so they rank above every unlinked project.
    const last = all.at(-1);
    const secondLast = all.at(-2);
    if (last === undefined || secondLast === undefined) throw new Error('setup failed');
    await linked(last, secondLast);

    const graph = await graphOf();
    expect(graph.nodes).toHaveLength(GRAPH_MAX_NODES);
    expect(graph.edges).toHaveLength(GRAPH_MAX_EDGES);
    expect(graph).toMatchObject({
      totalNodes: GRAPH_MAX_NODES + 10,
      totalEdges: GRAPH_MAX_EDGES + 11,
      omittedNodes: 10,
      omittedEdges: 11,
    });
    const kept = new Set(graph.nodes.map((n) => n.projectId));
    expect(kept.has(last.id) && kept.has(secondLast.id)).toBe(true);
    // Linked projects first, then the oldest unlinked; the newest unlinked ones are cut.
    expect(graph.nodes.slice(0, 32).every((n) => n.linkCount > 0)).toBe(true);
    expect(kept.has(all[GRAPH_MAX_NODES + 7]?.id ?? '')).toBe(false);
    // Every returned edge has both ends among the returned nodes.
    expect(
      graph.edges.every((e) => kept.has(e.sourceProjectId) && kept.has(e.targetProjectId)),
    ).toBe(true);
    // Deterministic: asking again gives the same cut.
    expect(await graphOf()).toEqual(graph);
  });
});

describe('persistence and isolation', () => {
  it('a link survives a restart', async () => {
    const a = newProject('A');
    const b = newProject('B');
    const relation = await linked(a, b);
    session.opened.db.close();

    session = await openSession(session.userData);
    const graph = await graphOf();
    expect(graph.edges).toEqual([relation]);
    expect(graph.nodes.map((n) => n.name)).toEqual(['A', 'B']);
  });

  it('another profile sees none of this profile’s projects, links, titles or counts', async () => {
    const a = newProject('Secret A');
    const b = newProject('Secret B');
    const relation = await linked(a, b);

    const other = await openSession(mkdtempSync(join(tmpdir(), 'atlas-relation-other-')));
    try {
      const theirWorld = new WorldRepository(other.opened.db).create({
        name: 'Theirs',
        themeId: 'meadow',
      });
      expect(await connections({ worldId: world.id }, other)).toMatchObject({
        ok: false,
        error: { code: 'not_found' },
      });
      expect(await create(linkInput(a, b), other)).toMatchObject({
        ok: false,
        error: { code: 'not_found' },
      });
      expect(
        await remove({ worldId: world.id, relationId: relation.id, expectedRevision: 1 }, other),
      ).toMatchObject({ ok: false, error: { code: 'not_found' } });
      expect(await graphOf(theirWorld.id, other)).toEqual({
        nodes: [],
        edges: [],
        totalNodes: 0,
        totalEdges: 0,
        omittedNodes: 0,
        omittedEdges: 0,
      });
    } finally {
      other.opened.db.close();
      rmSync(other.userData, { recursive: true, force: true });
    }
    // This profile's link is untouched.
    expect((await graphOf()).edges).toEqual([relation]);
  });
});

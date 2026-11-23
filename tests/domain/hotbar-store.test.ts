import { describe, expect, it, vi } from 'vitest';

import type { HotbarSlotSummary, HotbarTarget } from '../../src/common/contracts/hotbar';
import type { IpcResult } from '../../src/common/contracts/ipc-result';
import type { ProjectOutput, ProjectStatus } from '../../src/common/contracts/project';
import { SERVICE_KINDS } from '../../src/common/world/service-kinds';
import { ENTRANCES } from '../../src/renderer/app/entrances';
import {
  createHotbar,
  entryText,
  SERVICE_ENTRANCES,
  serviceOfEntrance,
  slotKey,
  type HotbarApi,
} from '../../src/renderer/hotbar/hotbar-store';

const WORLD = '00000000-0000-4000-8000-000000000001';
const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';

function summary(
  slot: number,
  target: HotbarTarget,
  projectStatus: ProjectStatus | null = target.type === 'project' ? 'active' : null,
): HotbarSlotSummary {
  return {
    worldId: WORLD,
    slot,
    target,
    projectStatus,
    createdAt: '2026-11-23T10:00:00.000Z',
    updatedAt: '2026-11-23T10:00:00.000Z',
    revision: 1,
  };
}

const NAMES: Record<string, string> = { [P1]: 'Garden', [P2]: 'Library' };

function projectGet({ projectId }: { projectId: string }): Promise<IpcResult<ProjectOutput>> {
  const name = NAMES[projectId];
  if (name === undefined) {
    return Promise.resolve({ ok: false, error: { code: 'not_found', message: 'Gone.' } });
  }
  return Promise.resolve({
    ok: true,
    data: { project: { id: projectId, name } as ProjectOutput['project'] },
  });
}

function fakeApi(slots: HotbarSlotSummary[]) {
  const api = {
    hotbar: {
      list: vi.fn(() => Promise.resolve({ ok: true as const, data: { slots: [...slots] } })),
      assign: vi.fn(),
      clear: vi.fn(),
    },
    project: { get: vi.fn(projectGet) },
  };
  return api as typeof api & HotbarApi;
}

describe('hotbar labels', () => {
  it('maps slots 0-9 to keys 1-9 then 0', () => {
    expect(Array.from({ length: 10 }, (_, slot) => slotKey(slot)).join('')).toBe('1234567890');
  });

  it('every service kind opens a real sidebar entrance, and Projects is not a service', () => {
    for (const kind of SERVICE_KINDS) {
      expect(ENTRANCES.map((e) => e.id)).toContain(SERVICE_ENTRANCES[kind]);
      expect(serviceOfEntrance(SERVICE_ENTRANCES[kind])).toBe(kind);
    }
    expect(serviceOfEntrance('projects')).toBeUndefined();
  });

  it('says archived and trashed in text, and never shows a blank name', () => {
    const base = { slot: 0, target: { type: 'project', id: P1 } as const };
    expect(entryText({ ...base, projectStatus: 'active', name: 'Garden' })).toBe('Garden');
    expect(entryText({ ...base, projectStatus: 'archived', name: 'Garden' })).toBe(
      'Garden (archived)',
    );
    expect(entryText({ ...base, projectStatus: 'trashed', name: 'Garden' })).toBe(
      'Garden (in trash)',
    );
    expect(entryText({ ...base, projectStatus: 'active', name: null })).toBe('Unknown project');
  });
});

describe('hotbar store', () => {
  it('starts loading, then holds the slots with project and service names', async () => {
    const api = fakeApi([
      summary(0, { type: 'project', id: P1 }),
      summary(9, { type: 'service', id: 'settings' }),
      summary(4, { type: 'project', id: P2 }, 'archived'),
    ]);
    const hotbar = createHotbar(api, WORLD);
    expect(hotbar.store.get().status).toBe('loading');
    await hotbar.refresh();
    expect(api.hotbar.list).toHaveBeenCalledWith({ worldId: WORLD });
    expect(api.project.get).toHaveBeenCalledWith({ worldId: WORLD, projectId: P1 });
    const state = hotbar.store.get();
    expect(state.status).toBe('ready');
    expect(state.entries.map(entryText)).toEqual(['Garden', 'Settings', 'Library (archived)']);
  });

  it('a project that cannot be read still shows its slot, as an unknown project', async () => {
    const gone = '00000000-0000-4000-8000-0000000000ff';
    const hotbar = createHotbar(fakeApi([summary(2, { type: 'project', id: gone })]), WORLD);
    await hotbar.refresh();
    expect(hotbar.store.get().entries.map(entryText)).toEqual(['Unknown project']);
  });

  it('a failed refresh keeps the last good slots and reports the error', async () => {
    const api = fakeApi([summary(0, { type: 'project', id: P1 })]);
    const hotbar = createHotbar(api, WORLD);
    await hotbar.refresh();
    api.hotbar.list.mockResolvedValueOnce({
      ok: false,
      error: { code: 'internal_error', message: 'Busy.' },
    } as never);
    await hotbar.refresh();
    expect(hotbar.store.get().status).toBe('ready');
    expect(hotbar.store.get().entries).toHaveLength(1);
    expect(hotbar.store.get().error?.code).toBe('internal_error');
  });

  it('ignores an answer that arrives after a newer refresh started', async () => {
    const api = fakeApi([]);
    let releaseOld: () => void = () => undefined;
    api.hotbar.list
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseOld = () => {
              resolve({ ok: true, data: { slots: [summary(0, { type: 'project', id: P1 })] } });
            };
          }),
      )
      .mockResolvedValueOnce({ ok: true, data: { slots: [] } });
    const hotbar = createHotbar(api, WORLD);
    const old = hotbar.refresh();
    await hotbar.refresh();
    releaseOld();
    await old;
    expect(hotbar.store.get().entries).toEqual([]);
  });

  it('pins without replace, then reads the hotbar again', async () => {
    const api = fakeApi([]);
    api.hotbar.assign.mockResolvedValueOnce({
      ok: true,
      data: { slot: summary(3, { type: 'project', id: P1 }) },
    });
    const hotbar = createHotbar(api, WORLD);
    const outcome = await hotbar.pin(3, { type: 'project', id: P1 });
    expect(outcome).toEqual({ kind: 'pinned', slot: 3 });
    expect(api.hotbar.assign).toHaveBeenCalledWith({
      worldId: WORLD,
      slot: 3,
      target: { type: 'project', id: P1 },
    });
    expect(api.hotbar.list).toHaveBeenCalled();
  });

  it('an occupied slot comes back as the named occupant, and nothing is replaced', async () => {
    const api = fakeApi([summary(3, { type: 'project', id: P2 }, 'archived')]);
    api.hotbar.assign.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'slot_occupied',
        message: 'That hotbar slot is already in use.',
        hotbar: {
          slot: 3,
          occupant: { target: { type: 'project', id: P2 }, projectStatus: 'archived' },
        },
      },
    });
    const hotbar = createHotbar(api, WORLD);
    const outcome = await hotbar.pin(3, { type: 'project', id: P1 });
    expect(outcome.kind).toBe('occupied');
    if (outcome.kind !== 'occupied') return;
    expect(entryText(outcome.occupant)).toBe('Library (archived)');
    expect(api.hotbar.assign).toHaveBeenCalledTimes(1);
  });

  it('a service occupant is named by its entrance', async () => {
    const api = fakeApi([]);
    api.hotbar.assign.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'slot_occupied',
        message: 'In use.',
        hotbar: {
          slot: 0,
          occupant: { target: { type: 'service', id: 'agents-guild' }, projectStatus: null },
        },
      },
    });
    const outcome = await createHotbar(api, WORLD).pin(0, { type: 'project', id: P1 });
    expect(outcome.kind === 'occupied' && entryText(outcome.occupant)).toBe('Agents Guild');
  });

  it('replace names the occupant it expects', async () => {
    const api = fakeApi([]);
    api.hotbar.assign.mockResolvedValueOnce({
      ok: true,
      data: { slot: summary(3, { type: 'project', id: P1 }) },
    });
    await createHotbar(api, WORLD).pin(3, { type: 'project', id: P1 }, P2);
    expect(api.hotbar.assign).toHaveBeenCalledWith({
      worldId: WORLD,
      slot: 3,
      target: { type: 'project', id: P1 },
      replace: { expectedTargetId: P2 },
    });
  });

  it('other refusals are failures with the error', async () => {
    const api = fakeApi([]);
    api.hotbar.assign.mockResolvedValueOnce({
      ok: false,
      error: { code: 'already_exists', message: 'That is already pinned to another hotbar slot.' },
    });
    const outcome = await createHotbar(api, WORLD).pin(1, { type: 'project', id: P1 });
    expect(outcome).toMatchObject({ kind: 'failed', error: { code: 'already_exists' } });
  });

  it('unpin names the expected target, returns what was cleared and reads again', async () => {
    const api = fakeApi([]);
    api.hotbar.clear.mockResolvedValueOnce({
      ok: true,
      data: { slot: summary(5, { type: 'project', id: P1 }) },
    });
    const hotbar = createHotbar(api, WORLD);
    const outcome = await hotbar.unpin(5, P1);
    expect(api.hotbar.clear).toHaveBeenCalledWith({
      worldId: WORLD,
      slot: 5,
      expectedTargetId: P1,
    });
    expect(outcome.ok && entryText(outcome.entry)).toBe('Garden');
    expect(api.hotbar.list).toHaveBeenCalled();
  });

  it('a refused unpin still reads the hotbar again', async () => {
    const api = fakeApi([]);
    api.hotbar.clear.mockResolvedValueOnce({
      ok: false,
      error: { code: 'revision_conflict', message: 'Changed.' },
    });
    const outcome = await createHotbar(api, WORLD).unpin(5, P1);
    expect(outcome).toMatchObject({ ok: false, error: { code: 'revision_conflict' } });
    expect(api.hotbar.list).toHaveBeenCalled();
  });
});

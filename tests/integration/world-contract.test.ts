// Contract tests for `world.*` (M1-6 #33) through the real router, against real profile
// databases in a temp directory. Includes the profile-isolation case: a world ID that exists
// in another profile is unknown to the active one.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';

import { MAX_WORLDS, type WorldSummary } from '../../src/common/contracts/world';
import { APP_ENTRY_URL } from '../../src/main/bootstrap/app-origin';
import {
  createWorldCreateHandler,
  createWorldListHandler,
  createWorldRenameHandler,
  worldCreateCommand,
  worldListCommand,
  worldRenameCommand,
} from '../../src/main/ipc/commands/world';
import {
  type CommandDefinition,
  type CommandHandler,
  createCommandHandler,
  trustRendererEntry,
} from '../../src/main/ipc/router';
import { ActiveProfile } from '../../src/main/profiles/active-profile';
import { ProfileService } from '../../src/main/profiles/profile-service';
import { openAppDatabase } from '../../src/main/storage/app-database';
import type { Database } from '../../src/main/storage/database';
import { toProfileId } from '../../src/main/storage/profiles/profile-id';
import { openStartupProfile, type StartupProfile } from '../../src/main/storage/profiles/startup';
import { WorldRepository } from '../../src/main/storage/repositories/world-repository';

const isTrusted = trustRendererEntry(APP_ENTRY_URL);
const trusted = { senderFrame: { url: APP_ENTRY_URL, parent: null } };

let userData: string;
let opened: StartupProfile;
let active: ActiveProfile;
const extraDbs: Database[] = [];

function call<I extends z.ZodType, O extends z.ZodType>(
  definition: CommandDefinition<I, O>,
  handler: CommandHandler<I, O>,
  payload: unknown,
) {
  return createCommandHandler(definition, handler, isTrusted)(trusted, payload);
}

const create = (payload: unknown) =>
  call(worldCreateCommand, createWorldCreateHandler(active), payload);
const list = (payload?: unknown) => call(worldListCommand, createWorldListHandler(active), payload);
const rename = (payload: unknown) =>
  call(worldRenameCommand, createWorldRenameHandler(active), payload);

async function createWorld(name: string): Promise<WorldSummary> {
  const result = await create({ name });
  if (!result.ok) throw new Error(result.error.code);
  return result.data.world;
}

beforeEach(async () => {
  userData = mkdtempSync(join(tmpdir(), 'atlas-world-cmd-'));
  opened = await openStartupProfile(userData);
  active = new ActiveProfile(userData, { profileId: opened.profileId, db: opened.db });
});

afterEach(() => {
  for (const db of extraDbs.splice(0)) if (db.isOpen) db.close();
  if (opened.db.isOpen) opened.db.close();
  rmSync(userData, { recursive: true, force: true });
});

describe('world.create', () => {
  it('creates a world with the default theme and grid', async () => {
    const result = await create({ name: '  Home  ' });
    expect(result).toMatchObject({
      ok: true,
      data: {
        world: {
          name: 'Home',
          themeId: 'meadow',
          gridWidth: 64,
          gridHeight: 64,
          archivedAt: null,
          revision: 1,
        },
      },
    });
  });

  it(`refuses more than ${String(MAX_WORLDS)} worlds, archived ones included`, async () => {
    const repository = new WorldRepository(opened.db);
    for (let i = 0; i < MAX_WORLDS; i++)
      repository.create({ name: `W${String(i)}`, themeId: 'meadow' });
    const first = repository.list()[0];
    if (first === undefined) throw new Error('no world');
    repository.archive(first.id, first.revision);

    await expect(create({ name: 'One too many' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'limit_reached' },
    });
  });

  it.each([
    ['unknown theme', { name: 'Home', themeId: 'volcano' }],
    ['path-like theme', { name: 'Home', themeId: '../meadow' }],
    ['wrong type', { name: 7 }],
    ['oversize name', { name: 'x'.repeat(81) }],
    ['empty name', { name: '' }],
    ['control character', { name: 'Home\u0000' }],
    ['chosen ID', { name: 'Home', id: '00000000-0000-4000-8000-000000000001' }],
    ['grid size (not exposed)', { name: 'Home', gridWidth: 1000 }],
    ['no payload', undefined],
  ])('rejects a forged payload (%s) and creates nothing', async (_label, payload) => {
    await expect(create(payload)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
    expect(new WorldRepository(opened.db).list({ includeArchived: true })).toHaveLength(0);
  });
});

describe('world.list', () => {
  it('lists active worlds in creation order, archived ones only on request', async () => {
    const home = await createWorld('Home');
    const work = await createWorld('Work');
    new WorldRepository(opened.db).archive(work.id, work.revision);

    const activeOnly = await list();
    expect(activeOnly).toMatchObject({ ok: true, data: { worlds: [{ id: home.id }] } });
    const all = await list({ includeArchived: true });
    expect(all.ok && all.data.worlds.map((w) => w.name)).toEqual(['Home', 'Work']);
  });

  it.each([
    ['extra key', { includeArchived: true, profileId: 'default' }],
    ['wrong type', { includeArchived: 'yes' }],
    ['array', [true]],
  ])('rejects a forged payload (%s)', async (_label, payload) => {
    await expect(list(payload)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
  });
});

describe('world.rename', () => {
  it('renames by ID and keeps the ID', async () => {
    const home = await createWorld('Home');
    const result = await rename({ worldId: home.id, expectedRevision: 1, name: 'Castle' });
    expect(result).toMatchObject({
      ok: true,
      data: { world: { id: home.id, name: 'Castle', revision: 2 } },
    });
  });

  it('reports a stale revision with the current one', async () => {
    const home = await createWorld('Home');
    await rename({ worldId: home.id, expectedRevision: 1, name: 'Castle' });
    await expect(
      rename({ worldId: home.id, expectedRevision: 1, name: 'Keep' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'revision_conflict', currentRevision: 2 },
    });
  });

  it('treats an unknown world ID as not_found', async () => {
    await expect(
      rename({ worldId: '00000000-0000-4000-8000-000000000000', expectedRevision: 1, name: 'X' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
  });

  it("cannot see or rename another profile's world", async () => {
    // A second profile with its own world, created the way profile.create does it.
    const created = await new ProfileService(active).create('Work');
    const other = await openAppDatabase(userData, toProfileId(created.id), {
      requireExisting: true,
    });
    extraDbs.push(other.db);
    const foreign = new WorldRepository(other.db).create({ name: 'Secret', themeId: 'meadow' });

    await expect(
      rename({ worldId: foreign.id, expectedRevision: 1, name: 'Mine now' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'not_found' } });
    const listed = await list({ includeArchived: true });
    expect(listed).toEqual({ ok: true, data: { worlds: [] } });
    expect(new WorldRepository(other.db).get(foreign.id)?.name).toBe('Secret');
  });

  it.each([
    [
      'uppercase ID',
      { worldId: 'ABCDEF00-0000-4000-8000-000000000000', expectedRevision: 1, name: 'X' },
    ],
    ['not a UUID', { worldId: '1 OR 1=1', expectedRevision: 1, name: 'X' }],
    ['numeric ID', { worldId: 1, expectedRevision: 1, name: 'X' }],
    ['missing revision', { worldId: '00000000-0000-4000-8000-000000000000', name: 'X' }],
    [
      'oversize name',
      {
        worldId: '00000000-0000-4000-8000-000000000000',
        expectedRevision: 1,
        name: 'x'.repeat(81),
      },
    ],
  ])('rejects a forged payload (%s)', async (_label, payload) => {
    await expect(rename(payload)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_payload' },
    });
  });
});

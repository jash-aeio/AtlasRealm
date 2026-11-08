// "A sample record persists across restart": open → migrate → write → close, then open the
// same file again as a fresh start would, and read it back.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Database, openDatabase } from '../../src/main/storage/database';
import { migrate, readSchemaVersion } from '../../src/main/storage/migrate';
import { assertMigrationsAreValid } from '../../src/main/storage/migration-rules';
import { MIGRATIONS } from '../../src/main/storage/migrations';
import { AppMetaRepository } from '../../src/main/storage/repositories/app-meta-repository';

let dir: string;
let dbPath: string;
const open: Database[] = [];

/** One simulated app start: open the file and migrate it, like startup does. */
async function start(): Promise<Database> {
  const db = openDatabase(dbPath);
  open.push(db);
  await migrate(db, MIGRATIONS, { backupDir: join(dir, 'backups') });
  return db;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'atlas-persist-'));
  dbPath = join(dir, 'app.sqlite');
});

afterEach(() => {
  for (const db of open.splice(0)) if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('app migrations', () => {
  it('form a valid list', () => {
    expect(() => {
      assertMigrationsAreValid(MIGRATIONS);
    }).not.toThrow();
    expect(MIGRATIONS.map((m) => m.version)).toEqual(MIGRATIONS.map((_m, i) => i + 1));
  });
});

describe('persistence across restart', () => {
  it('keeps a record written before closing', async () => {
    const first = await start();
    new AppMetaRepository(first, () => new Date('2026-11-08T09:00:00.000Z')).set(
      'first_launched_at',
      '2026-11-08T09:00:00.000Z',
    );
    first.close();

    const second = await start();
    expect(readSchemaVersion(second)).toBe(MIGRATIONS.length);
    expect(new AppMetaRepository(second).get('first_launched_at')).toBe('2026-11-08T09:00:00.000Z');
  });

  it('counts launches and keeps the first launch time', async () => {
    const clock = (iso: string) => () => new Date(iso);

    const first = await start();
    const one = new AppMetaRepository(first, clock('2026-11-08T09:00:00.000Z')).recordLaunch();
    first.close();

    const second = await start();
    const two = new AppMetaRepository(second, clock('2026-11-08T10:00:00.000Z')).recordLaunch();

    expect(one.launchCount).toBe(1);
    expect(two).toEqual({
      launchCount: 2,
      firstLaunchedAt: '2026-11-08T09:00:00.000Z',
      lastLaunchedAt: '2026-11-08T10:00:00.000Z',
    });
    expect(
      second.prepare("SELECT revision FROM app_meta WHERE key = 'launch_count'").get(),
    ).toEqual({ revision: 2 });
  });
});

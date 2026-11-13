import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LaunchInfoInput, LaunchInfoOutput } from '../../src/common/contracts/app-launch-info';
import { openAppDatabase } from '../../src/main/storage/app-database';
import { LEGACY_PROFILE_ID, toProfileId } from '../../src/main/storage/profiles/profile-id';
import { createLaunchInfoHandler } from '../../src/main/ipc/commands/app-launch-info';
import { openDatabase } from '../../src/main/storage/database';
import { migrate } from '../../src/main/storage/migrate';
import { MIGRATIONS } from '../../src/main/storage/migrations';

const PROFILE = toProfileId(LEGACY_PROFILE_ID);
let userData: string;

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'atlas-launchinfo-'));
});

afterEach(() => {
  rmSync(userData, { recursive: true, force: true });
});

describe('app.launchInfo input', () => {
  it('accepts no payload', () => {
    expect(LaunchInfoInput.safeParse(undefined).success).toBe(true);
  });

  it.each([[{}], [null], ['x'], [{ launchCount: 99 }]])('rejects %j', (payload) => {
    expect(LaunchInfoInput.safeParse(payload).success).toBe(false);
  });
});

describe('app.launchInfo handler', () => {
  it('returns what is stored, and reflects a restart', async () => {
    const first = await openAppDatabase(userData, PROFILE);
    const firstInfo = LaunchInfoOutput.parse(await createLaunchInfoHandler(first.db)(undefined));
    first.db.close();

    const second = await openAppDatabase(userData, PROFILE);
    try {
      const info = LaunchInfoOutput.parse(await createLaunchInfoHandler(second.db)(undefined));
      expect(firstInfo.launchCount).toBe(1);
      expect(info).toMatchObject({
        launchCount: 2,
        firstLaunchedAt: firstInfo.firstLaunchedAt,
        schemaVersion: MIGRATIONS.length,
      });
    } finally {
      second.db.close();
    }
  });

  it('does not write: calling it twice changes nothing', async () => {
    const opened = await openAppDatabase(userData, PROFILE);
    try {
      const handler = createLaunchInfoHandler(opened.db);
      expect(await handler(undefined)).toEqual(await handler(undefined));
    } finally {
      opened.db.close();
    }
  });

  it('throws (logged as internal_error by the router) when no launch is recorded', async () => {
    const db = openDatabase(join(userData, 'empty.sqlite'));
    try {
      await migrate(db, MIGRATIONS, { backupDir: join(userData, 'backups') });
      expect(() => createLaunchInfoHandler(db)(undefined)).toThrow('No launch has been recorded');
    } finally {
      db.close();
    }
  });
});

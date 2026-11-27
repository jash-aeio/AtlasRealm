// Path policy tests (M3-9 #119). They create real folders, junctions and symlinks in a temp
// folder, because the point of the module is what Windows really does with links: a test with
// fake paths couldn't show that.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type ApprovedRoot,
  approveRoot,
  openInsideRoot,
  pathShapeProblem,
  PathPolicyError,
  type PathRefusal,
  resolveInsideRoot,
  verifyHandleInsideRoot,
} from './path-policy';

const IS_WINDOWS = process.platform === 'win32';

let base: string;
let rootDir: string;
let outsideDir: string;
let root: ApprovedRoot;

beforeEach(async () => {
  base = mkdtempSync(path.join(tmpdir(), 'atlas-path-policy-'));
  rootDir = path.join(base, 'Root');
  outsideDir = path.join(base, 'outside');
  mkdirSync(rootDir);
  mkdirSync(outsideDir);
  // A sibling whose name starts with the root's name: the classic string-prefix trap.
  mkdirSync(path.join(base, 'Root2'));
  writeFileSync(path.join(base, 'Root2', 'x.txt'), 'sibling');
  writeFileSync(path.join(rootDir, 'a.txt'), 'inside');
  writeFileSync(path.join(outsideDir, 'secret.txt'), 'secret');
  root = await approveRoot(rootDir);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** A junction (Windows folder link) at `link` pointing to `target`. No admin rights needed. */
function junction(link: string, target: string): void {
  symlinkSync(target, link, 'junction');
}

/** Tries to make a file symlink; returns false if the OS refuses without admin/Developer Mode. */
function trySymlink(link: string, target: string): boolean {
  try {
    symlinkSync(target, link, 'file');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return false;
    throw error;
  }
}

async function refusalOf(work: Promise<unknown>): Promise<PathRefusal | 'ok'> {
  try {
    await work;
    return 'ok';
  } catch (error) {
    if (error instanceof PathPolicyError) {
      // Renderer-facing text never names a path (SECURITY §21.3).
      expect(error.message).not.toContain(base);
      expect(error.message).not.toMatch(/[\\/]/);
      return error.reason;
    }
    throw error;
  }
}

describe('pathShapeProblem (no disk access)', () => {
  it.each<[string, PathRefusal]>([
    ['', 'invalid_path'],
    ['a\0b.txt', 'invalid_path'],
    ['x'.repeat(5_000), 'invalid_path'],
    ['C:file.txt', 'invalid_path'],
    ['C:', 'invalid_path'],
    ['notes.', 'invalid_path'],
    ['notes ', 'invalid_path'],
    ['\\\\server\\share\\a.txt', 'unc_path'],
    ['//server/share/a.txt', 'unc_path'],
    ['\\\\.\\PhysicalDrive0', 'device_path'],
    ['\\\\?\\C:\\Windows\\win.ini', 'device_path'],
    ['//?/C:/Windows/win.ini', 'device_path'],
    ['\\/.\\COM1', 'device_path'],
    ['NUL', 'device_path'],
    ['docs\\con.txt', 'device_path'],
    ['C:\\x\\Aux.md', 'device_path'],
    ['COM1', 'device_path'],
    ['lpt9.log', 'device_path'],
    ['COM¹', 'device_path'],
    ['CONOUT$', 'device_path'],
    ['nul .txt', 'device_path'],
    ['file.txt:stream', 'alternate_data_stream'],
    ['file.txt::$DATA', 'alternate_data_stream'],
    ['C:\\x\\file.txt:hidden', 'alternate_data_stream'],
  ])('refuses %j as %s', (candidate, reason) => {
    expect(pathShapeProblem(candidate)).toBe(reason);
  });

  it.each([
    ['a.txt'],
    ['docs\\notes.md'],
    ['C:\\work\\project\\a.txt'],
    ['console.md'],
    ['nul-ish.txt'],
    ['..\\x'],
  ])('accepts the shape of %j (containment is checked separately)', (candidate) => {
    expect(pathShapeProblem(candidate)).toBeUndefined();
  });
});

describe('approveRoot', () => {
  it('resolves the root to its real location', () => {
    // Compared with the OS's answer: on CI the temp folder may be an 8.3 short name (RUNNER~1).
    expect(root.real).toBe(realpathSync.native(rootDir));
    expect(root.given).toBe(path.resolve(rootDir));
  });

  it.each([
    ['a missing folder', () => path.join(base, 'missing')],
    ['a file', () => path.join(rootDir, 'a.txt')],
    ['a relative path', () => 'Root'],
    ['a UNC path', () => '\\\\server\\share'],
    ['a device path', () => '\\\\.\\C:'],
  ])('refuses %s', async (_label, make) => {
    expect(await refusalOf(approveRoot(make()))).toBe('root_unavailable');
  });

  it.skipIf(!IS_WINDOWS)('follows a root that is itself reached through a junction', async () => {
    const link = path.join(base, 'RootLink');
    junction(link, rootDir);
    const viaLink = await approveRoot(link);
    expect(viaLink.real).toBe(root.real);
    const resolved = await resolveInsideRoot(viaLink, 'a.txt');
    expect(resolved.real).toBe(path.join(root.real, 'a.txt'));
  });
});

describe('resolveInsideRoot', () => {
  it('accepts relative and absolute paths inside the root', async () => {
    expect((await resolveInsideRoot(root, 'a.txt')).real).toBe(path.join(root.real, 'a.txt'));
    expect((await resolveInsideRoot(root, path.join(rootDir, 'a.txt'))).exists).toBe(true);
  });

  it.skipIf(!IS_WINDOWS)('compares case-insensitively and returns the real casing', async () => {
    const upper = path.join(base, 'ROOT', 'A.TXT');
    expect((await resolveInsideRoot(root, upper)).real).toBe(path.join(root.real, 'a.txt'));
    expect((await resolveInsideRoot(root, 'A.TXT')).real).toBe(path.join(root.real, 'a.txt'));
  });

  it('refuses a sibling folder whose name starts with the root name', async () => {
    expect(await refusalOf(resolveInsideRoot(root, path.join(base, 'Root2', 'x.txt')))).toBe(
      'outside_root',
    );
  });

  it.each([
    ['..\\outside\\secret.txt'],
    ['docs\\..\\..\\outside\\secret.txt'],
    ['../outside/secret.txt'],
  ])('refuses the escape %j', async (candidate) => {
    expect(await refusalOf(resolveInsideRoot(root, candidate))).toBe('outside_root');
  });

  it.skipIf(!IS_WINDOWS)('refuses a different drive', async () => {
    const otherDrive = root.real.toUpperCase().startsWith('C:') ? 'D:\\x.txt' : 'C:\\x.txt';
    expect(await refusalOf(resolveInsideRoot(root, otherDrive))).toBe('outside_root');
  });

  it('refuses unsafe shapes before touching the disk', async () => {
    expect(await refusalOf(resolveInsideRoot(root, 'a.txt:hidden'))).toBe('alternate_data_stream');
    expect(await refusalOf(resolveInsideRoot(root, 'NUL'))).toBe('device_path');
    expect(await refusalOf(resolveInsideRoot(root, '\\\\server\\share\\a.txt'))).toBe('unc_path');
  });

  it('reports a missing file, unless missing files are allowed', async () => {
    expect(await refusalOf(resolveInsideRoot(root, 'nope.txt'))).toBe('not_found');
    const created = await resolveInsideRoot(root, 'new\\deep\\file.txt', { allowMissing: true });
    expect(created).toEqual({
      real: path.join(root.real, 'new', 'deep', 'file.txt'),
      exists: false,
    });
  });

  describe.skipIf(!IS_WINDOWS)('junctions', () => {
    it('refuses a junction that leads out of the root', async () => {
      junction(path.join(rootDir, 'jn'), outsideDir);
      expect(await refusalOf(resolveInsideRoot(root, 'jn\\secret.txt'))).toBe('link_escape');
      // A new file "inside" that junction would really be created outside.
      expect(await refusalOf(resolveInsideRoot(root, 'jn\\new.txt', { allowMissing: true }))).toBe(
        'link_escape',
      );
    });

    it('accepts a junction that stays inside the root', async () => {
      mkdirSync(path.join(rootDir, 'inner'));
      writeFileSync(path.join(rootDir, 'inner', 'b.txt'), 'b');
      junction(path.join(rootDir, 'shortcut'), path.join(rootDir, 'inner'));
      expect((await resolveInsideRoot(root, 'shortcut\\b.txt')).real).toBe(
        path.join(root.real, 'inner', 'b.txt'),
      );
    });

    it('refuses a junction to the prefix-sharing sibling', async () => {
      junction(path.join(rootDir, 'jn2'), path.join(base, 'Root2'));
      expect(await refusalOf(resolveInsideRoot(root, 'jn2\\x.txt'))).toBe('link_escape');
    });
  });

  it.skipIf(!IS_WINDOWS)(
    'refuses a file symlink that leads out (skipped if Windows refuses symlinks)',
    async (ctx) => {
      if (!trySymlink(path.join(rootDir, 'link.txt'), path.join(outsideDir, 'secret.txt'))) {
        ctx.skip('Windows refused to create a symlink without admin rights or Developer Mode');
      }
      expect(await refusalOf(resolveInsideRoot(root, 'link.txt'))).toBe('link_escape');
    },
  );
});

describe('openInsideRoot', () => {
  it('opens and reads a file inside the root', async () => {
    const { handle, real } = await openInsideRoot(root, 'a.txt', 'read');
    try {
      expect(real).toBe(path.join(root.real, 'a.txt'));
      expect(await handle.readFile('utf8')).toBe('inside');
    } finally {
      await handle.close();
    }
  });

  it('refuses to read a folder', async () => {
    mkdirSync(path.join(rootDir, 'folder'));
    expect(await refusalOf(openInsideRoot(root, 'folder', 'read'))).toBe('not_a_file');
  });

  it('creates a new file and never overwrites an existing one', async () => {
    mkdirSync(path.join(rootDir, 'out'));
    const { handle } = await openInsideRoot(root, 'out\\result.md', 'create');
    await handle.writeFile('# result');
    await handle.close();
    expect(readFileSync(path.join(rootDir, 'out', 'result.md'), 'utf8')).toBe('# result');
    expect(await refusalOf(openInsideRoot(root, 'out\\result.md', 'create'))).toBe(
      'already_exists',
    );
    expect(await refusalOf(openInsideRoot(root, 'a.txt', 'create'))).toBe('already_exists');
    expect(readFileSync(path.join(rootDir, 'a.txt'), 'utf8')).toBe('inside');
  });

  it.skipIf(!IS_WINDOWS)('creates nothing outside through a junction', async () => {
    junction(path.join(rootDir, 'jn'), outsideDir);
    expect(await refusalOf(openInsideRoot(root, 'jn\\planted.txt', 'create'))).toBe('link_escape');
    expect(() => readFileSync(path.join(outsideDir, 'planted.txt'))).toThrow();
  });
});

// Re-check at use: these tests swap a link at an exact moment instead of hoping to win a race.
describe.skipIf(!IS_WINDOWS)(
  'verifyHandleInsideRoot (a link swapped between check and use)',
  () => {
    let innerReal: string;

    beforeEach(() => {
      mkdirSync(path.join(rootDir, 'inner'));
      writeFileSync(path.join(rootDir, 'inner', 'f.txt'), 'inside f');
      innerReal = path.join(root.real, 'inner', 'f.txt');
    });

    it('accepts the handle when nothing changed', async () => {
      const handle = await open(innerReal, 'r');
      try {
        await expect(verifyHandleInsideRoot(root, innerReal, handle)).resolves.toBeUndefined();
      } finally {
        await handle.close();
      }
    });

    it('refuses when the folder became a junction out of the root', async () => {
      // After the check, an attacker replaces `inner` with a junction to the outside folder,
      // so the open lands on the outside file.
      rmSync(path.join(rootDir, 'inner'), { recursive: true });
      writeFileSync(path.join(outsideDir, 'f.txt'), 'outside f');
      junction(path.join(rootDir, 'inner'), outsideDir);
      const handle = await open(innerReal, 'r');
      try {
        expect(await refusalOf(verifyHandleInsideRoot(root, innerReal, handle))).toBe(
          'changed_during_use',
        );
      } finally {
        await handle.close();
      }
    });

    it('refuses when the link was swapped back before the re-check', async () => {
      // The open happened while the junction pointed outside; by the re-check it points inside
      // again. Only the file identity shows that the handle holds the outside file.
      writeFileSync(path.join(outsideDir, 'f.txt'), 'outside f');
      const handle = await open(path.join(outsideDir, 'f.txt'), 'r');
      try {
        expect(await refusalOf(verifyHandleInsideRoot(root, innerReal, handle))).toBe(
          'changed_during_use',
        );
      } finally {
        await handle.close();
      }
    });

    it('refuses when the file was removed after opening', async () => {
      const handle = await open(innerReal, 'r');
      try {
        rmSync(path.join(rootDir, 'inner'), { recursive: true, force: true });
        expect(await refusalOf(verifyHandleInsideRoot(root, innerReal, handle))).toBe(
          'changed_during_use',
        );
      } finally {
        await handle.close();
      }
    });
  },
);

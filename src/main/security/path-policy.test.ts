// Path policy tests (M3-9 #119). They create real folders, junctions and symlinks in a temp
// folder, because the point of the module is what Windows really does with links: a test with
// fake paths couldn't show that.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApprovedRoot,
  approveRoot,
  defaultSensitiveFolders,
  ensureDirInsideRoot,
  listInsideRoot,
  openInsideRoot,
  pathShapeProblem,
  PathPolicyError,
  type PathRefusal,
  resolveInsideRoot,
  type SensitiveFolders,
  verifyHandleInsideRoot,
  walkInsideRoot,
  writeFileInsideRoot,
} from './path-policy';

// `open`, `mkdir` and `link` pass through to the real ones, but a test can run a step right
// before or after them (to swap a folder for a junction at an exact moment, instead of hoping
// to win a race). Each hook runs once. `beforeMkdir` sees the target and returns true when it
// acted, so it can wait for the level it cares about.
const openHooks = vi.hoisted(() => ({
  before: undefined as (() => void) | undefined,
  after: undefined as (() => void) | undefined,
  beforeMkdir: undefined as ((target: string) => boolean) | undefined,
  beforeLink: undefined as (() => void) | undefined,
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const step = openHooks.before;
      openHooks.before = undefined;
      step?.();
      const handle = await actual.open(...args);
      const afterStep = openHooks.after;
      openHooks.after = undefined;
      afterStep?.();
      return handle;
    },
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      if (openHooks.beforeMkdir?.(String(args[0])) === true) openHooks.beforeMkdir = undefined;
      return actual.mkdir(...args);
    },
    link: async (...args: Parameters<typeof actual.link>) => {
      const step = openHooks.beforeLink;
      openHooks.beforeLink = undefined;
      step?.();
      return actual.link(...args);
    },
  };
});

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
  openHooks.before = undefined;
  openHooks.after = undefined;
  openHooks.beforeMkdir = undefined;
  openHooks.beforeLink = undefined;
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

  it('issues a frozen root that only this module can make (forged roots are refused)', async () => {
    expect(Object.isFrozen(root)).toBe(true);
    // Shapes a caller could build by hand: a plain object, a copy, a mismatched pair, an
    // object with the right prototype, and the whole drive.
    const drive = path.parse(root.real).root;
    const forged: unknown[] = [
      { given: root.given, real: root.real },
      Object.fromEntries(Object.entries(root)), // a copy of its public fields
      { given: root.given, real: path.dirname(root.real) },
      Object.assign(Object.create(ApprovedRoot.prototype) as object, {
        given: root.given,
        real: root.real,
      }),
      { given: drive, real: drive },
    ];
    for (const fake of forged) {
      const asRoot = fake as ApprovedRoot;
      expect(await refusalOf(resolveInsideRoot(asRoot, 'a.txt'))).toBe('root_unavailable');
      expect(await refusalOf(openInsideRoot(asRoot, 'a.txt', 'read'))).toBe('root_unavailable');
    }
    // Calling the factory without the module's private token fails too.
    expect(() =>
      ApprovedRoot.issue(Symbol('fake') as never, root.given, root.real, {} as never),
    ).toThrow(PathPolicyError);
  });

  it('refuses a root that was replaced by another folder after approval', async () => {
    // Same name, different folder: the root's volume + file ID no longer match.
    renameSync(rootDir, path.join(base, 'Root-old'));
    mkdirSync(rootDir);
    writeFileSync(path.join(rootDir, 'a.txt'), 'impostor');
    expect(await refusalOf(resolveInsideRoot(root, 'a.txt'))).toBe('root_unavailable');
    expect(await refusalOf(openInsideRoot(root, 'a.txt', 'read'))).toBe('root_unavailable');
    expect(await refusalOf(openInsideRoot(root, 'b.txt', 'create'))).toBe('root_unavailable');
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

describe('approveRoot and sensitive folders (SECURITY §13.4)', () => {
  let home: string;
  let sensitiveFolders: SensitiveFolders;

  beforeEach(() => {
    home = path.join(base, 'Home');
    for (const dir of ['Documents', 'Projects', '.ssh'])
      mkdirSync(path.join(home, dir), {
        recursive: true,
      });
    writeFileSync(path.join(home, '.ssh', 'id_ed25519'), 'private key');
    writeFileSync(path.join(home, 'Projects', 'p.txt'), 'project');
    sensitiveFolders = {
      broad: [home, path.join(home, 'Documents')],
      forbidden: [path.join(home, '.ssh')],
    };
  });

  it('accepts an ordinary project folder', async () => {
    const approved = await approveRoot(path.join(home, 'Projects'), { sensitiveFolders });
    expect((await resolveInsideRoot(approved, 'p.txt')).exists).toBe(true);
  });

  it.each([
    ['the home folder', () => home],
    ['Documents', () => path.join(home, 'Documents')],
    ['a folder that contains the home folder', () => base],
  ])('refuses %s unless the caller passes broad', async (_label, make) => {
    expect(await refusalOf(approveRoot(make(), { sensitiveFolders }))).toBe('root_too_broad');
    await expect(approveRoot(make(), { sensitiveFolders, broad: true })).resolves.toBeInstanceOf(
      ApprovedRoot,
    );
  });

  it('refuses a whole drive unless the caller passes broad', async () => {
    const drive = path.parse(base).root;
    const none: SensitiveFolders = { broad: [], forbidden: [] };
    expect(await refusalOf(approveRoot(drive, { sensitiveFolders: none }))).toBe('root_too_broad');
    await expect(
      approveRoot(drive, { sensitiveFolders: none, broad: true }),
    ).resolves.toBeInstanceOf(ApprovedRoot);
  });

  it('never approves a credential folder, even with broad', async () => {
    mkdirSync(path.join(home, '.ssh', 'sub'));
    for (const target of [path.join(home, '.ssh'), path.join(home, '.ssh', 'sub')]) {
      expect(await refusalOf(approveRoot(target, { sensitiveFolders, broad: true }))).toBe(
        'sensitive_folder',
      );
    }
  });

  it('keeps a credential folder refused inside a broad root', async () => {
    const approved = await approveRoot(home, { sensitiveFolders, broad: true });
    expect(await refusalOf(resolveInsideRoot(approved, '.ssh\\id_ed25519'))).toBe(
      'sensitive_folder',
    );
    expect(await refusalOf(openInsideRoot(approved, '.ssh\\id_ed25519', 'read'))).toBe(
      'sensitive_folder',
    );
    expect(await refusalOf(openInsideRoot(approved, '.ssh\\new.txt', 'create'))).toBe(
      'sensitive_folder',
    );
    expect((await resolveInsideRoot(approved, 'Projects\\p.txt')).exists).toBe(true);
  });

  it.skipIf(!IS_WINDOWS)('keeps it refused when reached through a junction', async () => {
    const approved = await approveRoot(home, { sensitiveFolders, broad: true });
    junction(path.join(home, 'Projects', 'keys'), path.join(home, '.ssh'));
    expect(await refusalOf(resolveInsideRoot(approved, 'Projects\\keys\\id_ed25519'))).toBe(
      'sensitive_folder',
    );
  });

  it.skipIf(!IS_WINDOWS)('lists the usual Windows folders by default', () => {
    const user = 'C:\\Users\\u';
    const folders = defaultSensitiveFolders(
      {
        APPDATA: `${user}\\AppData\\Roaming`,
        LOCALAPPDATA: `${user}\\AppData\\Local`,
        OneDrive: `${user}\\OneDrive`,
        ProgramFiles: '',
      },
      user,
    );
    expect(folders.broad).toEqual(
      expect.arrayContaining([
        user,
        `${user}\\Documents`,
        `${user}\\Desktop`,
        `${user}\\Downloads`,
        `${user}\\OneDrive\\Documents`,
        `${user}\\AppData\\Roaming`,
        `${user}\\AppData\\Local`,
      ]),
    );
    expect(folders.forbidden).toEqual(
      expect.arrayContaining([
        `${user}\\.ssh`,
        `${user}\\AppData\\Local\\Google\\Chrome\\User Data`,
        `${user}\\AppData\\Roaming\\Mozilla\\Firefox`,
      ]),
    );
    // Empty or missing variables add nothing.
    expect(folders.broad).not.toContain('');
  });
});

describe('PathPolicyError', () => {
  it('keeps only the OS error code, never the path (L2)', async () => {
    let caught: unknown;
    try {
      await resolveInsideRoot(root, 'missing-folder\\nope.txt');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(PathPolicyError);
    const error = caught as PathPolicyError;
    expect(error.reason).toBe('not_found');
    expect(error.errno).toBe('ENOENT');
    expect(error.cause).toBeUndefined();
    const serialised = JSON.stringify(error) + String(error) + (error.stack ?? '');
    expect(serialised).not.toContain(base);
    expect(serialised).not.toContain('nope.txt');
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

  it.skipIf(!IS_WINDOWS)('creates nothing outside through a dangling junction (H1)', async () => {
    // `report.md` is a junction to a target that doesn't exist yet. realpath fails on it just
    // as on a free name; creating "through" it would build the target outside the root.
    const target = path.join(outsideDir, 'evil.txt');
    junction(path.join(rootDir, 'report.md'), target);
    expect(await refusalOf(openInsideRoot(root, 'report.md', 'create'))).toBe('link_escape');
    expect(await refusalOf(openInsideRoot(root, 'report.md\\x.txt', 'create'))).toBe('link_escape');
    expect(existsSync(target)).toBe(false);
  });

  it('refuses a hard link, whose other name may be outside (M2)', async () => {
    linkSync(path.join(outsideDir, 'secret.txt'), path.join(rootDir, 'hl.txt'));
    expect(await refusalOf(resolveInsideRoot(root, 'hl.txt'))).toBe('hard_link');
    expect(await refusalOf(openInsideRoot(root, 'hl.txt', 'read'))).toBe('hard_link');
    // The re-check refuses it too, even if the first check were skipped.
    const handle = await open(path.join(root.real, 'hl.txt'), 'r');
    try {
      expect(
        await refusalOf(verifyHandleInsideRoot(root, path.join(root.real, 'hl.txt'), handle)),
      ).toBe('hard_link');
    } finally {
      await handle.close();
    }
  });

  describe.skipIf(!IS_WINDOWS)('a folder swapped for a junction right before the open (M1)', () => {
    beforeEach(() => {
      mkdirSync(path.join(rootDir, 'inner'));
    });

    function swapInnerTo(target: string): void {
      rmSync(path.join(rootDir, 'inner'), { recursive: true });
      junction(path.join(rootDir, 'inner'), target);
    }

    it('removes the file it created outside and refuses', async () => {
      const onLeftover = vi.fn();
      openHooks.before = () => {
        swapInnerTo(outsideDir);
      };
      expect(
        await refusalOf(openInsideRoot(root, 'inner\\new.txt', 'create', { onLeftover })),
      ).toBe('changed_during_use');
      expect(existsSync(path.join(outsideDir, 'new.txt'))).toBe(false);
      expect(onLeftover).not.toHaveBeenCalled();
    });

    it('reports instead of deleting when the path no longer leads to its file', async () => {
      // Swapped out before the open, then re-pointed before the cleanup could look: the path now
      // leads to someone else's file, which must not be deleted.
      const other = path.join(base, 'other');
      mkdirSync(other);
      writeFileSync(path.join(other, 'new.txt'), 'not ours');
      const onLeftover = vi.fn();
      openHooks.before = () => {
        swapInnerTo(outsideDir);
      };
      openHooks.after = () => {
        rmSync(path.join(rootDir, 'inner'));
        junction(path.join(rootDir, 'inner'), other);
      };
      expect(
        await refusalOf(openInsideRoot(root, 'inner\\new.txt', 'create', { onLeftover })),
      ).toBe('changed_during_use');
      expect(readFileSync(path.join(other, 'new.txt'), 'utf8')).toBe('not ours');
      expect(onLeftover).toHaveBeenCalledWith({ kind: 'file_left_behind' });
      expect(JSON.stringify(onLeftover.mock.calls)).not.toContain(base);
    });
  });
});

describe.skipIf(!IS_WINDOWS)('8.3 short names', () => {
  /** The Windows short (8.3) form of a folder, or undefined if the volume has none. */
  function shortForm(folder: string): string | undefined {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:ATLAS_P).ShortPath',
      ],
      { env: { ...process.env, ATLAS_P: folder }, encoding: 'utf8' },
    ).trim();
    return out !== '' && out.toLowerCase() !== folder.toLowerCase() ? out : undefined;
  }

  it('accepts a long-form candidate under a root approved by its short name', async (ctx) => {
    const short = shortForm(rootDir);
    if (short === undefined) ctx.skip('this volume has no 8.3 short names');
    const shortRoot = await approveRoot(short ?? rootDir);
    expect(shortRoot.given).toBe(path.resolve(short ?? rootDir));
    const longCandidate = path.join(base, 'Root', 'a.txt');
    expect((await resolveInsideRoot(shortRoot, longCandidate)).real).toBe(
      path.join(root.real, 'a.txt'),
    );
    expect(await refusalOf(resolveInsideRoot(shortRoot, path.join(base, 'Root2', 'x.txt')))).toBe(
      'outside_root',
    );
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
        const held = await verifyHandleInsideRoot(root, innerReal, handle);
        expect(held.isFile()).toBe(true);
        expect(held.nlink).toBe(1n);
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

describe('ensureDirInsideRoot (M4)', () => {
  it('makes missing folders one level at a time, and is idempotent', async () => {
    const real = await ensureDirInsideRoot(root, 'a\\b\\c');
    expect(real).toBe(path.join(root.real, 'a', 'b', 'c'));
    expect(existsSync(path.join(rootDir, 'a', 'b', 'c'))).toBe(true);
    await expect(ensureDirInsideRoot(root, 'a\\b\\c')).resolves.toBe(real);
    await expect(ensureDirInsideRoot(root, '.')).resolves.toBe(root.real);
  });

  it('refuses escapes and a file in the way', async () => {
    expect(await refusalOf(ensureDirInsideRoot(root, '..\\outside\\x'))).toBe('outside_root');
    expect(await refusalOf(ensureDirInsideRoot(root, 'a.txt\\x'))).toBe('not_a_folder');
    expect(await refusalOf(ensureDirInsideRoot(root, 'a.txt'))).toBe('not_a_folder');
  });

  describe.skipIf(!IS_WINDOWS)('links', () => {
    it('makes nothing outside through a junction', async () => {
      junction(path.join(rootDir, 'jn'), outsideDir);
      expect(await refusalOf(ensureDirInsideRoot(root, 'jn\\new'))).toBe('link_escape');
      expect(existsSync(path.join(outsideDir, 'new'))).toBe(false);
    });

    it('makes nothing outside through a dangling junction', async () => {
      const target = path.join(outsideDir, 'planted');
      junction(path.join(rootDir, 'dangling'), target);
      expect(await refusalOf(ensureDirInsideRoot(root, 'dangling'))).toBe('link_escape');
      expect(await refusalOf(ensureDirInsideRoot(root, 'dangling\\x'))).toBe('link_escape');
      expect(existsSync(target)).toBe(false);
    });

    it('removes a folder it made outside when a parent was swapped mid-walk', async () => {
      mkdirSync(path.join(rootDir, 'inner'));
      const onLeftover = vi.fn();
      openHooks.beforeMkdir = (target) => {
        if (path.basename(target) !== 'deep') return false;
        rmSync(path.join(rootDir, 'inner'), { recursive: true });
        junction(path.join(rootDir, 'inner'), outsideDir);
        return true;
      };
      expect(await refusalOf(ensureDirInsideRoot(root, 'inner\\deep', { onLeftover }))).toBe(
        'link_escape',
      );
      expect(existsSync(path.join(outsideDir, 'deep'))).toBe(false);
      expect(onLeftover).not.toHaveBeenCalled();
    });
  });
});

describe('listInsideRoot and walkInsideRoot (M4)', () => {
  beforeEach(() => {
    mkdirSync(path.join(rootDir, 'sub', 'deeper'), { recursive: true });
    writeFileSync(path.join(rootDir, 'sub', 'b.txt'), 'bb');
    writeFileSync(path.join(rootDir, 'sub', 'deeper', 'c.txt'), 'ccc');
  });

  it('lists names, kinds and sizes, sorted', async () => {
    const listing = await listInsideRoot(root, '.');
    expect(listing.real).toBe(root.real);
    expect(listing.omittedCount).toBe(0);
    expect(listing.entries).toEqual([
      { name: 'a.txt', kind: 'file', size: 6, hardLinked: false },
      { name: 'sub', kind: 'folder', size: 0, hardLinked: false },
    ]);
  });

  it('reports links and hard links without following them', async () => {
    linkSync(path.join(outsideDir, 'secret.txt'), path.join(rootDir, 'hl.txt'));
    if (IS_WINDOWS) junction(path.join(rootDir, 'jn'), outsideDir);
    const { entries } = await listInsideRoot(root, '.');
    expect(entries.find((entry) => entry.name === 'hl.txt')).toMatchObject({
      kind: 'file',
      hardLinked: true,
    });
    if (IS_WINDOWS) {
      expect(entries.find((entry) => entry.name === 'jn')).toMatchObject({ kind: 'link' });
      expect(await refusalOf(listInsideRoot(root, 'jn'))).toBe('link_escape');
    }
    expect(entries.map((entry) => entry.name)).not.toContain('secret.txt');
  });

  it('is bounded: the rest is counted, not returned', async () => {
    for (let i = 0; i < 5; i += 1) writeFileSync(path.join(rootDir, `n${String(i)}.txt`), '');
    const listing = await listInsideRoot(root, '.', { maxEntries: 3 });
    expect(listing.entries).toHaveLength(3);
    expect(listing.omittedCount).toBe(4); // a.txt, sub and n0..n4 = 7 entries
  });

  it('refuses a file and a path outside', async () => {
    expect(await refusalOf(listInsideRoot(root, 'a.txt'))).toBe('not_a_folder');
    expect(await refusalOf(listInsideRoot(root, '..\\outside'))).toBe('outside_root');
  });

  it('walks the tree with relative paths', async () => {
    const result = await walkInsideRoot(root, '.');
    expect(result.complete).toBe(true);
    expect(result.entries.map((entry) => entry.relativePath)).toEqual([
      'a.txt',
      'sub',
      'sub\\b.txt',
      'sub\\deeper',
      'sub\\deeper\\c.txt',
    ]);
  });

  it.skipIf(!IS_WINDOWS)('never enters a junction, even one that stays inside', async () => {
    junction(path.join(rootDir, 'loop'), rootDir); // would recurse forever if followed
    junction(path.join(rootDir, 'out'), outsideDir);
    const result = await walkInsideRoot(root, '.');
    const paths = result.entries.map((entry) => entry.relativePath);
    expect(paths).toContain('loop');
    expect(paths).toContain('out');
    expect(paths.some((p) => p.startsWith('loop\\') || p.startsWith('out\\'))).toBe(false);
    expect(result.complete).toBe(true);
  });

  it('says when depth or size limits stopped it', async () => {
    const shallow = await walkInsideRoot(root, '.', { maxDepth: 0 });
    expect(shallow.entries.map((entry) => entry.relativePath)).toEqual(['a.txt', 'sub']);
    expect(shallow.complete).toBe(false);
    const small = await walkInsideRoot(root, '.', { maxEntries: 3 });
    expect(small.entries).toHaveLength(3);
    expect(small.complete).toBe(false);
  });
});

describe('writeFileInsideRoot (M4)', () => {
  beforeEach(() => {
    mkdirSync(path.join(rootDir, 'out'));
  });

  it('writes a new file and leaves no temp file behind', async () => {
    const real = await writeFileInsideRoot(root, 'out\\result.md', '# result');
    expect(real).toBe(path.join(root.real, 'out', 'result.md'));
    expect(readFileSync(path.join(rootDir, 'out', 'result.md'), 'utf8')).toBe('# result');
    expect(readdirSync(path.join(rootDir, 'out'))).toEqual(['result.md']);
    // The final file has one name, so it can be read back through the policy.
    const { handle } = await openInsideRoot(root, 'out\\result.md', 'read');
    await handle.close();
  });

  it('never overwrites, and leaves the existing file as it was', async () => {
    writeFileSync(path.join(rootDir, 'out', 'result.md'), 'first');
    expect(await refusalOf(writeFileInsideRoot(root, 'out\\result.md', 'second'))).toBe(
      'already_exists',
    );
    expect(readFileSync(path.join(rootDir, 'out', 'result.md'), 'utf8')).toBe('first');
    expect(readdirSync(path.join(rootDir, 'out'))).toEqual(['result.md']);
  });

  it('loses the race cleanly when the name is taken during the write', async () => {
    openHooks.beforeLink = () => {
      writeFileSync(path.join(rootDir, 'out', 'result.md'), 'winner');
    };
    expect(await refusalOf(writeFileInsideRoot(root, 'out\\result.md', 'loser'))).toBe(
      'already_exists',
    );
    expect(readFileSync(path.join(rootDir, 'out', 'result.md'), 'utf8')).toBe('winner');
    expect(readdirSync(path.join(rootDir, 'out'))).toEqual(['result.md']);
  });

  it('needs the parent folder to exist', async () => {
    expect(await refusalOf(writeFileInsideRoot(root, 'missing\\result.md', 'x'))).toBe('not_found');
  });

  it.skipIf(!IS_WINDOWS)('removes what it made when the folder was moved outside', async () => {
    // Right before the final link, the whole `out` folder (with the temp file) is moved
    // outside and replaced by a junction to it, so the link lands outside the root.
    const moved = path.join(outsideDir, 'moved');
    const onLeftover = vi.fn();
    openHooks.beforeLink = () => {
      renameSync(path.join(rootDir, 'out'), moved);
      junction(path.join(rootDir, 'out'), moved);
    };
    expect(
      await refusalOf(writeFileInsideRoot(root, 'out\\result.md', 'data', { onLeftover })),
    ).toBe('changed_during_use');
    expect(readdirSync(moved)).toEqual([]);
    expect(onLeftover).not.toHaveBeenCalled();
  });
});

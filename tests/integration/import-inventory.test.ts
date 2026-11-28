// Import inventory on real temp folders (M3-16 #126, TEST_PLAN §22.2 #30). The path policy is
// wrapped with spies so the tests can prove what was opened and listed, not just what was
// returned: excluded content must stay unread and links must never be entered.
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { classifyFolder, CONTENT_CAMPAIGN_TEMPLATE } from '../../src/common/import/classify';
import {
  INVENTORY_MAX_DEPTH,
  INVENTORY_MAX_ENTRIES,
  INVENTORY_MAX_TEXT_BYTES,
  inventoryFolder,
  toClassifyInput,
} from '../../src/main/import/inventory';
import * as pathPolicy from '../../src/main/security/path-policy';

vi.mock('../../src/main/security/path-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/security/path-policy')>();
  return {
    ...actual,
    openInsideRoot: vi.fn(actual.openInsideRoot),
    listInsideRoot: vi.fn(actual.listInsideRoot),
  };
});

const IS_WINDOWS = process.platform === 'win32';
const NO_SENSITIVE = { broad: [], broadTrees: [], forbidden: [] };

let base: string;
let rootDir: string;

function write(relative: string, content: string | Uint8Array = 'x'): void {
  const file = path.join(rootDir, relative);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

async function inventory() {
  const root = await pathPolicy.approveRoot(rootDir, { sensitiveFolders: NO_SENSITIVE });
  return inventoryFolder(root);
}

/** Relative paths the inventory opened as files, "/" separated. */
function opened(): string[] {
  return vi
    .mocked(pathPolicy.openInsideRoot)
    .mock.calls.map(([, candidate]) => candidate.replaceAll('\\', '/'));
}

/** Relative folders the inventory listed ("." is the root). */
function listed(): string[] {
  return vi
    .mocked(pathPolicy.listInsideRoot)
    .mock.calls.map(([, candidate]) => candidate.replaceAll('\\', '/'));
}

beforeEach(() => {
  vi.mocked(pathPolicy.openInsideRoot).mockClear();
  vi.mocked(pathPolicy.listInsideRoot).mockClear();
  base = mkdtempSync(path.join(tmpdir(), 'atlas-inventory-'));
  rootDir = path.join(base, 'Project');
  mkdirSync(rootDir);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe('inventoryFolder: a marketing folder', () => {
  it('lists the files and suggests Content Campaign from the evidence', async () => {
    write('README.md', 'Spring launch: social posts and a newsletter.');
    write('brief.md');
    write('content-calendar.csv');
    write('drafts/post-1.md');
    write('assets/logo.png');

    const result = await inventory();
    expect(result.complete).toBe(true);
    expect(result.entries.map((e) => e.relativePath).sort()).toEqual([
      'README.md',
      'assets',
      'assets/logo.png',
      'brief.md',
      'content-calendar.csv',
      'drafts',
      'drafts/post-1.md',
    ]);
    const classification = classifyFolder(toClassifyInput(result));
    expect(classification.templateId).toBe(CONTENT_CAMPAIGN_TEMPLATE);
    expect(classification.evidence.length).toBeGreaterThan(0);
    // Only the README was read; ordinary files are listed, not opened.
    expect(opened()).toEqual(['README.md']);
  });
});

// TEST_PLAN §22.2 #30: secrets, dependencies, link escapes and scripts.
describe('inventoryFolder: excluded content stays unread and nothing runs', () => {
  beforeEach(() => {
    write('README.md', 'Run install.cmd first.');
    write('brief.md');
    write('.env', 'API_KEY=do-not-read');
    write('.env.local', 'TOKEN=do-not-read');
    write('keys/id_rsa', 'PRIVATE KEY');
    write('keys/server.pem', 'PRIVATE KEY');
    write('.npmrc', '//registry/:_authToken=do-not-read');
    write('node_modules/left-pad/index.js', 'module.exports = 1');
    write('.git/config', '[core]');
    write('.git/hooks/pre-commit', 'echo ran > %TEMP%\\hook-ran');
    // A script whose only effect would be the marker file next to it.
    write('install.cmd', `echo ran > "${path.join(base, 'script-ran.txt')}"`);
    write('package.json', JSON.stringify({ scripts: { postinstall: 'node install.js' } }));
    mkdirSync(path.join(base, 'outside'));
    writeFileSync(path.join(base, 'outside', 'secret.txt'), 'outside secret');
  });

  it('never opens secrets, never enters dependencies or .git, and runs nothing', async () => {
    const result = await inventory();

    // Opened: only the README. Never .env, keys, .npmrc or anything in node_modules or .git.
    expect(opened()).toEqual(['README.md']);
    // Listed: never node_modules or .git (they are excluded before entering).
    expect(listed()).not.toContain('node_modules');
    expect(listed()).not.toContain('.git');
    expect(listed().some((folder) => folder.startsWith('node_modules'))).toBe(false);

    const paths = result.entries.map((e) => e.relativePath);
    for (const secret of ['.env', '.env.local', 'keys/id_rsa', 'keys/server.pem', '.npmrc']) {
      expect(paths).not.toContain(secret);
    }
    // Scripts are inventoried as plain files and nothing executes.
    expect(paths).toContain('install.cmd');
    expect(existsSync(path.join(base, 'script-ran.txt'))).toBe(false);

    const byRule = Object.fromEntries(result.excluded.map((g) => [g.rule, g.count]));
    expect(byRule).toMatchObject({
      dependencies: 1,
      version_control: 1,
      environment_file: 2,
      private_key: 2,
      credentials_file: 1,
    });
    expect(result.rulesApplied).toContain('Private keys and certificates');
    // The README's instruction is just text: it changed nothing above.
  });

  it.skipIf(!IS_WINDOWS)('lists a junction out of the root but never follows it', async () => {
    symlinkSync(path.join(base, 'outside'), path.join(rootDir, 'linked'), 'junction');
    const result = await inventory();
    expect(result.entries).toContainEqual(
      expect.objectContaining({ relativePath: 'linked', kind: 'link' }),
    );
    expect(result.linksNotFollowed).toBe(1);
    expect(listed()).not.toContain('linked');
    expect(opened().some((file) => file.startsWith('linked'))).toBe(false);
    expect(result.entries.some((e) => e.relativePath.startsWith('linked/'))).toBe(false);
  });
});

describe('inventoryFolder: .gitignore', () => {
  it('honours root and nested .gitignore files and reports the rule', async () => {
    write('.gitignore', 'exports/\n*.log\n!keep.log\n[[:alpha:]].tmp\n');
    write('exports/big.zip');
    write('debug.log');
    write('keep.log');
    write('data/.gitignore', '*.csv\n');
    write('data/rows.csv');
    write('data/notes.md');

    const result = await inventory();
    const paths = result.entries.map((e) => e.relativePath);
    expect(paths).toContain('keep.log');
    expect(paths).toContain('data/notes.md');
    expect(paths).not.toContain('debug.log');
    expect(paths).not.toContain('data/rows.csv');
    expect(paths).not.toContain('exports');
    expect(listed()).not.toContain('exports');
    const gitignore = result.excluded.find((g) => g.rule === 'gitignore');
    expect(gitignore?.count).toBe(3);
    expect(result.gitignoreSkippedLines).toBe(1);
    // The .gitignore files themselves are hidden and not listed as project files.
    expect(paths).not.toContain('.gitignore');
  });
});

describe('inventoryFolder: limits give a partial result with a note', () => {
  // Creates 5,001 real files: slow when the whole suite runs in parallel, hence the timeout.
  it(`stops at ${String(INVENTORY_MAX_ENTRIES)} entries`, { timeout: 30_000 }, async () => {
    mkdirSync(path.join(rootDir, 'many'));
    for (let i = 0; i <= INVENTORY_MAX_ENTRIES; i++) {
      writeFileSync(path.join(rootDir, 'many', `f${String(i).padStart(5, '0')}.md`), '');
    }
    const result = await inventory();
    expect(result.entries).toHaveLength(INVENTORY_MAX_ENTRIES);
    expect(result.complete).toBe(false);
    expect(result.narrowed.map((n) => n.reason)).toContain('entry_limit');
    expect(result.narrowed[0]?.message).toMatch(/Choose a smaller folder/);
  });

  it(`doesn't open folders more than ${String(INVENTORY_MAX_DEPTH)} levels deep`, async () => {
    const deep = Array.from({ length: INVENTORY_MAX_DEPTH + 2 }, (_, i) => `d${String(i)}`);
    write(`${deep.join('/')}/bottom.md`);
    const result = await inventory();
    expect(result.complete).toBe(false);
    expect(result.narrowed.map((n) => n.reason)).toEqual(['depth_limit']);
    expect(result.entries.some((e) => e.relativePath.endsWith('bottom.md'))).toBe(false);
  });

  it('does not read a README larger than 5 MB', async () => {
    write('README.md', new Uint8Array(INVENTORY_MAX_TEXT_BYTES + 1).fill(0x61));
    const result = await inventory();
    expect(result.readmes).toEqual([]);
    expect(result.narrowed).toEqual([
      { reason: 'text_too_large', message: '1 text file was larger than 5 MB and not read.' },
    ]);
  });

  it('reads a README with a byte-order mark without the mark', async () => {
    write('README.md', `${String.fromCodePoint(0xfeff)}campaign brief`);
    const result = await inventory();
    expect(result.readmes).toEqual([{ path: 'README.md', text: 'campaign brief' }]);
  });

  it('skips a README that is not UTF-8 text', async () => {
    write('README.md', new Uint8Array([0xff, 0xfe, 0x00, 0xd8]));
    const result = await inventory();
    expect(result.readmes).toEqual([]);
    expect(result.narrowed.map((n) => n.reason)).toEqual(['unreadable']);
  });

  it('lists a hard-linked README but does not read it', async () => {
    writeFileSync(path.join(base, 'elsewhere.md'), 'campaign brief');
    linkSync(path.join(base, 'elsewhere.md'), path.join(rootDir, 'README.md'));
    const result = await inventory();
    expect(result.entries).toContainEqual(
      expect.objectContaining({ relativePath: 'README.md', hardLinked: true }),
    );
    expect(result.readmes).toEqual([]);
    expect(result.narrowed.map((n) => n.reason)).toEqual(['unreadable']);
  });
});

describe('inventoryFolder: a software folder', () => {
  it('suggests Generic with a note', async () => {
    write('package.json', '{}');
    write('README.md', 'A command-line tool.');
    for (const name of ['a', 'b', 'c', 'd', 'e']) write(`src/${name}.ts`);
    const classification = classifyFolder(toClassifyInput(await inventory()));
    expect(classification.kind).toBe('software');
    expect(classification.notes[0]).toMatch(/running or building code isn't available/);
  });
});

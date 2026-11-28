// Import exclusions (IMPORT_SPEC §33.6; M3-16 #126): what an import inventory leaves alone.
//
// An excluded folder is never entered and an excluded file is never opened; only its name is
// counted under the rule that excluded it, so the review can say "12 files excluded: private
// keys". Three layers, checked in this order:
//   1. Built-in rules with names (dependencies, version control, build output, caches,
//      temporary files, Obsidian internals, environment files, private keys, credential files,
//      system files). A .gitignore can't switch these off: `!.env` never makes .env readable.
//   2. .gitignore rules from the folder and its parents, with Git's "last match wins".
//   3. Hidden entries (a name starting with "."), excluded unless the user selects them later.
//
// Pure module: no filesystem access. The inventory walk (inventory.ts) feeds it names.

/** Why an entry was left out. Stable codes, shown through RULE_LABELS. */
export type ExclusionRule =
  | 'dependencies'
  | 'version_control'
  | 'build_output'
  | 'cache'
  | 'temporary'
  | 'obsidian_internals'
  | 'environment_file'
  | 'private_key'
  | 'credentials_file'
  | 'system_file'
  | 'gitignore'
  | 'hidden';

/** Plain labels for the review screen. */
export const RULE_LABELS: Readonly<Record<ExclusionRule, string>> = {
  dependencies: 'Installed dependencies (node_modules, virtual environments)',
  version_control: 'Version control internals (.git)',
  build_output: 'Build output (dist, build, out, …)',
  cache: 'Caches',
  temporary: 'Temporary files and folders',
  obsidian_internals: 'Obsidian settings and plugins (.obsidian)',
  environment_file: 'Environment files (.env), which often hold secrets',
  private_key: 'Private keys and certificates',
  credentials_file: 'Files that usually hold tokens or passwords',
  system_file: 'System files (Thumbs.db, desktop.ini, …)',
  gitignore: 'Listed in a .gitignore file',
  hidden: 'Hidden files and folders',
};

export type EntryKind = 'file' | 'folder';

/** Folder names per rule, compared without ASCII case (Windows names ignore case). */
const FOLDER_RULES: readonly (readonly [ExclusionRule, readonly string[]])[] = [
  [
    'dependencies',
    ['node_modules', 'bower_components', 'jspm_packages', '.venv', 'venv', '__pypackages__'],
  ],
  ['version_control', ['.git', '.svn', '.hg']],
  [
    'build_output',
    ['dist', 'build', 'out', 'target', 'bin', 'obj', '.next', '.nuxt', '.svelte-kit', 'coverage'],
  ],
  [
    'cache',
    ['.cache', '__pycache__', '.pytest_cache', '.mypy_cache', '.parcel-cache', '.turbo', '.gradle'],
  ],
  ['temporary', ['tmp', 'temp', '.tmp']],
  ['obsidian_internals', ['.obsidian']],
];

/** File names that usually hold tokens or passwords (a superset of the path policy's list). */
const CREDENTIAL_FILES: ReadonlySet<string> = new Set([
  '.git-credentials',
  '.npmrc',
  '.yarnrc.yml',
  '.netrc',
  '_netrc',
  '.pypirc',
  'credentials.json',
  'credentials.toml',
  'secrets.json',
]);

const PRIVATE_KEY_NAMES: ReadonlySet<string> = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);
const PRIVATE_KEY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pem',
  '.key',
  '.p12',
  '.pfx',
  '.ppk',
  '.jks',
  '.keystore',
]);

const SYSTEM_FILES: ReadonlySet<string> = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);

function foldAscii(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : foldAscii(name.slice(dot));
}

/** The built-in rule that excludes this entry, if any. */
export function defaultExclusion(name: string, kind: EntryKind): ExclusionRule | undefined {
  const lower = foldAscii(name);
  if (kind === 'folder') {
    for (const [rule, names] of FOLDER_RULES) if (names.includes(lower)) return rule;
    return undefined;
  }
  if (lower === '.env' || lower.startsWith('.env.') || lower === '.envrc') {
    return 'environment_file';
  }
  if (PRIVATE_KEY_NAMES.has(lower) || PRIVATE_KEY_EXTENSIONS.has(extensionOf(lower))) {
    // `id_rsa.pub` is a public key and harmless, but it sits next to the private one and
    // proves nothing about the project: excluded too.
    return 'private_key';
  }
  if (PRIVATE_KEY_NAMES.has(lower.replace(/\.pub$/, ''))) return 'private_key';
  if (CREDENTIAL_FILES.has(lower)) return 'credentials_file';
  if (SYSTEM_FILES.has(lower)) return 'system_file';
  if (lower.endsWith('.tmp') || lower.startsWith('~$')) return 'temporary';
  return undefined;
}

// ---- .gitignore ------------------------------------------------------------------------

/** One parsed .gitignore line. */
export interface IgnoreRule {
  /** Folder of the .gitignore, relative to the import root with "/" separators ("" = root). */
  readonly base: string;
  readonly negate: boolean;
  /** A trailing "/" in the pattern: matches folders only. */
  readonly folderOnly: boolean;
  /** Matched against the path below `base` (pattern had a "/"), else against the name. */
  readonly anchored: boolean;
  readonly regex: RegExp;
}

export interface ParsedGitignore {
  readonly rules: readonly IgnoreRule[];
  /** Lines this matcher doesn't understand (for example POSIX classes like [[:alpha:]]). */
  readonly skippedLines: number;
}

/** Most rules taken from one .gitignore; the rest are skipped, so a huge file stays cheap. */
const MAX_RULES_PER_FILE = 1_000;
const MAX_PATTERN_CHARS = 500;

/**
 * Turns a glob into a regular expression with Git's rules: `*` and `?` stay inside one folder
 * name, `**` spans folders, `[abc]` / `[!abc]` are character classes. Returns undefined for a
 * pattern this matcher doesn't understand.
 */
function globToRegex(glob: string): RegExp | undefined {
  let out = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i] ?? '';
    if (char === '*') {
      if (glob[i + 1] === '*') {
        const atStart = i === 0 || glob[i - 1] === '/';
        const atEnd = i + 2 === glob.length;
        if (atStart && glob[i + 2] === '/') {
          out += '(?:.*/)?'; // "**/" : any number of folders, including none
          i += 2;
        } else if (atStart && atEnd) {
          out += '.*'; // trailing "/**" : everything inside
          i += 1;
        } else {
          return undefined; // "a**b": not meaningful in Git; don't guess
        }
      } else {
        out += '[^/]*';
      }
    } else if (char === '?') {
      out += '[^/]';
    } else if (char === '[') {
      const close = glob.indexOf(']', i + 2);
      if (close === -1) return undefined;
      let body = glob.slice(i + 1, close);
      if (body.startsWith('[:') || body.includes('[:')) return undefined; // POSIX classes
      const negated = body.startsWith('!') || body.startsWith('^');
      if (negated) body = body.slice(1);
      if (body === '') return undefined;
      out += `[${negated ? '^' : ''}${body.replace(/[\\\]]/g, '\\$&')}]`;
      i = close;
    } else if (char === '\\') {
      const next = glob[i + 1];
      if (next === undefined) return undefined;
      out += next.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      i += 1;
    } else {
      out += char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    }
  }
  // Case-insensitive, as Git is on Windows (core.ignorecase).
  return new RegExp(`^${out}$`, 'i');
}

/** Parses one .gitignore file found in folder `base` (relative to the import root). */
export function parseGitignore(text: string, base: string): ParsedGitignore {
  const rules: IgnoreRule[] = [];
  let skippedLines = 0;
  for (const rawLine of text.split('\n')) {
    let line = rawLine.replace(/\r$/, '');
    // Trailing spaces are dropped unless escaped with a backslash.
    if (!line.endsWith('\\ ')) line = line.replace(/ +$/, '');
    if (line === '' || line.startsWith('#')) continue;
    if (rules.length >= MAX_RULES_PER_FILE || line.length > MAX_PATTERN_CHARS) {
      skippedLines += 1;
      continue;
    }
    let negate = false;
    if (line.startsWith('!')) {
      negate = true;
      line = line.slice(1);
    } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
      line = line.slice(1);
    }
    let folderOnly = false;
    if (line.endsWith('/')) {
      folderOnly = true;
      line = line.slice(0, -1);
    }
    // A "/" anywhere but the end anchors the pattern to the .gitignore's folder.
    const anchored = line.includes('/');
    if (line.startsWith('/')) line = line.slice(1);
    const regex = line === '' ? undefined : globToRegex(line);
    if (regex === undefined) {
      skippedLines += 1;
      continue;
    }
    rules.push({ base, negate, folderOnly, anchored, regex });
  }
  return { rules, skippedLines };
}

/**
 * Whether .gitignore rules ignore `relativePath` (from the import root, "/" separators).
 * Git's rule: the last matching line wins, and `!` re-includes. Rules only see paths below
 * their own folder. Contents of an ignored folder are never reached (the walk doesn't enter
 * it), which matches Git: a file can't be re-included if a parent folder is excluded.
 */
export function isIgnoredByGitignore(
  rules: readonly IgnoreRule[],
  relativePath: string,
  kind: EntryKind,
): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (rule.folderOnly && kind !== 'folder') continue;
    let below: string;
    if (rule.base === '') {
      below = relativePath;
    } else if (relativePath.startsWith(`${rule.base}/`)) {
      below = relativePath.slice(rule.base.length + 1);
    } else {
      continue;
    }
    const subject = rule.anchored ? below : below.slice(below.lastIndexOf('/') + 1);
    if (rule.regex.test(subject)) ignored = !rule.negate;
  }
  return ignored;
}

/**
 * The rule that excludes an entry, or undefined when it is kept. Built-in rules come first
 * and can't be undone by a .gitignore; hidden entries come last.
 */
export function exclusionFor(
  relativePath: string,
  name: string,
  kind: EntryKind,
  gitignore: readonly IgnoreRule[],
): ExclusionRule | undefined {
  const builtIn = defaultExclusion(name, kind);
  if (builtIn !== undefined) return builtIn;
  if (isIgnoredByGitignore(gitignore, relativePath, kind)) return 'gitignore';
  if (name.startsWith('.')) return 'hidden';
  return undefined;
}

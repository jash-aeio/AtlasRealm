// Path policy (SECURITY §13.4; M3-9 #119): the one place that decides whether a path is inside
// an approved root folder. File tools (M3-13), artifact storage (M3-12) and imports (M3-16)
// all ask here before touching a file.
//
// Why not compare strings? `C:\root2\x` starts with the text `C:\root` but is not inside it,
// and a junction (a folder shortcut any user can create on Windows) inside the root can lead
// anywhere on the disk. So the decision is made on *real* paths: Windows resolves every link and
// tells us where a path really ends up (`realpath.native`), and that answer is what we compare.
//
// Three layers, each refusing with a typed reason:
//   1. Shape (no disk access): UNC and device paths, Windows device names, alternate data
//      streams, NUL bytes and drive-relative forms are refused outright.
//   2. Containment: the candidate must stay inside the root as written (no `..` or drive
//      changes), and again after Windows resolves every junction and symlink. A file with more
//      than one name (a hard link) is refused: its other name may be outside the root.
//   3. Re-check at use (openInsideRoot): a link can be swapped between the check and the open
//      (TOCTOU, "time of check to time of use"). After opening, we compare the identity of the
//      file we actually hold (volume + file ID from the handle) with the file the path now
//      leads to. Node can't ask Windows for an open handle's path, but identity gives the same
//      guarantee: if they differ, the handle is closed and the open is refused.
//
// The root itself is trusted only as an ApprovedRoot that approveRoot issued (#142): the class
// can't be built or faked elsewhere, so a caller can't hand in `{ real: 'C:\\' }`. It also pins
// the root folder's identity, so a folder renamed away and replaced by a new one with the same
// name is not trusted. Approve again from the database each time; never store the object.
//
// Callers never need `fs` on a user path: ensureDirInsideRoot, listInsideRoot, walkInsideRoot
// and writeFileInsideRoot cover folders, listings and safe writes (M4, #142). A lint rule keeps
// `node:fs` out of new main-process files.
//
// Errors carry a reason and a fixed message, never a path: the outside path can contain the
// Windows user name and must not reach the renderer (SECURITY §21.3).
import { randomUUID } from 'node:crypto';
import { type BigIntStats, constants as fsConstants, realpath as realpathCallback } from 'node:fs';
import {
  type FileHandle,
  link,
  lstat,
  mkdir,
  open,
  opendir,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// The OS's own answer (GetFinalPathNameByHandle on Windows): follows junctions and symlinks and
// returns each folder's stored casing. Only the callback API has .native, so it is promisified.
const realpathNative = promisify(realpathCallback.native);

/** Why a path was refused. Stable codes: later IPC errors and audit records use them. */
export type PathRefusal =
  | 'invalid_path' // empty, NUL byte, too long, drive-relative (`C:file`), trailing dot/space
  | 'unc_path' // `\\server\share\...`: network locations are never approved roots
  | 'device_path' // `\\.\`, `\\?\` or a Windows device name such as CON, NUL, COM1
  | 'alternate_data_stream' // `file.txt:stream`, hidden extra content on NTFS
  | 'outside_root' // `..` or another drive leaves the root as written
  | 'link_escape' // a junction or symlink leads out of the root
  | 'root_unavailable' // the root itself is missing, not a folder, unsafe, or not issued here
  | 'root_too_broad' // a whole drive, the home folder, Documents, AppData, ... (needs `broad`)
  | 'sensitive_folder' // browser profiles and credential folders: never readable or writable
  | 'sensitive_file' // a file name that usually holds tokens (.npmrc, .git-credentials, ...)
  | 'not_found' // the file (or a parent folder) doesn't exist
  | 'inaccessible' // the OS refused to resolve it (permissions, too many links, ...)
  | 'not_a_file' // a folder or device where a file was expected
  | 'not_a_folder' // a file or device where a folder was expected
  | 'hard_link' // the file has more than one name, so it may also live outside the root
  | 'already_exists' // create-only open, and something is already there
  | 'changed_during_use'; // the path led somewhere else by the time the file was opened

const MESSAGES: Readonly<Record<PathRefusal, string>> = {
  invalid_path: 'That file path is not valid.',
  unc_path: 'Network locations are not allowed here.',
  device_path: 'Device paths and reserved Windows names are not allowed.',
  alternate_data_stream: 'Hidden file streams are not allowed.',
  outside_root: 'That file is outside the allowed folder.',
  link_escape: 'That path follows a link out of the allowed folder.',
  root_unavailable: 'The allowed folder is missing or cannot be used.',
  root_too_broad: 'That folder is too broad to allow without an explicit choice.',
  sensitive_folder: 'That folder holds browser or credential data and cannot be used.',
  sensitive_file: 'That file can hold credentials and cannot be used.',
  not_found: 'That file does not exist.',
  inaccessible: 'That file cannot be accessed.',
  not_a_file: 'That path is not a file.',
  not_a_folder: 'That path is not a folder.',
  hard_link: 'That file is linked to another location and cannot be used.',
  already_exists: 'A file with that name already exists.',
  changed_during_use: 'The file changed while it was being opened. Nothing was read or written.',
};

/**
 * A refused path. `message` is fixed text, safe to show; it never contains a path. The OS error
 * behind a refusal is kept only as its code (`errno`, e.g. `ENOENT`), never as `cause`: Node's
 * errors carry the full path in `message` and `path`, which would leak if the error were logged
 * or serialised.
 */
export class PathPolicyError extends Error {
  override readonly name = 'PathPolicyError';
  /** The OS error code behind the refusal, if any. Never a path. */
  readonly errno: string | undefined;
  constructor(
    readonly reason: PathRefusal,
    osError?: unknown,
  ) {
    super(MESSAGES[reason]);
    const code = (osError as NodeJS.ErrnoException | undefined)?.code;
    this.errno = typeof code === 'string' && /^[A-Z0-9_]{1,32}$/.test(code) ? code : undefined;
  }
}

/** Longest path accepted. Generous for real files, small enough to bound the checks. */
export const MAX_PATH_CHARS = 4_096;
/** Upper bound on parent folders walked up while looking for one that exists. */
const MAX_MISSING_DEPTH = 64;

const IS_WINDOWS = process.platform === 'win32';

// Device names Windows reserves in every folder, matched on the part before the first dot,
// after trailing dots and spaces are dropped (as Windows does): `nul.txt` and `CON .md` are
// devices too. Superscript digits count as well (`COM¹`), and so do CONIN$ / CONOUT$.
const DEVICE_NAME = /^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[0-9¹²³]|LPT[0-9¹²³])$/i;

function isDeviceName(segment: string): boolean {
  const stem = segment.replace(/[. ]+$/, '').split('.', 1)[0] ?? '';
  return DEVICE_NAME.test(stem.trimEnd());
}

/**
 * Checks a path's shape without touching the disk. Returns the refusal, or undefined when the
 * shape is acceptable (containment is checked separately). Applied on every platform: the app
 * targets Windows, and refusing these forms elsewhere costs nothing.
 */
export function pathShapeProblem(candidate: string): PathRefusal | undefined {
  if (candidate.length === 0 || candidate.length > MAX_PATH_CHARS) return 'invalid_path';
  if (candidate.includes('\0')) return 'invalid_path';
  const slashed = candidate.replaceAll('/', '\\');
  // `\\.\` (devices) and `\\?\` (raw paths that skip Windows' own checks), in any slash mix.
  if (/^\\\\[.?]\\/.test(slashed) || /^\\\\[.?]$/.test(slashed)) return 'device_path';
  if (slashed.startsWith('\\\\')) return 'unc_path';
  // A colon is only allowed as the drive separator, `C:\`. `C:file` means "relative to drive
  // C's current folder", which depends on process state; any other colon names a stream.
  const hasDrive = /^[A-Za-z]:/.test(slashed);
  if (hasDrive && slashed.length > 2 && slashed[2] !== '\\') return 'invalid_path';
  if (hasDrive && slashed.length === 2) return 'invalid_path';
  if (slashed.indexOf(':', hasDrive ? 2 : 0) !== -1) return 'alternate_data_stream';
  const segments = slashed.split('\\').slice(hasDrive ? 1 : 0);
  for (const segment of segments) {
    if (segment === '' || segment === '.' || segment === '..') continue;
    if (isDeviceName(segment)) return 'device_path';
    // Windows silently drops trailing dots and spaces, so `a.` would mean `a`.
    if (/[. ]$/.test(segment)) return 'invalid_path';
  }
  return undefined;
}

/**
 * Folds ASCII letters only, for the quick check on paths as written. Full Unicode folding is
 * avoided on purpose: `ß` upper-cases to `SS`, which could make two different folders match.
 */
function foldAscii(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

/**
 * True when `child` is `parent` or inside it, comparing whole segments (so `C:\root2` is not
 * inside `C:\root`). `caseInsensitive` folds ASCII case for paths as written; real paths from
 * the OS are compared exactly, because Windows returns each folder's stored casing.
 */
function isWithin(parent: string, child: string, caseInsensitive: boolean): boolean {
  const fold = caseInsensitive ? foldAscii : (value: string) => value;
  const base = fold(parent.endsWith(path.sep) ? parent : parent + path.sep);
  const target = fold(child.endsWith(path.sep) ? child : child + path.sep);
  return target.startsWith(base);
}

function refusalOf(error: unknown): PathRefusal {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' ? 'not_found' : 'inaccessible';
}

/** What approveRoot remembers about a root, out of reach of callers. */
interface RootState {
  /** Volume and file ID of the root folder when it was approved (L3: a replaced root fails). */
  readonly dev: bigint;
  readonly ino: bigint;
  /** Sensitive folders inside this root (only possible for a `broad` root): always refused. */
  readonly excluded: readonly string[];
}

// Set inside the class's static block, which is the only code that can see `#state` and call
// the constructor with the token. Neither is reachable from outside this module.
let rootStateOf: (root: unknown) => RootState | undefined;
let issueRoot: (given: string, real: string, state: RootState) => ApprovedRoot;
const ISSUE = Symbol('ApprovedRoot.issue');

/**
 * A root folder that passed approveRoot. Only approveRoot can make one: the constructor demands
 * a module-private token, and every function here checks the private `#state` field, which a
 * copied or hand-built object can't have. Instances are frozen.
 */
export class ApprovedRoot {
  readonly #state: RootState;
  /**
   * @param given The root as given, made absolute.
   * @param real Where the root really is, after Windows resolved every link.
   */
  private constructor(
    token: typeof ISSUE,
    readonly given: string,
    readonly real: string,
    state: RootState,
  ) {
    if (token !== ISSUE) throw new PathPolicyError('root_unavailable');
    this.#state = state;
    Object.freeze(this);
  }

  static {
    rootStateOf = (root) =>
      typeof root === 'object' && root !== null && #state in root ? root.#state : undefined;
    issueRoot = (given, real, state) => new ApprovedRoot(ISSUE, given, real, state);
  }
}
// Nothing can be added to or replaced on the class afterwards.
Object.freeze(ApprovedRoot);
Object.freeze(ApprovedRoot.prototype);

/**
 * Folders that are never approved without care (SECURITY §13.4: never auto-grant Documents, the
 * home folder, browser profiles, credential folders or the whole disk).
 */
export interface SensitiveFolders {
  /** Refused as a root, or as a folder containing one, unless the caller passes `broad: true`. */
  readonly broad: readonly string[];
  /**
   * Like `broad`, and every folder inside them counts too: app data and system folders, where
   * projects don't live but settings, programs and other apps' secrets do.
   */
  readonly broadTrees: readonly string[];
  /** Never usable: refused as a root, and refused inside any root (even a broad one). */
  readonly forbidden: readonly string[];
}

/** The default sensitive folders for this user, from the home folder and Windows variables. */
export function defaultSensitiveFolders(
  env: Readonly<Record<string, string | undefined>> = process.env,
  home: string = homedir(),
): SensitiveFolders {
  const under = (base: string | undefined, ...parts: string[]): string[] =>
    base !== undefined && base !== '' && path.isAbsolute(base) ? [path.join(base, ...parts)] : [];
  const oneDrives = [env['OneDrive'], env['OneDriveConsumer'], env['OneDriveCommercial']];
  const appData = env['APPDATA'];
  const localAppData = env['LOCALAPPDATA'];
  const broad = [
    ...under(home),
    ...under(env['USERPROFILE']),
    ...['Documents', 'Desktop', 'Downloads'].flatMap((name) => under(home, name)),
    ...oneDrives.flatMap((drive) => [
      ...under(drive),
      ...under(drive, 'Documents'),
      ...under(drive, 'Desktop'),
    ]),
    ...under(env['PUBLIC']),
  ];
  const broadTrees = [
    ...under(appData),
    ...under(localAppData),
    ...under(env['SystemRoot']),
    ...under(env['ProgramFiles']),
    ...under(env['ProgramFiles(x86)']),
    ...under(env['ProgramData']),
  ];
  const forbidden = [
    ...['.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker'].flatMap((name) =>
      under(home, name),
    ),
    ...under(home, '.config', 'gcloud'),
    ...under(localAppData, 'Google', 'Chrome', 'User Data'),
    ...under(localAppData, 'Microsoft', 'Edge', 'User Data'),
    ...under(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data'),
    ...under(localAppData, 'Vivaldi', 'User Data'),
    ...under(localAppData, 'Chromium', 'User Data'),
    ...under(localAppData, 'Microsoft', 'Credentials'),
    ...under(appData, 'Mozilla', 'Firefox'),
    ...under(appData, 'Opera Software'),
    ...under(appData, 'Microsoft', 'Credentials'),
    ...under(appData, 'Microsoft', 'Protect'),
    ...under(appData, 'Microsoft', 'Crypto'),
    ...under(localAppData, 'Microsoft', 'Vault'),
    ...under(localAppData, 'Google', 'Chrome SxS', 'User Data'),
    ...under(appData, 'gcloud'),
    ...under(appData, 'gnupg'),
    ...under(appData, 'GitHub CLI'),
    // A file here runs at the next sign-in: writing one would bypass "no scripts".
    ...under(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
    ...under(env['ProgramData'], 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
  ];
  return {
    broad: [...new Set(broad)],
    broadTrees: [...new Set(broadTrees)],
    forbidden: [...new Set(forbidden)],
  };
}

export interface ApproveOptions {
  /**
   * Allow a broad root (a whole drive, the home folder, Documents, AppData, ...). Only for a
   * screen where the user knowingly picks such a folder; never set it automatically.
   * Forbidden folders inside a broad root stay refused.
   */
  readonly broad?: boolean;
  /**
   * Override the sensitive folders. Defaults to defaultSensitiveFolders(). The main-process
   * caller should add Electron's `app.getPath` folders (documents, desktop, downloads, which
   * follow Windows folder redirection) and the app's own userData to `forbidden`.
   */
  readonly sensitiveFolders?: SensitiveFolders;
}

/**
 * Checks a root folder: an absolute local path with a safe shape that exists and is a folder,
 * and isn't a sensitive folder (see SensitiveFolders). A root may itself be reached through a
 * link (for example a redirected Documents folder); from here on its real location is what
 * counts. The result is only valid for the current operation: approve again next time.
 */
export async function approveRoot(
  root: string,
  options: ApproveOptions = {},
): Promise<ApprovedRoot> {
  if (pathShapeProblem(root) !== undefined || !path.isAbsolute(root)) {
    throw new PathPolicyError('root_unavailable');
  }
  const given = path.resolve(root);
  let real: string;
  let identity: { dev: bigint; ino: bigint };
  try {
    real = await realpathNative(given);
    const info = await stat(real, { bigint: true });
    if (!info.isDirectory()) throw new PathPolicyError('root_unavailable');
    identity = { dev: info.dev, ino: info.ino };
  } catch (error) {
    if (error instanceof PathPolicyError) throw error;
    throw new PathPolicyError('root_unavailable', error);
  }
  // A root that resolves to a network share or device namespace is refused as well.
  if (pathShapeProblem(real) !== undefined) throw new PathPolicyError('root_unavailable');

  const listed = options.sensitiveFolders ?? defaultSensitiveFolders();
  // A sensitive folder can be reached by another name (a junction, a moved Documents folder):
  // compare against where each one really is, too.
  const sensitive = {
    broad: await realForms(listed.broad),
    broadTrees: await realForms(listed.broadTrees),
    forbidden: await realForms(listed.forbidden),
  };
  const forms = [given, real];
  // Both the written and the real form count: either may be the one that reveals the problem.
  const rootIsIn = (folder: string) => forms.some((form) => isWithin(folder, form, IS_WINDOWS));
  const rootContains = (folder: string) => forms.some((form) => isWithin(form, folder, IS_WINDOWS));
  if (sensitive.forbidden.some(rootIsIn)) throw new PathPolicyError('sensitive_folder');
  const isVolumeRoot = forms.some((form) => path.parse(form).root === form);
  const isBroad =
    isVolumeRoot ||
    sensitive.broad.some(rootContains) ||
    sensitive.broadTrees.some((tree) => rootContains(tree) || rootIsIn(tree));
  if (options.broad !== true && isBroad) {
    throw new PathPolicyError('root_too_broad');
  }
  const excluded = await realForms(sensitive.forbidden.filter(rootContains));
  return issueRoot(given, real, { ...identity, excluded });
}

/** Each folder as written plus, if it exists, its real location (links resolved). */
async function realForms(folders: readonly string[]): Promise<string[]> {
  const forms = new Set(folders);
  for (const folder of folders) {
    try {
      forms.add(await realpathNative(folder));
    } catch {
      // A sensitive folder that doesn't exist yet is still refused by its written form.
    }
  }
  return [...forms];
}

/**
 * Confirms that `root` was issued by approveRoot and that its folder is still the same one
 * (same volume and file ID): a root renamed away and replaced by a new folder is refused.
 */
async function checkRoot(root: ApprovedRoot): Promise<RootState> {
  const state = rootStateOf(root);
  if (state === undefined) throw new PathPolicyError('root_unavailable');
  let info;
  try {
    info = await stat(root.real, { bigint: true });
  } catch (error) {
    throw new PathPolicyError('root_unavailable', error);
  }
  if (!info.isDirectory() || info.dev !== state.dev || info.ino !== state.ino) {
    throw new PathPolicyError('root_unavailable');
  }
  return state;
}

/** A path that passed the checks. */
export interface ResolvedPath {
  /** The real path inside the root (for a missing file: its real parent plus the new name). */
  readonly real: string;
  /** False when the file doesn't exist yet (only with `allowMissing`). */
  readonly exists: boolean;
}

export interface ResolveOptions {
  /** Accept a file that doesn't exist yet, as long as its nearest existing parent is inside. */
  readonly allowMissing?: boolean;
}

/**
 * Resolves `candidate` (absolute, or relative to the root) and checks that it stays inside the
 * root, as written and after every link is followed. Throws PathPolicyError otherwise.
 *
 * CHECK ONLY. Never pass the result to `fs`: a link can change between this check and the use.
 * Act through openInsideRoot, ensureDirInsideRoot, listInsideRoot, walkInsideRoot or
 * writeFileInsideRoot, which check again at use.
 */
export async function resolveInsideRoot(
  root: ApprovedRoot,
  candidate: string,
  options: ResolveOptions = {},
): Promise<ResolvedPath> {
  const shape = pathShapeProblem(candidate);
  if (shape !== undefined) throw new PathPolicyError(shape);
  const state = await checkRoot(root);

  // As written: no `..` and no other drive. Cheap, and gives the clearer reason.
  const written = path.resolve(root.given, candidate);
  if (!writtenInside(root, written)) throw new PathPolicyError('outside_root');
  if (isSensitiveName(written)) throw new PathPolicyError('sensitive_file');

  try {
    const real = confirmInside(root, state, await realpathNative(written));
    const info = await stat(real, { bigint: true });
    if (info.isFile() && info.nlink > 1n) throw new PathPolicyError('hard_link');
    return { real, exists: true };
  } catch (error) {
    if (error instanceof PathPolicyError) throw error;
    if (options.allowMissing !== true || refusalOf(error) !== 'not_found') {
      throw new PathPolicyError(refusalOf(error), error);
    }
  }
  return { real: await resolveMissing(root, state, written), exists: false };
}

/**
 * True when a path as written is inside the root as given or as Windows resolved it. Both
 * count: a root approved by its 8.3 short name (`RUNNER~1`) must accept the long form too.
 * This is only the early check; the real-path check below is the one that decides.
 */
function writtenInside(root: ApprovedRoot, written: string): boolean {
  return isWithin(root.given, written, IS_WINDOWS) || isWithin(root.real, written, IS_WINDOWS);
}

/**
 * The real path, if it is inside the root's real location (otherwise a link led out) and not in
 * a sensitive folder inside a broad root.
 */
function confirmInside(root: ApprovedRoot, state: RootState, real: string): string {
  if (pathShapeProblem(real) !== undefined) throw new PathPolicyError('link_escape');
  if (!isWithin(root.real, real, false)) throw new PathPolicyError('link_escape');
  if (isExcluded(state, real)) throw new PathPolicyError('sensitive_folder');
  if (isSensitiveName(real)) throw new PathPolicyError('sensitive_file');
  return real;
}

/**
 * File names that usually hold tokens or passwords (ADR-0035). Refused anywhere, in every root,
 * compared without ASCII case. Listings still show the name.
 */
const SENSITIVE_FILE_NAMES: ReadonlySet<string> = new Set([
  '.git-credentials',
  '.npmrc',
  '.netrc',
  '_netrc',
  '.pypirc',
]);

function isSensitiveName(target: string): boolean {
  return SENSITIVE_FILE_NAMES.has(foldAscii(path.basename(target)));
}

function isExcluded(state: RootState, real: string): boolean {
  return state.excluded.some((folder) => isWithin(folder, real, IS_WINDOWS));
}

/**
 * For a file that doesn't exist yet: finds the nearest parent folder that does, checks that
 * parent's real location, and appends the missing names. openInsideRoot still checks the
 * created file again after opening it.
 *
 * `realpath` failing doesn't prove a name is free: a junction or symlink whose target is
 * missing fails it too, and creating "through" it would build the target outside the root
 * (H1, #142). So the first missing name is looked at with `lstat`, which doesn't follow links:
 * only "nothing there" is accepted.
 */
async function resolveMissing(
  root: ApprovedRoot,
  state: RootState,
  written: string,
): Promise<string> {
  const missing: string[] = [];
  let current = written;
  for (let depth = 0; depth < MAX_MISSING_DEPTH; depth += 1) {
    missing.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current || !writtenInside(root, parent)) break;
    current = parent;
    let real: string;
    try {
      real = confirmInside(root, state, await realpathNative(current));
    } catch (error) {
      if (error instanceof PathPolicyError) throw error;
      if (refusalOf(error) !== 'not_found') {
        throw new PathPolicyError('inaccessible', error);
      }
      continue;
    }
    await assertNothingAt(path.join(real, missing[0] ?? ''));
    return path.join(real, ...missing);
  }
  throw new PathPolicyError('not_found');
}

/** Refuses unless nothing at all is at `target` (not even a link with a missing target). */
async function assertNothingAt(target: string): Promise<void> {
  let info;
  try {
    info = await lstat(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new PathPolicyError('inaccessible', error);
  }
  // Something appeared that realpath couldn't follow: a dangling link, or a race.
  throw new PathPolicyError(info.isSymbolicLink() ? 'link_escape' : 'changed_during_use');
}

/** How a file is opened: read an existing file, or create a new one (never overwrite). */
export type OpenMode = 'read' | 'create';

/**
 * Something a refused operation may have left behind that the module could not safely remove.
 * Carries no path. Callers pass these to the audit log (M3-10) so a person can look.
 */
export interface LeftoverEvent {
  readonly kind:
    | 'file_left_behind' // a refused create made a file, and it couldn't be proven ours
    | 'unknown_object_created' // a create failed after its name became a link
    | 'folder_left_behind'; // a refused ensureDirInsideRoot made a folder it couldn't remove
}

export interface OpenOptions {
  /** Called when a refused operation may have left something behind (see LeftoverEvent). */
  readonly onLeftover?: (event: LeftoverEvent) => void;
}

export interface OpenedFile {
  readonly handle: FileHandle;
  /** The real path that was opened and verified. */
  readonly real: string;
}

/**
 * Opens a file inside the root and verifies it after opening (re-check at use). `read` opens an
 * existing regular file; `create` makes a new file and fails if anything is already there
 * (artifacts are never overwritten, M3-12). A missing parent folder is `not_found`: make it
 * with ensureDirInsideRoot first. The caller must close the handle.
 *
 * A refused create cleans up after itself: the file it made is deleted if the path still
 * leads to that exact file (same volume and file ID); otherwise `onLeftover` is told.
 */
export async function openInsideRoot(
  root: ApprovedRoot,
  candidate: string,
  mode: OpenMode,
  options: OpenOptions = {},
): Promise<OpenedFile> {
  const resolved = await resolveInsideRoot(root, candidate, { allowMissing: mode === 'create' });
  if (mode === 'create' && resolved.exists) throw new PathPolicyError('already_exists');

  let handle: FileHandle;
  try {
    handle =
      mode === 'read'
        ? await open(resolved.real, fsConstants.O_RDONLY)
        : await open(
            resolved.real,
            fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
            0o600,
          );
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') throw new PathPolicyError('already_exists', error);
    // A create that failed because its name became a link meanwhile may have made the link's
    // target (Windows creates through a dangling junction). Nothing safe to delete: report it.
    if (mode === 'create' && (await isLink(resolved.real))) {
      options.onLeftover?.({ kind: 'unknown_object_created' });
      throw new PathPolicyError('changed_during_use', error);
    }
    if (code === 'EISDIR') throw new PathPolicyError('not_a_file', error);
    throw new PathPolicyError(refusalOf(error), error);
  }

  let held: BigIntStats | undefined;
  try {
    held = await handle.stat({ bigint: true });
    await verifyHandleInsideRoot(root, resolved.real, handle);
  } catch (error) {
    await handle.close().catch(() => undefined);
    if (mode === 'create' && held !== undefined && !held.isFile()) {
      // A link planted after the check made Windows create its target (often a folder).
      // Known limit: Node can't open "without following links" on Windows, so this race can't
      // be closed fully; it is refused and reported, never accepted.
      options.onLeftover?.({ kind: 'unknown_object_created' });
      throw new PathPolicyError('changed_during_use');
    }
    if (mode === 'create') await removeOwnFile(resolved.real, held, options);
    throw error;
  }
  return { handle, real: resolved.real };
}

async function isLink(target: string): Promise<boolean> {
  try {
    return (await lstat(target)).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Deletes a file this module just created, but only if `target` still leads to that exact
 * file (same volume and file ID); otherwise reports it. Used after a refused create (M1).
 *
 * The check and the delete both use the *real* path, so a junction on the path as written
 * (for example inside the root) that is re-pointed after the check no longer redirects the
 * delete. Known limit: Node can't delete through an open handle, so a process that swaps one
 * of the real path's folders for a junction in the instant between the check and the delete
 * can still redirect it. That needs exact timing and a process that could delete the file
 * itself anyway (ADR-0035).
 */
async function removeOwnFile(
  target: string,
  held: BigIntStats | undefined,
  options: OpenOptions,
): Promise<void> {
  if (held !== undefined) {
    try {
      const real = await realpathNative(target);
      const now = await lstat(real, { bigint: true });
      if (now.isFile() && now.dev === held.dev && now.ino === held.ino) {
        await unlink(real);
        return;
      }
    } catch {
      // Gone or unreadable: fall through and report.
    }
  }
  options.onLeftover?.({ kind: 'file_left_behind' });
}

/**
 * The re-check at use. Resolves `real` again and confirms that (1) it is still inside the root
 * and (2) it is the very file `handle` holds, by volume and file ID. A link swapped between
 * the first check and the open makes the two differ. A file with more than one name is
 * refused. Returns what the handle holds. Exported so tests can swap a link at an exact
 * moment; production code calls openInsideRoot.
 */
export async function verifyHandleInsideRoot(
  root: ApprovedRoot,
  real: string,
  handle: FileHandle,
): Promise<BigIntStats> {
  const state = await checkRoot(root);
  const held = await handle.stat({ bigint: true });
  if (!held.isFile()) throw new PathPolicyError('not_a_file');
  if (held.nlink > 1n) throw new PathPolicyError('hard_link');
  let now: string;
  try {
    now = await realpathNative(real);
  } catch (error) {
    throw new PathPolicyError('changed_during_use', error);
  }
  try {
    confirmInside(root, state, now);
  } catch {
    throw new PathPolicyError('changed_during_use');
  }
  let current;
  try {
    current = await stat(now, { bigint: true });
  } catch (error) {
    throw new PathPolicyError('changed_during_use', error);
  }
  if (current.dev !== held.dev || current.ino !== held.ino) {
    throw new PathPolicyError('changed_during_use');
  }
  return held;
}

/**
 * Makes `candidate` and any missing parent folders inside the root, one level at a time. Each
 * level is checked after it exists (its real path must still be inside the root), so a folder
 * swapped for a junction partway stops the walk. A folder this call made and then refused is
 * removed again if it is still empty and still the same folder; otherwise `onLeftover` is told.
 * Returns the real path of the deepest folder.
 */
export async function ensureDirInsideRoot(
  root: ApprovedRoot,
  candidate: string,
  options: OpenOptions = {},
): Promise<string> {
  const shape = pathShapeProblem(candidate);
  if (shape !== undefined) throw new PathPolicyError(shape);
  const state = await checkRoot(root);
  const written = path.resolve(root.given, candidate);
  if (!writtenInside(root, written)) throw new PathPolicyError('outside_root');
  const base = isWithin(root.given, written, IS_WINDOWS) ? root.given : root.real;
  const relative = path.relative(base, written);
  const names = relative === '' ? [] : relative.split(path.sep);
  if (names.some(isSensitiveName)) throw new PathPolicyError('sensitive_file');
  if (names.length > MAX_MISSING_DEPTH) throw new PathPolicyError('invalid_path');

  let current = root.real;
  for (const name of names) {
    const next = path.join(current, name);
    let made: BigIntStats | undefined;
    let created = false;
    try {
      await mkdir(next);
      created = true;
      made = await lstat(next, { bigint: true });
    } catch (error) {
      if (created) {
        // Made, but can't be identified any more: leave it and say so.
        options.onLeftover?.({ kind: 'folder_left_behind' });
        throw new PathPolicyError('changed_during_use', error);
      }
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new PathPolicyError(refusalOf(error), error);
      }
    }
    try {
      const real = confirmInside(root, state, await realpathNative(next));
      if (!(await stat(real)).isDirectory()) throw new PathPolicyError('not_a_folder');
      current = real;
    } catch (error) {
      if (made !== undefined) await removeOwnFolder(next, made, options);
      if (error instanceof PathPolicyError) throw error;
      // realpath failed on a name that exists: a link whose target is missing.
      if (await isLink(next)) throw new PathPolicyError('link_escape', error);
      throw new PathPolicyError(refusalOf(error), error);
    }
  }
  return current;
}

/**
 * Removes an empty folder this module just made, if `target` still leads to it. Like
 * removeOwnFile, it checks and removes by the real path.
 */
async function removeOwnFolder(
  target: string,
  made: BigIntStats,
  options: OpenOptions,
): Promise<void> {
  try {
    const real = await realpathNative(target);
    const now = await lstat(real, { bigint: true });
    if (now.isDirectory() && now.dev === made.dev && now.ino === made.ino) {
      await rmdir(real); // only ever removes an empty folder
      return;
    }
  } catch {
    // Gone, not empty or unreadable: fall through and report.
  }
  options.onLeftover?.({ kind: 'folder_left_behind' });
}

/** One entry of a folder, as `lstat` sees it: links are reported, never followed. */
export interface DirectoryEntry {
  readonly name: string;
  /** `link` covers junctions and symlinks; nothing behind a link is listed or read. */
  readonly kind: 'file' | 'folder' | 'link' | 'other';
  /** Size in bytes for files, 0 otherwise. */
  readonly size: number;
  /** True when the file has more than one name; openInsideRoot will refuse it (hard_link). */
  readonly hardLinked: boolean;
}

export interface DirectoryListing {
  /** The real path of the folder that was listed. */
  readonly real: string;
  /** Sorted by name (ordinal), at most `maxEntries`. */
  readonly entries: readonly DirectoryEntry[];
  /** Entries left out because of `maxEntries`. */
  readonly omittedCount: number;
}

export interface ListOptions {
  /** Most entries returned; the rest are counted in omittedCount. Default 10 000. */
  readonly maxEntries?: number;
}

const DEFAULT_MAX_ENTRIES = 10_000;
const MAX_ENTRIES_CAP = 100_000;
const DEFAULT_MAX_DEPTH = 16;

/** A whole number in [0, cap]; anything else (NaN, Infinity, missing) gives the default. */
function limit(value: number | undefined, fallback: number, cap: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), 0), cap);
}

/**
 * Lists one folder inside the root without following links. Afterwards the folder's path must
 * still lead to the same folder (volume + file ID) inside the root, or the listing is refused.
 * Known limit: Node can't list a folder by handle, so a link swapped out and back again during
 * the listing could show names (never contents) from elsewhere; reads still go through
 * openInsideRoot.
 */
export async function listInsideRoot(
  root: ApprovedRoot,
  candidate: string,
  options: ListOptions = {},
): Promise<DirectoryListing> {
  const resolved = await resolveInsideRoot(root, candidate);
  const state = await checkRoot(root);
  const maxEntries = limit(options.maxEntries, DEFAULT_MAX_ENTRIES, MAX_ENTRIES_CAP);
  return listReal(root, state, resolved.real, maxEntries);
}

async function listReal(
  root: ApprovedRoot,
  state: RootState,
  dir: string,
  maxEntries: number,
): Promise<DirectoryListing> {
  let before;
  try {
    before = await stat(dir, { bigint: true });
  } catch (error) {
    throw new PathPolicyError(refusalOf(error), error);
  }
  if (!before.isDirectory()) throw new PathPolicyError('not_a_folder');

  const entries: DirectoryEntry[] = [];
  let omittedCount = 0;
  try {
    for await (const dirent of await opendir(dir)) {
      if (entries.length >= maxEntries) {
        omittedCount += 1;
        continue;
      }
      let info;
      try {
        info = await lstat(path.join(dir, dirent.name), { bigint: true });
      } catch {
        continue; // removed meanwhile
      }
      entries.push({
        name: dirent.name,
        kind: info.isSymbolicLink()
          ? 'link'
          : info.isDirectory()
            ? 'folder'
            : info.isFile()
              ? 'file'
              : 'other',
        size: info.isFile() ? Number(info.size) : 0,
        hardLinked: info.isFile() && info.nlink > 1n,
      });
    }
  } catch (error) {
    throw new PathPolicyError(refusalOf(error), error);
  }

  // Re-check at use: the folder we listed must still be this folder, inside the root.
  try {
    const now = confirmInside(root, state, await realpathNative(dir));
    const after = await stat(now, { bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino) throw new Error('changed');
  } catch (error) {
    if (error instanceof PathPolicyError && error.reason === 'sensitive_folder') throw error;
    throw new PathPolicyError('changed_during_use', error);
  }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { real: dir, entries, omittedCount };
}

export interface WalkEntry extends DirectoryEntry {
  /** Path relative to the folder the walk started in, with `\` separators. */
  readonly relativePath: string;
}

export interface WalkResult {
  readonly entries: readonly WalkEntry[];
  /** False when `maxEntries` or `maxDepth` stopped the walk before it saw everything. */
  readonly complete: boolean;
}

export interface WalkOptions {
  /** Most entries returned in total. Default 10 000. */
  readonly maxEntries?: number;
  /** How many folder levels below the start are entered. Default 16. */
  readonly maxDepth?: number;
}

/**
 * Walks a folder tree inside the root, breadth first, never entering links (a link is listed as
 * `link` and left alone). Bounded by `maxEntries` and `maxDepth`; `complete` says whether it
 * saw everything. Each folder is listed with listInsideRoot's re-check.
 */
export async function walkInsideRoot(
  root: ApprovedRoot,
  candidate: string,
  options: WalkOptions = {},
): Promise<WalkResult> {
  const maxEntries = limit(options.maxEntries, DEFAULT_MAX_ENTRIES, MAX_ENTRIES_CAP);
  const maxDepth = limit(options.maxDepth, DEFAULT_MAX_DEPTH, MAX_MISSING_DEPTH);
  const start = await resolveInsideRoot(root, candidate);
  const state = await checkRoot(root);

  const entries: WalkEntry[] = [];
  let complete = true;
  const queue: { real: string; relative: string; depth: number }[] = [
    { real: start.real, relative: '', depth: 0 },
  ];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const remaining = maxEntries - entries.length;
    if (remaining <= 0) {
      complete = false;
      break;
    }
    const listing = await listReal(root, state, next.real, remaining);
    if (listing.omittedCount > 0) complete = false;
    for (const entry of listing.entries) {
      const relativePath = next.relative === '' ? entry.name : `${next.relative}\\${entry.name}`;
      entries.push({ ...entry, relativePath });
      if (entry.kind !== 'folder') continue;
      const childReal = path.join(listing.real, entry.name);
      // A credential or browser folder inside a broad root is listed by name, never entered.
      if (next.depth >= maxDepth || isExcluded(state, childReal)) {
        complete = false;
        continue;
      }
      queue.push({ real: childReal, relative: relativePath, depth: next.depth + 1 });
    }
  }
  return { entries, complete };
}

/**
 * Writes a new file inside the root, all or nothing: the data goes to a temporary file in the
 * same folder first, is flushed to disk, and only then gets its final name. The final name is
 * never overwritten (`already_exists`), and a crash or refusal never leaves a half-written file
 * under it (M3-12). The parent folder must exist (see ensureDirInsideRoot).
 *
 * Why a hard link and not rename? On Windows, Node's rename replaces an existing file. Linking
 * the temp file to the final name fails if the name is taken, which is the "never overwrite"
 * rule done by the OS itself; the temp name is then removed. Known limit: drives without hard
 * links (FAT32, exFAT) refuse with `inaccessible`.
 */
export async function writeFileInsideRoot(
  root: ApprovedRoot,
  candidate: string,
  data: string | Uint8Array,
  options: OpenOptions = {},
): Promise<string> {
  const resolved = await resolveInsideRoot(root, candidate, { allowMissing: true });
  if (resolved.exists) throw new PathPolicyError('already_exists');
  const state = await checkRoot(root);
  const tempPath = path.join(path.dirname(resolved.real), `.atlas-${randomUUID()}.tmp`);
  const temp = await openInsideRoot(root, tempPath, 'create', options);

  // The temp file's identity, taken from the handle: every later step checks against it.
  let held: BigIntStats | undefined;
  try {
    held = await temp.handle.stat({ bigint: true });
    await temp.handle.writeFile(data);
    await temp.handle.sync();
  } catch (error) {
    await temp.handle.close().catch(() => undefined);
    await removeOwnFile(temp.real, held, options);
    throw new PathPolicyError(refusalOf(error), error);
  }
  await temp.handle.close();

  try {
    try {
      await link(temp.real, resolved.real);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new PathPolicyError(code === 'EEXIST' ? 'already_exists' : refusalOf(error), error);
    }
    // Re-check at use: the final name must lead, inside the root, to the file we wrote.
    try {
      const now = confirmInside(root, state, await realpathNative(resolved.real));
      const info = await stat(now, { bigint: true });
      if (info.dev !== held.dev || info.ino !== held.ino) throw new Error('changed');
    } catch (error) {
      await removeOwnFile(resolved.real, held, options);
      throw new PathPolicyError('changed_during_use', error);
    }
  } finally {
    await removeOwnFile(temp.real, held, options);
  }
  return resolved.real;
}

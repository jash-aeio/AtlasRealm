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
//      changes), and again after Windows resolves every junction and symlink.
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
// Errors carry a reason and a fixed message, never a path: the outside path can contain the
// Windows user name and must not reach the renderer (SECURITY §21.3).
import { constants as fsConstants, realpath as realpathCallback } from 'node:fs';
import { type FileHandle, open, stat } from 'node:fs/promises';
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
  | 'not_found' // the file (or a parent folder) doesn't exist
  | 'inaccessible' // the OS refused to resolve it (permissions, too many links, ...)
  | 'not_a_file' // a folder or device where a file was expected
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
  not_found: 'That file does not exist.',
  inaccessible: 'That file cannot be accessed.',
  not_a_file: 'That path is not a file.',
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

// Set inside the class's static block, which is the only code that can see `#state`.
let rootStateOf: (root: unknown) => RootState | undefined;
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
  }

  /** @internal Used by approveRoot only; the token keeps everyone else out. */
  static issue(token: typeof ISSUE, given: string, real: string, state: RootState): ApprovedRoot {
    return new ApprovedRoot(token, given, real, state);
  }
}

/**
 * Folders that are never approved without care (SECURITY §13.4: never auto-grant Documents, the
 * home folder, browser profiles, credential folders or the whole disk).
 */
export interface SensitiveFolders {
  /** Refused as a root, or as a folder containing one, unless the caller passes `broad: true`. */
  readonly broad: readonly string[];
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
    ...under(appData),
    ...under(localAppData),
    ...under(env['PUBLIC']),
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
  ];
  return { broad: [...new Set(broad)], forbidden: [...new Set(forbidden)] };
}

export interface ApproveOptions {
  /**
   * Allow a broad root (a whole drive, the home folder, Documents, AppData, ...). Only for a
   * screen where the user knowingly picks such a folder; never set it automatically.
   * Forbidden folders inside a broad root stay refused.
   */
  readonly broad?: boolean;
  /** Override the sensitive folders (tests). Defaults to defaultSensitiveFolders(). */
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

  const sensitive = options.sensitiveFolders ?? defaultSensitiveFolders();
  const forms = [given, real];
  // Both the written and the real form count: either may be the one that reveals the problem.
  const rootIsIn = (folder: string) => forms.some((form) => isWithin(folder, form, IS_WINDOWS));
  const rootContains = (folder: string) => forms.some((form) => isWithin(form, folder, IS_WINDOWS));
  if (sensitive.forbidden.some(rootIsIn)) throw new PathPolicyError('sensitive_folder');
  const isVolumeRoot = forms.some((form) => path.parse(form).root === form);
  if (options.broad !== true && (isVolumeRoot || sensitive.broad.some(rootContains))) {
    throw new PathPolicyError('root_too_broad');
  }
  const excluded = await realForms(sensitive.forbidden.filter(rootContains));
  return ApprovedRoot.issue(ISSUE, given, real, { ...identity, excluded });
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
 * This is a check only: use openInsideRoot to act on the file, which checks again at use.
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
  if (!isWithin(root.given, written, IS_WINDOWS)) throw new PathPolicyError('outside_root');

  try {
    const real = await realpathNative(written);
    return { real: confirmInside(root, state, real), exists: true };
  } catch (error) {
    if (error instanceof PathPolicyError) throw error;
    if (options.allowMissing !== true || refusalOf(error) !== 'not_found') {
      throw new PathPolicyError(refusalOf(error), error);
    }
  }
  return { real: await resolveMissing(root, state, written), exists: false };
}

/**
 * The real path, if it is inside the root's real location (otherwise a link led out) and not in
 * a sensitive folder inside a broad root.
 */
function confirmInside(root: ApprovedRoot, state: RootState, real: string): string {
  if (pathShapeProblem(real) !== undefined) throw new PathPolicyError('link_escape');
  if (!isWithin(root.real, real, false)) throw new PathPolicyError('link_escape');
  if (state.excluded.some((folder) => isWithin(folder, real, IS_WINDOWS))) {
    throw new PathPolicyError('sensitive_folder');
  }
  return real;
}

/**
 * For a file that doesn't exist yet: finds the nearest parent folder that does, checks that
 * parent's real location, and appends the missing names (which can't be links: they don't
 * exist). openInsideRoot still checks the created file again after opening it.
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
    if (parent === current || !isWithin(root.given, parent, IS_WINDOWS)) break;
    current = parent;
    try {
      const real = confirmInside(root, state, await realpathNative(current));
      return path.join(real, ...missing);
    } catch (error) {
      if (error instanceof PathPolicyError) throw error;
      if (refusalOf(error) !== 'not_found') {
        throw new PathPolicyError('inaccessible', error);
      }
    }
  }
  throw new PathPolicyError('not_found');
}

/** How a file is opened: read an existing file, or create a new one (never overwrite). */
export type OpenMode = 'read' | 'create';

export interface OpenedFile {
  readonly handle: FileHandle;
  /** The real path that was opened and verified. */
  readonly real: string;
}

/**
 * Opens a file inside the root and verifies it after opening (re-check at use). `read` opens an
 * existing regular file; `create` makes a new file and fails if anything is already there
 * (artifacts are never overwritten, M3-12). The caller must close the handle.
 */
export async function openInsideRoot(
  root: ApprovedRoot,
  candidate: string,
  mode: OpenMode,
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
    if (code === 'EISDIR') throw new PathPolicyError('not_a_file', error);
    throw new PathPolicyError(refusalOf(error), error);
  }

  try {
    await verifyHandleInsideRoot(root, resolved.real, handle);
  } catch (error) {
    await handle.close().catch(() => undefined);
    throw error;
  }
  return { handle, real: resolved.real };
}

/**
 * The re-check at use. Resolves `real` again and confirms that (1) it is still inside the root
 * and (2) it is the very file `handle` holds, by volume and file ID. A link swapped between
 * the first check and the open makes the two differ. Exported so tests can swap a link at an
 * exact moment; production code calls openInsideRoot.
 */
export async function verifyHandleInsideRoot(
  root: ApprovedRoot,
  real: string,
  handle: FileHandle,
): Promise<void> {
  const state = await checkRoot(root);
  const held = await handle.stat({ bigint: true });
  if (!held.isFile()) throw new PathPolicyError('not_a_file');
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
}

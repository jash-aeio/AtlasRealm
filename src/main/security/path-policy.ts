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
// Errors carry a reason and a fixed message, never a path: the outside path can contain the
// Windows user name and must not reach the renderer (SECURITY §21.3).
import { constants as fsConstants, realpath as realpathCallback } from 'node:fs';
import { type FileHandle, open, stat } from 'node:fs/promises';
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
  | 'root_unavailable' // the root itself is missing, not a folder, or unsafe
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
  not_found: 'That file does not exist.',
  inaccessible: 'That file cannot be accessed.',
  not_a_file: 'That path is not a file.',
  already_exists: 'A file with that name already exists.',
  changed_during_use: 'The file changed while it was being opened. Nothing was read or written.',
};

/** A refused path. `message` is fixed text, safe to show; it never contains a path. */
export class PathPolicyError extends Error {
  override readonly name = 'PathPolicyError';
  constructor(
    readonly reason: PathRefusal,
    options?: ErrorOptions,
  ) {
    super(MESSAGES[reason], options);
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

/** A root folder that passed the checks: `real` is the OS-resolved path. */
export interface ApprovedRoot {
  /** The root as given, made absolute. Candidates written against it are checked against it. */
  readonly given: string;
  /** Where the root really is, after Windows resolved every link. */
  readonly real: string;
}

/**
 * Checks a root folder: an absolute local path with a safe shape that exists and is a folder.
 * A root may itself be reached through a link (for example a redirected Documents folder);
 * from here on its real location is what counts.
 */
export async function approveRoot(root: string): Promise<ApprovedRoot> {
  if (pathShapeProblem(root) !== undefined || !path.isAbsolute(root)) {
    throw new PathPolicyError('root_unavailable');
  }
  const given = path.resolve(root);
  let real: string;
  try {
    real = await realpathNative(given);
    if (!(await stat(real)).isDirectory()) throw new PathPolicyError('root_unavailable');
  } catch (error) {
    if (error instanceof PathPolicyError) throw error;
    throw new PathPolicyError('root_unavailable', { cause: error });
  }
  // A root that resolves to a network share or device namespace is refused as well.
  if (pathShapeProblem(real) !== undefined) throw new PathPolicyError('root_unavailable');
  return { given, real };
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

  // As written: no `..` and no other drive. Cheap, and gives the clearer reason.
  const written = path.resolve(root.given, candidate);
  if (!isWithin(root.given, written, IS_WINDOWS)) throw new PathPolicyError('outside_root');

  try {
    const real = await realpathNative(written);
    return { real: confirmInside(root, real), exists: true };
  } catch (error) {
    if (error instanceof PathPolicyError) throw error;
    if (options.allowMissing !== true || refusalOf(error) !== 'not_found') {
      throw new PathPolicyError(refusalOf(error), { cause: error });
    }
  }
  return { real: await resolveMissing(root, written), exists: false };
}

/** The real path, if it is inside the root's real location; otherwise a link led out. */
function confirmInside(root: ApprovedRoot, real: string): string {
  if (pathShapeProblem(real) !== undefined) throw new PathPolicyError('link_escape');
  if (!isWithin(root.real, real, false)) throw new PathPolicyError('link_escape');
  return real;
}

/**
 * For a file that doesn't exist yet: finds the nearest parent folder that does, checks that
 * parent's real location, and appends the missing names (which can't be links: they don't
 * exist). openInsideRoot still checks the created file again after opening it.
 */
async function resolveMissing(root: ApprovedRoot, written: string): Promise<string> {
  const missing: string[] = [];
  let current = written;
  for (let depth = 0; depth < MAX_MISSING_DEPTH; depth += 1) {
    missing.unshift(path.basename(current));
    const parent = path.dirname(current);
    if (parent === current || !isWithin(root.given, parent, IS_WINDOWS)) break;
    current = parent;
    try {
      const real = confirmInside(root, await realpathNative(current));
      return path.join(real, ...missing);
    } catch (error) {
      if (error instanceof PathPolicyError) throw error;
      if (refusalOf(error) !== 'not_found') {
        throw new PathPolicyError('inaccessible', { cause: error });
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
    if (code === 'EEXIST') throw new PathPolicyError('already_exists', { cause: error });
    if (code === 'EISDIR') throw new PathPolicyError('not_a_file', { cause: error });
    throw new PathPolicyError(refusalOf(error), { cause: error });
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
  const held = await handle.stat({ bigint: true });
  if (!held.isFile()) throw new PathPolicyError('not_a_file');
  let now: string;
  try {
    now = await realpathNative(real);
  } catch (error) {
    throw new PathPolicyError('changed_during_use', { cause: error });
  }
  if (!isWithin(root.real, now, false) || pathShapeProblem(now) !== undefined) {
    throw new PathPolicyError('changed_during_use');
  }
  let current;
  try {
    current = await stat(now, { bigint: true });
  } catch (error) {
    throw new PathPolicyError('changed_during_use', { cause: error });
  }
  if (current.dev !== held.dev || current.ino !== held.ino) {
    throw new PathPolicyError('changed_during_use');
  }
}

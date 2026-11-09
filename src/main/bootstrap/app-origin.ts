// The built UI's own origin (issue #16). Loading from app://atlas instead of file:// means
// the CSP source 'self' covers only our bundled files, not every file on disk or on a
// network share. Nothing here imports Electron, so it is unit-tested directly.
import { isAbsolute, relative, resolve, sep } from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'atlas';
export const APP_ENTRY_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/**
 * True for URLs of our app://atlas origin. Shared by the protocol handler and the IPC sender
 * check so they can't disagree. Node's URL.host leaves out user:password@, so check it too.
 * (URL.origin is no help: Node reports "null" for every custom scheme.)
 */
export function isAppOrigin(url: URL): boolean {
  return (
    url.protocol === `${APP_SCHEME}:` &&
    url.host === APP_HOST &&
    url.username === '' &&
    url.password === ''
  );
}

/**
 * Maps an `app://atlas/...` request to a file inside `rootDir`, or returns undefined if the
 * request must be refused. Path confinement: after decoding, the resolved file must stay
 * inside rootDir, so `..`, encoded `%2e%2e`/`%2f`/`%5c`, drive letters and UNC paths can't
 * reach anything else.
 */
export function resolveAppRequestPath(rootDir: string, requestUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return undefined;
  }
  if (!isAppOrigin(url)) return undefined;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return undefined; // malformed escape such as %E0%A4%A
  }
  if (pathname.includes('\0')) return undefined;

  const requested = pathname === '/' || pathname === '' ? 'index.html' : pathname.slice(1);
  const filePath = resolve(rootDir, requested);
  const fromRoot = relative(rootDir, filePath);
  // '' is the root folder itself; '..' escapes it; an absolute result means another drive.
  if (
    fromRoot === '' ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    return undefined;
  }
  return filePath;
}

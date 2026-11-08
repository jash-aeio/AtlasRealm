// Electron side of the app:// origin (issue #16). The pure path checks live in app-origin.ts.
import { pathToFileURL } from 'node:url';

import { net, protocol } from 'electron';

import { APP_SCHEME, resolveAppRequestPath } from './app-origin';

/**
 * Must run before the app is ready. `standard` gives app:// normal URL rules (a host,
 * relative links, its own origin); `secure` treats it like https. Deliberately not granted:
 * bypassCSP, corsEnabled, service workers, fetch from other origins.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true } },
  ]);
}

/**
 * Serves read-only files from `rootDir` (out/renderer) under app://atlas/. Call after ready.
 *
 * Rule: only our own build output may ever be served from app://atlas, because the IPC
 * sender check trusts that whole origin. User files, imports or generated assets need a
 * different host or scheme with no IPC trust.
 */
export function serveAppProtocol(rootDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const filePath = resolveAppRequestPath(rootDir, request.url);
    if (filePath === undefined) return new Response(null, { status: 404 });
    try {
      // Bypass custom handlers so a future file: blocker (packaging, #10) can't intercept or
      // break the UI's own asset reads.
      return await net.fetch(pathToFileURL(filePath).href, { bypassCustomProtocolHandlers: true });
    } catch {
      // Missing file or a folder. Don't echo the path: it contains the install location.
      return new Response(null, { status: 404 });
    }
  });
}

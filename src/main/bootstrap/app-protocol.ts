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

/** Serves read-only files from `rootDir` (out/renderer) under app://atlas/. Call after ready. */
export function serveAppProtocol(rootDir: string): void {
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET') return new Response(null, { status: 405 });
    const filePath = resolveAppRequestPath(rootDir, request.url);
    if (filePath === undefined) return new Response(null, { status: 404 });
    try {
      return await net.fetch(pathToFileURL(filePath).href);
    } catch {
      // Missing file or a folder. Don't echo the path: it contains the install location.
      return new Response(null, { status: 404 });
    }
  });
}

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, BrowserWindow, session } from 'electron';

import { assertLocalDevServerUrl } from './dev-server-url';

// The bundled main process lives in out/main/, next to out/preload/ and out/renderer/.
const PRELOAD_PATH = join(import.meta.dirname, '../preload/index.cjs');
const RENDERER_HTML_PATH = join(import.meta.dirname, '../renderer/index.html');

/**
 * Where trusted UI is loaded from. In `pnpm dev`, electron-vite serves the renderer and
 * sets ELECTRON_RENDERER_URL. In a build it's the local index.html file.
 */
export function rendererEntryUrl(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl !== undefined) return assertLocalDevServerUrl(devUrl);
  return pathToFileURL(RENDERER_HTML_PATH).href;
}

/**
 * The renderer is untrusted: it gets no Node.js, runs in Chromium's sandbox, and its
 * JavaScript world is isolated from the preload's (SECURITY.md §21.1).
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    title: 'Atlas Realm',
    width: 1280,
    height: 800,
    show: false,
    webPreferences: {
      preload: PRELOAD_PATH,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      devTools: !app.isPackaged,
    },
  });

  window.once('ready-to-show', () => {
    window.show();
  });
  void window.loadURL(rendererEntryUrl());
  return window;
}

/**
 * App-wide guards that apply to every web page Electron creates, including ones we
 * didn't create on purpose: no navigating away, no pop-up windows, no <webview>, and
 * no browser permissions (camera, notifications, ...).
 */
export function installNavigationGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-navigate', (event) => {
      event.preventDefault();
    });
    contents.on('will-redirect', (event) => {
      event.preventDefault();
    });
    contents.on('will-attach-webview', (event) => {
      event.preventDefault();
    });
    // External links will go through a validated scheme policy later (SECURITY.md §21.1).
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });

  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);
}

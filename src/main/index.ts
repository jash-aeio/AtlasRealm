// Main process entry: the trusted side of the app. It owns windows, IPC and the database
// (later also files and providers). The renderer only gets what the preload exposes.
import { app, BrowserWindow, dialog } from 'electron';

import { APP_ENTRY_URL } from './bootstrap/app-origin';
import { blockFileProtocol, registerAppScheme, serveAppProtocol } from './bootstrap/app-protocol';
import {
  createMainWindow,
  installNavigationGuards,
  RENDERER_DIR,
  rendererEntryUrl,
} from './bootstrap/window';
import { registerIpcHandlers } from './ipc/register';
import { openAppDatabase } from './storage/app-database';
import type { Database } from './storage/database';

let database: Database | undefined;

function focusMainWindow(): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (window === undefined) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

async function start(): Promise<void> {
  await app.whenReady();
  try {
    const opened = await openAppDatabase(app.getPath('userData'));
    database = opened.db;
    console.info(
      `[storage] schema v${String(opened.migration.toVersion)}, launch #${String(opened.launch.launchCount)}`,
    );
  } catch (error) {
    // No silent fallback to an empty database: that would look like lost data. Any
    // pre-migration backup stays in the profile's backups/ folder (OFFLINE_AND_RECOVERY §19).
    // The dialog shows a fixed message plus the error kind: raw messages can contain file
    // paths (and so the Windows user name). Full details go to the local log only.
    console.error('[storage] could not open the database', error);
    const kind = error instanceof Error ? error.name : 'UnknownError';
    dialog.showErrorBox(
      'Atlas Realm could not open its data',
      `The database could not be opened or upgraded (${kind}).\n\n` +
        'No data was deleted. The app will now close.',
    );
    app.quit();
    return;
  }

  installNavigationGuards();
  blockFileProtocol();
  const entryUrl = rendererEntryUrl();
  // Only serve app:// when the build is in use; `pnpm dev` loads from the dev server.
  if (entryUrl === APP_ENTRY_URL) serveAppProtocol(RENDERER_DIR);
  registerIpcHandlers(entryUrl);
  createMainWindow();
}

// One running copy per user profile folder (ARCHITECTURE §7.4). A second copy would open the
// same database and could race the first through migrations, so it quits and focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerAppScheme(); // must happen before 'ready'
  app.on('second-instance', focusMainWindow);
  app.on('window-all-closed', () => {
    app.quit();
  });
  app.on('will-quit', () => {
    // Closing checkpoints the WAL back into app.sqlite, leaving one tidy file.
    if (database?.isOpen) database.close();
  });
  void start();
}

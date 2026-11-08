// Main process entry: the trusted side of the app. It owns windows, IPC and the database
// (later also files and providers). The renderer only gets what the preload exposes.
import { app, dialog } from 'electron';

import { createMainWindow, installNavigationGuards, rendererEntryUrl } from './bootstrap/window';
import { registerIpcHandlers } from './ipc/register';
import type { Database } from './storage/database';
import { openAppDatabase } from './storage/app-database';

let database: Database | undefined;

app.on('window-all-closed', () => {
  app.quit();
});

app.on('will-quit', () => {
  // Closing checkpoints the WAL back into app.sqlite, leaving one tidy file.
  if (database?.isOpen) database.close();
});

void app.whenReady().then(async () => {
  try {
    const opened = await openAppDatabase(app.getPath('userData'));
    database = opened.db;
    console.info(
      `[storage] schema v${String(opened.migration.toVersion)}, launch #${String(opened.launch.launchCount)}`,
    );
  } catch (error) {
    // No silent fallback to an empty database: that would look like lost data. Any
    // pre-migration backup stays in the profile's backups/ folder (OFFLINE_AND_RECOVERY §19).
    console.error('[storage] could not open the database', error);
    dialog.showErrorBox(
      'Atlas Realm could not open its data',
      `${error instanceof Error ? error.message : String(error)}\n\nNo data was deleted. The app will now close.`,
    );
    app.quit();
    return;
  }

  installNavigationGuards();
  registerIpcHandlers(rendererEntryUrl());
  createMainWindow();
});

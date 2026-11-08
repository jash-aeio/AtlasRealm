// Main process entry: the trusted side of the app. It owns windows, IPC and (later)
// the database, files and providers. The renderer only gets what the preload exposes.
import { app } from 'electron';

import { createMainWindow, installNavigationGuards, rendererEntryUrl } from './bootstrap/window';
import { registerIpcHandlers } from './ipc/register';

app.on('window-all-closed', () => {
  app.quit();
});

void app.whenReady().then(() => {
  installNavigationGuards();
  registerIpcHandlers(rendererEntryUrl());
  createMainWindow();
});

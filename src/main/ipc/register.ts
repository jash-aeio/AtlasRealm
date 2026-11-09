// Wires command handlers to Electron's ipcMain. Each channel is registered exactly once;
// a second registration throws, which catches copy-paste mistakes at startup.
import { ipcMain } from 'electron';

import type { Database } from '../storage/database';
import { appLaunchInfoCommand, createLaunchInfoHandler } from './commands/app-launch-info';
import { appPingCommand, handleAppPing } from './commands/app-ping';
import { createCommandHandler, trustRendererEntry } from './router';

export function registerIpcHandlers(rendererEntryUrl: string, db: Database): void {
  const isTrustedSender = trustRendererEntry(rendererEntryUrl);
  ipcMain.handle(
    appPingCommand.channel,
    createCommandHandler(appPingCommand, handleAppPing, isTrustedSender),
  );
  ipcMain.handle(
    appLaunchInfoCommand.channel,
    createCommandHandler(appLaunchInfoCommand, createLaunchInfoHandler(db), isTrustedSender),
  );
}

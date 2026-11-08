// Wires command handlers to Electron's ipcMain. Each channel is registered exactly once;
// a second registration throws, which catches copy-paste mistakes at startup.
import { ipcMain } from 'electron';

import { appPingCommand, handleAppPing } from './commands/app-ping';
import { createCommandHandler, trustRendererEntry } from './router';

export function registerIpcHandlers(rendererEntryUrl: string): void {
  const isTrustedSender = trustRendererEntry(rendererEntryUrl);
  ipcMain.handle(
    appPingCommand.channel,
    createCommandHandler(appPingCommand, handleAppPing, isTrustedSender),
  );
}

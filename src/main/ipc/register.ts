// Wires command handlers to Electron's ipcMain. Each channel is registered exactly once;
// a second registration throws, which catches copy-paste mistakes at startup.
import { ipcMain } from 'electron';

import type { WorkerBridge } from '../runtime-bridge/worker-bridge';
import type { Database } from '../storage/database';
import { appLaunchInfoCommand, createLaunchInfoHandler } from './commands/app-launch-info';
import { appPingCommand, handleAppPing } from './commands/app-ping';
import {
  createWorkerCheckHandler,
  createWorkerStatusHandler,
  runtimeWorkerCheckCommand,
  runtimeWorkerStatusCommand,
} from './commands/runtime-worker';
import { createCommandHandler, trustRendererEntry } from './router';

export function registerIpcHandlers(
  rendererEntryUrl: string,
  db: Database,
  worker: WorkerBridge,
): void {
  const isTrustedSender = trustRendererEntry(rendererEntryUrl);
  ipcMain.handle(
    appPingCommand.channel,
    createCommandHandler(appPingCommand, handleAppPing, isTrustedSender),
  );
  ipcMain.handle(
    appLaunchInfoCommand.channel,
    createCommandHandler(appLaunchInfoCommand, createLaunchInfoHandler(db), isTrustedSender),
  );
  ipcMain.handle(
    runtimeWorkerStatusCommand.channel,
    createCommandHandler(
      runtimeWorkerStatusCommand,
      createWorkerStatusHandler(worker),
      isTrustedSender,
    ),
  );
  ipcMain.handle(
    runtimeWorkerCheckCommand.channel,
    createCommandHandler(
      runtimeWorkerCheckCommand,
      createWorkerCheckHandler(worker),
      isTrustedSender,
    ),
  );
}

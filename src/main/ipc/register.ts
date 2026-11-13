// Wires command handlers to Electron's ipcMain. Each channel is registered exactly once;
// a second registration throws, which catches copy-paste mistakes at startup.
import { ipcMain } from 'electron';

import type { ActiveProfile } from '../profiles/active-profile';
import { ProfileService } from '../profiles/profile-service';
import type { WorkerBridge } from '../runtime-bridge/worker-bridge';
import type { Database } from '../storage/database';
import type { TemplateCatalog } from '../templates/catalog';
import { appLaunchInfoCommand, createLaunchInfoHandler } from './commands/app-launch-info';
import { appPingCommand, handleAppPing } from './commands/app-ping';
import {
  createWorkerCheckHandler,
  createWorkerStatusHandler,
  runtimeWorkerCheckCommand,
  runtimeWorkerStatusCommand,
} from './commands/runtime-worker';
import { createTemplateListHandler, templateListCommand } from './commands/template-list';
import {
  createProfileCreateHandler,
  createProfileListHandler,
  createProfileRenameHandler,
  createProfileSettingsGetHandler,
  createProfileSettingsUpdateHandler,
  profileCreateCommand,
  profileListCommand,
  profileRenameCommand,
  profileSettingsGetCommand,
  profileSettingsUpdateCommand,
} from './commands/profile';
import {
  createWorldCreateHandler,
  createWorldListHandler,
  createWorldRenameHandler,
  worldCreateCommand,
  worldListCommand,
  worldRenameCommand,
} from './commands/world';
import { createCommandHandler, trustRendererEntry } from './router';

export function registerIpcHandlers(
  rendererEntryUrl: string,
  db: Database,
  worker: WorkerBridge,
  templates: TemplateCatalog,
  activeProfile: ActiveProfile,
): void {
  const isTrustedSender = trustRendererEntry(rendererEntryUrl);
  const profiles = new ProfileService(activeProfile);
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
  ipcMain.handle(
    templateListCommand.channel,
    createCommandHandler(
      templateListCommand,
      createTemplateListHandler(templates),
      isTrustedSender,
    ),
  );
  ipcMain.handle(
    profileListCommand.channel,
    createCommandHandler(profileListCommand, createProfileListHandler(profiles), isTrustedSender),
  );
  ipcMain.handle(
    profileCreateCommand.channel,
    createCommandHandler(
      profileCreateCommand,
      createProfileCreateHandler(profiles),
      isTrustedSender,
    ),
  );
  ipcMain.handle(
    profileRenameCommand.channel,
    createCommandHandler(
      profileRenameCommand,
      createProfileRenameHandler(profiles),
      isTrustedSender,
    ),
  );
  ipcMain.handle(
    profileSettingsGetCommand.channel,
    createCommandHandler(
      profileSettingsGetCommand,
      createProfileSettingsGetHandler(profiles),
      isTrustedSender,
    ),
  );
  ipcMain.handle(
    profileSettingsUpdateCommand.channel,
    createCommandHandler(
      profileSettingsUpdateCommand,
      createProfileSettingsUpdateHandler(profiles),
      isTrustedSender,
    ),
  );
  ipcMain.handle(
    worldCreateCommand.channel,
    createCommandHandler(
      worldCreateCommand,
      createWorldCreateHandler(activeProfile),
      isTrustedSender,
    ),
  );
  ipcMain.handle(
    worldListCommand.channel,
    createCommandHandler(worldListCommand, createWorldListHandler(activeProfile), isTrustedSender),
  );
  ipcMain.handle(
    worldRenameCommand.channel,
    createCommandHandler(
      worldRenameCommand,
      createWorldRenameHandler(activeProfile),
      isTrustedSender,
    ),
  );
}

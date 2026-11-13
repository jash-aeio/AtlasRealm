// Wires command handlers to Electron's ipcMain. Each channel is registered exactly once;
// a second registration throws, which catches copy-paste mistakes at startup.
import { ipcMain } from 'electron';

import type { ActiveProfile } from '../profiles/active-profile';
import { ProfileService } from '../profiles/profile-service';
import type { WorkerBridge } from '../runtime-bridge/worker-bridge';
import { ProjectService } from '../services/project-service';
import type { Database } from '../storage/database';
import type { TemplateCatalog } from '../templates/catalog';
import { appLaunchInfoCommand, createLaunchInfoHandler } from './commands/app-launch-info';
import { appPingCommand, handleAppPing } from './commands/app-ping';
import {
  createProjectArchiveHandler,
  createProjectCreateHandler,
  createProjectGetHandler,
  createProjectListHandler,
  createProjectRenameHandler,
  createProjectRestoreFromTrashHandler,
  createProjectRestoreHandler,
  createProjectTrashHandler,
  createProjectUpdateGoalHandler,
  projectArchiveCommand,
  projectCreateCommand,
  projectGetCommand,
  projectListCommand,
  projectRenameCommand,
  projectRestoreCommand,
  projectRestoreFromTrashCommand,
  projectTrashCommand,
  projectUpdateGoalCommand,
} from './commands/project';
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
  // Uses the stub "active runs" probe until the run runtime exists (M4).
  const projects = new ProjectService(activeProfile, templates);
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
  ipcMain.handle(
    projectCreateCommand.channel,
    createCommandHandler(
      projectCreateCommand,
      createProjectCreateHandler(projects),
      isTrustedSender,
    ),
  );
  ipcMain.handle(
    projectGetCommand.channel,
    createCommandHandler(projectGetCommand, createProjectGetHandler(projects), isTrustedSender),
  );
  ipcMain.handle(
    projectListCommand.channel,
    createCommandHandler(projectListCommand, createProjectListHandler(projects), isTrustedSender),
  );
  ipcMain.handle(
    projectRenameCommand.channel,
    createCommandHandler(
      projectRenameCommand,
      createProjectRenameHandler(projects),
      isTrustedSender,
    ),
  );
  ipcMain.handle(
    projectUpdateGoalCommand.channel,
    createCommandHandler(
      projectUpdateGoalCommand,
      createProjectUpdateGoalHandler(projects),
      isTrustedSender,
    ),
  );
  ipcMain.handle(
    projectArchiveCommand.channel,
    createCommandHandler(
      projectArchiveCommand,
      createProjectArchiveHandler(projects),
      isTrustedSender,
    ),
  );
  ipcMain.handle(
    projectRestoreCommand.channel,
    createCommandHandler(
      projectRestoreCommand,
      createProjectRestoreHandler(projects),
      isTrustedSender,
    ),
  );
  ipcMain.handle(
    projectTrashCommand.channel,
    createCommandHandler(projectTrashCommand, createProjectTrashHandler(projects), isTrustedSender),
  );
  ipcMain.handle(
    projectRestoreFromTrashCommand.channel,
    createCommandHandler(
      projectRestoreFromTrashCommand,
      createProjectRestoreFromTrashHandler(projects),
      isTrustedSender,
    ),
  );
}

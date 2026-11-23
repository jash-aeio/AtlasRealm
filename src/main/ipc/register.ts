// Wires command handlers to Electron's ipcMain. Each channel is registered exactly once;
// a second registration throws, which catches copy-paste mistakes at startup.
import { ipcMain } from 'electron';
import type { z } from 'zod';

import { type ActiveProfile, refuseWhileSwitching } from '../profiles/active-profile';
import { ProfileService } from '../profiles/profile-service';
import type { WorkerBridge } from '../runtime-bridge/worker-bridge';
import { GraphService } from '../services/graph-service';
import { HotbarService } from '../services/hotbar-service';
import { PlacementService } from '../services/placement-service';
import { ProfileSession } from '../services/profile-session';
import { ProjectService } from '../services/project-service';
import type { TemplateCatalog } from '../templates/catalog';
import { BuildingAppearances } from '../world/building-appearances';
import { appLaunchInfoCommand, createLaunchInfoHandler } from './commands/app-launch-info';
import { appPingCommand, handleAppPing } from './commands/app-ping';
import {
  createPlacementCreateHandler,
  createPlacementListHandler,
  createPlacementMoveHandler,
  createPlacementRemoveHandler,
  placementCreateCommand,
  placementListCommand,
  placementMoveCommand,
  placementRemoveCommand,
} from './commands/placement';
import { createGraphWorldConnectionsHandler, graphWorldConnectionsCommand } from './commands/graph';
import {
  createHotbarAssignHandler,
  createHotbarClearHandler,
  createHotbarListHandler,
  hotbarAssignCommand,
  hotbarClearCommand,
  hotbarListCommand,
} from './commands/hotbar';
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
  createRelationCreateHandler,
  createRelationRemoveHandler,
  relationCreateCommand,
  relationRemoveCommand,
} from './commands/relation';
import {
  createWorkerCheckHandler,
  createWorkerStatusHandler,
  runtimeWorkerCheckCommand,
  runtimeWorkerStatusCommand,
} from './commands/runtime-worker';
import { createProfileSwitchHandler, profileSwitchCommand } from './commands/profile-switch';
import { createTemplateListHandler, templateListCommand } from './commands/template-list';
import {
  createProfileAtlasViewGetHandler,
  createProfileAtlasViewUpdateHandler,
  createProfileCreateHandler,
  createProfileListHandler,
  createProfileRenameHandler,
  createProfileSettingsGetHandler,
  createProfileSettingsUpdateHandler,
  createProfilePreferencesGetHandler,
  createProfilePreferencesUpdateHandler,
  profileAtlasViewGetCommand,
  profileAtlasViewUpdateCommand,
  profileCreateCommand,
  profileListCommand,
  profileRenameCommand,
  profileSettingsGetCommand,
  profileSettingsUpdateCommand,
  profilePreferencesGetCommand,
  profilePreferencesUpdateCommand,
} from './commands/profile';
import {
  createWorldCreateHandler,
  createWorldListHandler,
  createWorldRenameHandler,
  worldCreateCommand,
  worldListCommand,
  worldRenameCommand,
} from './commands/world';
import {
  type CommandDefinition,
  type CommandHandler,
  createCommandHandler,
  trustRendererEntry,
} from './router';

export function registerIpcHandlers(
  rendererEntryUrl: string,
  worker: WorkerBridge,
  templates: TemplateCatalog,
  activeProfile: ActiveProfile,
  /** Reloads the window after a profile switch; resolves once the old page is gone. */
  reloadRenderer: () => Promise<void>,
): void {
  const isTrustedSender = trustRendererEntry(rendererEntryUrl);
  const profiles = new ProfileService(activeProfile);
  // Uses the stub "active runs" probe until the run runtime exists (M4).
  const projects = new ProjectService(activeProfile, templates);
  // Footprints come from the bundled manifest, parsed once here; a broken one fails startup.
  const placements = new PlacementService(activeProfile, projects, BuildingAppearances.bundled());
  const hotbar = new HotbarService(activeProfile, projects);
  const graph = new GraphService(activeProfile, projects);
  const session = new ProfileSession({ active: activeProfile, worker, reloadRenderer });

  // Every command is refused while a profile switch is under way. Handlers that are already
  // running are covered too: ActiveProfile.current() refuses in the middle of a switch.
  function handle<I extends z.ZodType, O extends z.ZodType>(
    definition: CommandDefinition<I, O>,
    handler: CommandHandler<I, O>,
  ): void {
    ipcMain.handle(
      definition.channel,
      createCommandHandler(
        definition,
        refuseWhileSwitching(activeProfile, handler),
        isTrustedSender,
      ),
    );
  }

  handle(appPingCommand, handleAppPing);
  handle(
    appLaunchInfoCommand,
    createLaunchInfoHandler(() => activeProfile.current().db),
  );
  handle(runtimeWorkerStatusCommand, createWorkerStatusHandler(worker));
  handle(runtimeWorkerCheckCommand, createWorkerCheckHandler(worker));
  handle(templateListCommand, createTemplateListHandler(templates));
  handle(profileListCommand, createProfileListHandler(profiles));
  handle(profileCreateCommand, createProfileCreateHandler(profiles));
  handle(profileRenameCommand, createProfileRenameHandler(profiles));
  handle(profileSwitchCommand, createProfileSwitchHandler(session));
  handle(profileSettingsGetCommand, createProfileSettingsGetHandler(profiles));
  handle(profileSettingsUpdateCommand, createProfileSettingsUpdateHandler(profiles));
  handle(profilePreferencesGetCommand, createProfilePreferencesGetHandler(profiles));
  handle(profilePreferencesUpdateCommand, createProfilePreferencesUpdateHandler(profiles));
  handle(profileAtlasViewGetCommand, createProfileAtlasViewGetHandler(profiles));
  handle(profileAtlasViewUpdateCommand, createProfileAtlasViewUpdateHandler(profiles));
  handle(worldCreateCommand, createWorldCreateHandler(activeProfile));
  handle(worldListCommand, createWorldListHandler(activeProfile));
  handle(worldRenameCommand, createWorldRenameHandler(activeProfile));
  handle(projectCreateCommand, createProjectCreateHandler(projects));
  handle(projectGetCommand, createProjectGetHandler(projects));
  handle(projectListCommand, createProjectListHandler(projects));
  handle(projectRenameCommand, createProjectRenameHandler(projects));
  handle(projectUpdateGoalCommand, createProjectUpdateGoalHandler(projects));
  handle(projectArchiveCommand, createProjectArchiveHandler(projects));
  handle(projectRestoreCommand, createProjectRestoreHandler(projects));
  handle(projectTrashCommand, createProjectTrashHandler(projects));
  handle(projectRestoreFromTrashCommand, createProjectRestoreFromTrashHandler(projects));
  handle(placementListCommand, createPlacementListHandler(placements));
  handle(placementCreateCommand, createPlacementCreateHandler(placements));
  handle(placementMoveCommand, createPlacementMoveHandler(placements));
  handle(placementRemoveCommand, createPlacementRemoveHandler(placements));
  handle(hotbarListCommand, createHotbarListHandler(hotbar));
  handle(hotbarAssignCommand, createHotbarAssignHandler(hotbar));
  handle(hotbarClearCommand, createHotbarClearHandler(hotbar));
  handle(relationCreateCommand, createRelationCreateHandler(graph));
  handle(relationRemoveCommand, createRelationRemoveHandler(graph));
  handle(graphWorldConnectionsCommand, createGraphWorldConnectionsHandler(graph));
}

// The complete API the preload exposes to the renderer as `window.atlas`.
// Keep it small and explicit: one typed method per command, no generic `invoke`.
import type { LaunchInfoOutput } from './app-launch-info';
import type { PingInput, PingOutput } from './app-ping';
import type { IpcResult } from './ipc-result';
import type {
  ProfileCreateInput,
  ProfileCreateOutput,
  ProfileListOutput,
  ProfileRenameInput,
  ProfileSettingsOutput,
  ProfileSettingsUpdateInput,
} from './profile';
import type { TemplateListOutput } from './project-template';
import type { WorkerCheckInput, WorkerCheckOutput, WorkerStatusOutput } from './runtime-worker';
import type {
  WorldCreateInput,
  WorldListInput,
  WorldListOutput,
  WorldOutput,
  WorldRenameInput,
} from './world';

export interface AtlasApi {
  readonly app: {
    // Function properties, not methods: the bridge passes plain functions with no `this`.
    readonly ping: (input: PingInput) => Promise<IpcResult<PingOutput>>;
    readonly launchInfo: () => Promise<IpcResult<LaunchInfoOutput>>;
  };
  readonly runtime: {
    readonly workerStatus: () => Promise<IpcResult<WorkerStatusOutput>>;
    readonly workerCheck: (input?: WorkerCheckInput) => Promise<IpcResult<WorkerCheckOutput>>;
  };
  readonly template: {
    readonly list: () => Promise<IpcResult<TemplateListOutput>>;
  };
  /** Every profile command acts on the active profile (switching is M1-8). */
  readonly profile: {
    readonly list: () => Promise<IpcResult<ProfileListOutput>>;
    readonly create: (input: ProfileCreateInput) => Promise<IpcResult<ProfileCreateOutput>>;
    readonly rename: (input: ProfileRenameInput) => Promise<IpcResult<ProfileSettingsOutput>>;
    readonly settings: {
      readonly get: () => Promise<IpcResult<ProfileSettingsOutput>>;
      readonly update: (
        input: ProfileSettingsUpdateInput,
      ) => Promise<IpcResult<ProfileSettingsOutput>>;
    };
  };
  /** Worlds of the active profile. */
  readonly world: {
    readonly create: (input: WorldCreateInput) => Promise<IpcResult<WorldOutput>>;
    readonly list: (input?: WorldListInput) => Promise<IpcResult<WorldListOutput>>;
    readonly rename: (input: WorldRenameInput) => Promise<IpcResult<WorldOutput>>;
  };
}

// The complete API the preload exposes to the renderer as `window.atlas`.
// Keep it small and explicit: one typed method per command, no generic `invoke`.
import type { LaunchInfoOutput } from './app-launch-info';
import type { PingInput, PingOutput } from './app-ping';
import type { IpcResult } from './ipc-result';
import type { WorkerCheckInput, WorkerCheckOutput, WorkerStatusOutput } from './runtime-worker';

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
}

// The complete API the preload exposes to the renderer as `window.atlas`.
// Keep it small and explicit: one typed method per command, no generic `invoke`.
import type { PingInput, PingOutput } from './app-ping';
import type { IpcResult } from './ipc-result';

export interface AtlasApi {
  readonly app: {
    // Function properties, not methods: the bridge passes plain functions with no `this`.
    readonly ping: (input: PingInput) => Promise<IpcResult<PingOutput>>;
  };
}

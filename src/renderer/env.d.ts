import type { AtlasApi } from '../common/contracts/atlas-api';

declare global {
  interface Window {
    /** Exposed by src/preload/index.ts. The renderer's only way to reach the main process. */
    readonly atlas: AtlasApi;
  }
}

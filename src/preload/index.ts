// Preload: runs before the page, in an isolated world with a few Electron APIs.
// It is the only bridge between the renderer and the main process. It exposes one typed
// function per command and never a generic `invoke(channel, ...)`, so a compromised page
// can only call what is listed here, and the main process still validates every call.
import { contextBridge, ipcRenderer } from 'electron';

import type { AtlasApi } from '../common/contracts/atlas-api';
import { Channels } from '../common/contracts/channels';

const api: AtlasApi = {
  app: {
    ping: (input) => ipcRenderer.invoke(Channels.appPing, input),
    launchInfo: () => ipcRenderer.invoke(Channels.appLaunchInfo),
  },
  runtime: {
    workerStatus: () => ipcRenderer.invoke(Channels.runtimeWorkerStatus),
    workerCheck: (input) => ipcRenderer.invoke(Channels.runtimeWorkerCheck, input),
  },
  template: {
    list: () => ipcRenderer.invoke(Channels.templateList),
  },
};

contextBridge.exposeInMainWorld('atlas', api);

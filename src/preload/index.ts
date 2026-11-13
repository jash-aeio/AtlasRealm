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
  profile: {
    list: () => ipcRenderer.invoke(Channels.profileList),
    create: (input) => ipcRenderer.invoke(Channels.profileCreate, input),
    rename: (input) => ipcRenderer.invoke(Channels.profileRename, input),
    settings: {
      get: () => ipcRenderer.invoke(Channels.profileSettingsGet),
      update: (input) => ipcRenderer.invoke(Channels.profileSettingsUpdate, input),
    },
  },
  world: {
    create: (input) => ipcRenderer.invoke(Channels.worldCreate, input),
    list: (input) => ipcRenderer.invoke(Channels.worldList, input),
    rename: (input) => ipcRenderer.invoke(Channels.worldRename, input),
  },
};

contextBridge.exposeInMainWorld('atlas', api);

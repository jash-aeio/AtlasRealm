// IPC channel names. Kept free of runtime imports (no Zod) so the preload bundle stays tiny.
export const Channels = {
  appPing: 'app.ping',
  appLaunchInfo: 'app.launchInfo',
  runtimeWorkerStatus: 'runtime.workerStatus',
  runtimeWorkerCheck: 'runtime.workerCheck',
  templateList: 'template.list',
  profileList: 'profile.list',
  profileCreate: 'profile.create',
  profileRename: 'profile.rename',
  profileSettingsGet: 'profile.settings.get',
  profileSettingsUpdate: 'profile.settings.update',
  worldCreate: 'world.create',
  worldList: 'world.list',
  worldRename: 'world.rename',
  projectCreate: 'project.create',
  projectGet: 'project.get',
  projectList: 'project.list',
  projectRename: 'project.rename',
  projectUpdateGoal: 'project.updateGoal',
  projectArchive: 'project.archive',
  projectRestore: 'project.restore',
  projectTrash: 'project.trash',
  projectRestoreFromTrash: 'project.restoreFromTrash',
} as const;

export type Channel = (typeof Channels)[keyof typeof Channels];

// IPC channel names. Kept free of runtime imports (no Zod) so the preload bundle stays tiny.
export const Channels = {
  appPing: 'app.ping',
  appLaunchInfo: 'app.launchInfo',
} as const;

export type Channel = (typeof Channels)[keyof typeof Channels];

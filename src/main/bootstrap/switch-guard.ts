// Chromium switch guard (#20, SECURITY §21.1). Fuses turn off Node's back doors, but
// Chromium's command-line switches have no fuse. Anyone who can start our .exe could pass
// `--remote-debugging-port` and run code inside the trusted app://atlas page, where the IPC
// sender check passes. The packaged app therefore refuses to start with any switch below.
// No Electron import here, so the logic can be unit tested in plain Node.

/** Switches the packaged app refuses, grouped by why they are dangerous. */
export const BLOCKED_SWITCHES = [
  // Debuggers: attach to the renderer or main process and run code there.
  'remote-debugging-port',
  'remote-debugging-pipe',
  'inspect',
  'inspect-brk',
  'inspect-port',
  'js-flags',
  // Sandbox and isolation: remove the walls between web content and the system.
  'no-sandbox',
  'disable-web-security',
  'disable-site-isolation-trials',
  'single-process',
  // Child-process injection: run another program in front of our renderer/GPU/utility.
  'renderer-cmd-prefix',
  'gpu-launcher',
  'utility-cmd-prefix',
  'browser-subprocess-path',
  // Traffic interception: reroute or accept forged HTTPS (later: provider API keys).
  'proxy-server',
  'proxy-pac-url',
  'ignore-certificate-errors',
  'host-rules',
  'host-resolver-rules',
] as const;

export type BlockedSwitch = (typeof BLOCKED_SWITCHES)[number];

/**
 * The one switch the test-only package variant may use: the packaged smoke tests drive the
 * app over CDP (ADR-0015). Every other switch stays blocked there too.
 */
const TEST_BUILD_ALLOWED: ReadonlySet<BlockedSwitch> = new Set(['remote-debugging-port']);

/**
 * Returns the blocked switches present on the command line. `hasSwitch` should be
 * `app.commandLine.hasSwitch`: it uses Chromium's own parser, so `-x`, `/x` and upper-case
 * spellings that Chromium honours on Windows are caught too.
 */
export function findBlockedSwitches(
  hasSwitch: (name: string) => boolean,
  options: { readonly isTestBuild: boolean },
): BlockedSwitch[] {
  return BLOCKED_SWITCHES.filter(
    (name) => hasSwitch(name) && !(options.isTestBuild && TEST_BUILD_ALLOWED.has(name)),
  );
}

/**
 * True only for the test-only package variant. The marker is written into the package.json
 * inside app.asar at package time (`pnpm package:test`), never read from the environment:
 * an attacker can set environment variables as easily as switches.
 */
export function isPackagedTestBuild(packageJson: unknown): boolean {
  if (typeof packageJson !== 'object' || packageJson === null) return false;
  const atlas = (packageJson as { atlasRealm?: unknown }).atlasRealm;
  if (typeof atlas !== 'object' || atlas === null) return false;
  return (atlas as { packagedTest?: unknown }).packagedTest === true;
}

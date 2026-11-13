// Main process entry: the trusted side of the app. It owns windows, IPC and the database
// (later also files and providers). The renderer only gets what the preload exposes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { app, BrowserWindow, dialog } from 'electron';

import { APP_ENTRY_URL } from './bootstrap/app-origin';
import { blockFileProtocol, registerAppScheme, serveAppProtocol } from './bootstrap/app-protocol';
import { findBlockedSwitches, isPackagedTestBuild } from './bootstrap/switch-guard';
import {
  createMainWindow,
  installNavigationGuards,
  RENDERER_DIR,
  rendererEntryUrl,
} from './bootstrap/window';
import { registerIpcHandlers } from './ipc/register';
import { spawnUtilityWorker } from './runtime-bridge/utility-transport';
import { WorkerBridge } from './runtime-bridge/worker-bridge';
import { ProfileDataMissingError } from './storage/app-database';
import type { Database } from './storage/database';
import { ProfilesIndexCorruptError } from './storage/profiles/profiles-index';
import { openStartupProfile, ProfilesIndexMissingError } from './storage/profiles/startup';
import { loadBundledTemplateCatalog } from './templates/bundled-templates';

let database: Database | undefined;
// Trusted background work runs in a separate utility process (ARCHITECTURE §7.2, ADR-0012).
const worker = new WorkerBridge(spawnUtilityWorker);

function focusMainWindow(): void {
  const window = BrowserWindow.getAllWindows()[0];
  if (window === undefined) return;
  if (window.isMinimized()) window.restore();
  window.focus();
}

async function start(): Promise<void> {
  await app.whenReady();
  let db: Database;
  try {
    // Picks the last-used profile from profiles-index.json (adopting the M0 folder or
    // creating "Default" on the first M1 launch), then opens and migrates its database.
    const opened = await openStartupProfile(app.getPath('userData'));
    db = opened.db;
    database = db;
    console.info(
      `[storage] profile ${opened.profileId} (${opened.source}), ` +
        `schema v${String(opened.migration.toVersion)}, launch #${String(opened.launch.launchCount)}`,
    );
  } catch (error) {
    // No silent fallback to an empty database or a fresh profile list: either would look like
    // lost data. Any pre-migration backup stays in the profile's backups/ folder, and a corrupt
    // index stays where it is (OFFLINE_AND_RECOVERY §19). The dialog shows a fixed message plus
    // the error kind: raw messages can contain file paths (and so the Windows user name). Full
    // details go to the local log only.
    console.error('[storage] could not open the profile', error);
    const { title, body } = startupFailureMessage(error);
    dialog.showErrorBox(title, `${body}\n\nNo data was deleted. The app will now close.`);
    app.quit();
    return;
  }

  installNavigationGuards();
  blockFileProtocol();
  const entryUrl = rendererEntryUrl();
  // Only serve app:// when the build is in use; `pnpm dev` loads from the dev server.
  if (entryUrl === APP_ENTRY_URL) serveAppProtocol(RENDERER_DIR);
  // utilityProcess.fork only works after 'ready'. Start it now so its status is visible.
  // A failure here must not stop the window from opening: the worker is optional for the
  // UI, and the next worker request tries again (and reports the error through IPC).
  try {
    worker.start();
  } catch (error) {
    console.error('[runtime] could not start the worker', error);
  }
  // Validated once. A bad template is logged and listed as unavailable; it never stops startup.
  const templates = loadBundledTemplateCatalog();
  console.info(
    `[templates] ${String(templates.available.length)} available, ${String(templates.unavailable.length)} unavailable`,
  );
  registerIpcHandlers(entryUrl, db, worker, templates);
  createMainWindow();
}

/** Fixed, path-free wording for each startup failure the user can do something about. */
function startupFailureMessage(error: unknown): { title: string; body: string } {
  if (error instanceof ProfilesIndexCorruptError) {
    const problem =
      error.reason === 'newer_version'
        ? 'was written by a newer version of Atlas Realm'
        : `is damaged (${error.reason})`;
    return {
      title: 'Atlas Realm could not read its profile list',
      body:
        `The file profiles-index.json in the app's data folder ${problem}. ` +
        'It was left exactly as it is, so it can be inspected or restored.',
    };
  }
  if (error instanceof ProfilesIndexMissingError) {
    return {
      title: 'Atlas Realm could not find its profile list',
      body:
        "The file profiles-index.json is missing from the app's data folder, but profile " +
        'data is still there. No new profile was created, so your existing profiles stay ' +
        'hidden only until the file is restored.',
    };
  }
  if (error instanceof ProfileDataMissingError) {
    return {
      title: 'Atlas Realm could not find profile data',
      body: "The profile's database file is missing from the app's data folder.",
    };
  }
  const kind = error instanceof Error ? error.name : 'UnknownError';
  return {
    title: 'Atlas Realm could not open its data',
    body: `The database could not be opened or upgraded (${kind}).`,
  };
}

/** Reads the test-variant marker from the packaged package.json. Any failure means "not a test build". */
function readIsTestBuild(): boolean {
  try {
    return isPackagedTestBuild(
      JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as unknown,
    );
  } catch {
    return false;
  }
}

/**
 * The packaged app refuses Chromium switches that bypass its security boundary (#20,
 * SECURITY §21.1). Runs before anything else: no lock, DB, protocol or window yet. Almost all
 * listed switches act only when the DevTools server or a child process starts, after this
 * script, so e.g. the debugging port never opens. Exception: --js-flags already reached V8 in
 * this process at startup; refusing still keeps it out of renderers and ends the process.
 * `pnpm dev` and the dev E2E tests are not packaged and keep their switches.
 */
function refuseBlockedSwitches(): boolean {
  if (!app.isPackaged) return false;
  const found = findBlockedSwitches((name) => app.commandLine.hasSwitch(name), {
    isTestBuild: readIsTestBuild(),
  });
  if (found.length === 0) return false;
  // No dialog: a modal box would leave the process hanging for automation, and it tells an
  // attacker nothing they don't know. The switch names are ours, never user data.
  console.error(`[security] refusing to start with blocked switches: ${found.join(', ')}`);
  app.exit(1);
  return true;
}

// One running copy per user profile folder (ARCHITECTURE §7.4). A second copy would open the
// same database and could race the first through migrations, so it quits and focuses the first.
if (refuseBlockedSwitches()) {
  // app.exit is already under way; register nothing else.
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerAppScheme(); // must happen before 'ready'
  app.on('second-instance', focusMainWindow);
  app.on('window-all-closed', () => {
    app.quit();
  });
  app.on('will-quit', () => {
    // Electron ends utility processes when the app exits anyway (E2E checks no worker is left).
    // Stopping first marks it as deliberate: no crash is logged, and pending requests fail
    // with worker_stopped rather than worker_crashed.
    worker.stop();
    // Closing checkpoints the WAL back into app.sqlite, leaving one tidy file.
    if (database?.isOpen) database.close();
  });
  void start();
}

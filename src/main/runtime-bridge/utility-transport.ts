// The real WorkerTransport: an Electron utility process (ADR-0012). It is a separate OS
// process, so a crash or a busy loop in the worker can't freeze or kill the main process,
// and Electron reports its exit code. It works with the RunAsNode fuse off, unlike
// child_process.fork.
import { MessageChannelMain, utilityProcess } from 'electron';

// electron-vite builds the worker as its own bundle and gives us its output path.
import workerModulePath from '../../worker/index?modulePath';
import type { WorkerTransport } from './worker-bridge';

/** The process name in app.getAppMetrics() (its `name` field; `serviceName` there is Electron's own). */
export const WORKER_SERVICE_NAME = 'Atlas Realm worker';

export function spawnUtilityWorker(): WorkerTransport {
  const child = utilityProcess.fork(workerModulePath, [], {
    serviceName: WORKER_SERVICE_NAME,
    // The worker's console output goes to the app's own stdout/stderr (the local log).
    stdio: 'inherit',
  });
  const { port1, port2 } = new MessageChannelMain();
  // Hand the worker its end of the private channel (see src/worker/index.ts).
  child.postMessage({ kind: 'connect' }, [port2]);
  port1.start();

  let exited = false;
  child.once('exit', () => {
    exited = true;
    port1.close();
  });

  return {
    post(message) {
      // Posting after exit used to crash some Electron versions; it's pointless anyway.
      if (!exited) port1.postMessage(message);
    },
    onMessage(listener) {
      port1.on('message', (event) => {
        listener(event.data);
      });
    },
    onExit(listener) {
      child.once('exit', listener);
    },
    kill() {
      child.kill();
    },
  };
}

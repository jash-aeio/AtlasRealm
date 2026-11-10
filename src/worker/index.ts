// Worker entry: runs in an Electron utility process forked by the main process
// (src/main/runtime-bridge/utility-transport.ts, ADR-0012). It has Node APIs but no windows,
// IPC to the renderer or database. It talks only to main, over a private MessagePort.
//
// Handshake: main posts one `connect` message on `process.parentPort` that carries the port.
// Only main can post on parentPort, and only main and this worker hold the two ends of that
// port, so every later message is known to come from main (ARCHITECTURE §7.2: authenticated
// internal messaging, no localhost server).
import { createDispatcher, createSpikeHandlers } from './dispatcher';

let connected = false;

process.parentPort.on('message', (event) => {
  const [port] = event.ports;
  // Exactly one connect, carrying exactly one port. Anything else is a bug in main.
  if (connected || port === undefined || event.ports.length !== 1) {
    console.error('[worker] unexpected parentPort message; ignored');
    return;
  }
  connected = true;
  const dispatcher = createDispatcher((message) => {
    port.postMessage(message);
  }, createSpikeHandlers(process.pid));
  port.on('message', (message) => {
    dispatcher.handle(message.data);
  });
  // If main goes away, nothing can use our results: exit instead of lingering.
  port.on('close', () => {
    process.exit(0);
  });
  port.start();
  port.postMessage({ kind: 'ready', pid: process.pid });
});

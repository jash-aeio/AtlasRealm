/**
 * The dev server URL comes from the environment, which we don't control (a leaked shell
 * variable could point it anywhere). Only accept plain http on this machine with a port.
 */
export function assertLocalDevServerUrl(value: string): string {
  let url: URL | undefined;
  try {
    url = new URL(value);
  } catch {
    url = undefined;
  }
  const isLocal =
    url !== undefined &&
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1') &&
    url.port !== '';
  if (!isLocal) {
    throw new Error(
      'ELECTRON_RENDERER_URL must be http://localhost:<port> or http://127.0.0.1:<port>',
    );
  }
  return value;
}

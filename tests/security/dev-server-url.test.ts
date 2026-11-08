import { describe, expect, it } from 'vitest';

import { assertLocalDevServerUrl } from '../../src/main/bootstrap/dev-server-url';

describe('assertLocalDevServerUrl', () => {
  it.each(['http://localhost:5173/', 'http://127.0.0.1:5173'])('accepts %s', (url) => {
    expect(assertLocalDevServerUrl(url)).toBe(url);
  });

  it.each([
    'https://evil.example/',
    'http://evil.example:5173/',
    'http://localhost/', // no port
    'https://localhost:5173/', // not what electron-vite serves
    'file:///C:/evil.html',
    'http://localhost.evil.example:5173/',
    'not a url',
  ])('rejects %s', (url) => {
    expect(() => assertLocalDevServerUrl(url)).toThrow(/ELECTRON_RENDERER_URL/);
  });
});

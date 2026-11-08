import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_ENTRY_URL, resolveAppRequestPath } from '../../src/main/bootstrap/app-origin';

// Windows paths on purpose: the app and CI target Windows, where drive letters, backslashes
// and UNC shares are the interesting escape routes.
const ROOT = 'C:\\Program Files\\Atlas Realm\\out\\renderer';
const resolveUrl = (url: string): string | undefined => resolveAppRequestPath(ROOT, url);

describe('resolveAppRequestPath', () => {
  it('serves index.html for the entry URL and the bare origin', () => {
    expect(resolveUrl(APP_ENTRY_URL)).toBe(join(ROOT, 'index.html'));
    expect(resolveUrl('app://atlas/')).toBe(join(ROOT, 'index.html'));
    expect(resolveUrl('app://atlas')).toBe(join(ROOT, 'index.html'));
  });

  it('maps bundled assets inside the root (query and hash ignored)', () => {
    expect(resolveUrl('app://atlas/assets/index-abc.js?v=1#x')).toBe(
      join(ROOT, 'assets', 'index-abc.js'),
    );
    expect(resolveUrl('app://atlas/assets/my%20icon.png')).toBe(
      join(ROOT, 'assets', 'my icon.png'),
    );
  });

  it('keeps a file whose name merely starts with two dots', () => {
    expect(resolveUrl('app://atlas/..notes.txt')).toBe(join(ROOT, '..notes.txt'));
  });

  it.each([
    ['encoded slash after ..', 'app://atlas/..%2F..%2Fsecret.txt'],
    ['mixed-case encoded slash', 'app://atlas/..%2f..%2Fmain/index.js'],
    ['encoded backslash', 'app://atlas/..%5C..%5Csecret.txt'],
    ['literal backslash', 'app://atlas/..\\..\\secret.txt'],
    ['drive letter path', 'app://atlas/C:/Windows/win.ini'],
    ['encoded drive letter path', 'app://atlas/C%3A%5CWindows%5Cwin.ini'],
    ['UNC share', 'app://atlas/%5C%5Cattacker%5Cshare%5Cx.png'],
    ['the root folder itself', 'app://atlas/assets%2F..'],
    ['null byte', 'app://atlas/index.html%00.png'],
    ['malformed escape', 'app://atlas/%E0%A4%A'],
  ])('refuses %s', (_label, url) => {
    expect(resolveUrl(url)).toBeUndefined();
  });

  it.each([
    ['plain dot segments', 'app://atlas/../../Windows/win.ini', join(ROOT, 'Windows', 'win.ini')],
    ['encoded dot segments', 'app://atlas/%2e%2e/%2E%2E/win.ini', join(ROOT, 'win.ini')],
    ['a trailing ..', 'app://atlas/assets/..', join(ROOT, 'index.html')],
  ])('stays inside the root for %s (URL parsing collapses them first)', (_label, url, expected) => {
    expect(resolveUrl(url)).toBe(expected);
  });

  it.each([
    ['another host', 'app://evil/index.html'],
    ['credentials in the URL', 'app://user:pw@atlas/index.html'],
    ['a port', 'app://atlas:8080/index.html'],
    ['file scheme', 'file:///C:/Program%20Files/Atlas%20Realm/out/renderer/index.html'],
    ['http scheme', 'http://atlas/index.html'],
    ['not a URL', 'index.html'],
  ])('refuses %s', (_label, url) => {
    expect(resolveUrl(url)).toBeUndefined();
  });
});

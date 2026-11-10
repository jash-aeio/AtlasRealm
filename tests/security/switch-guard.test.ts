import { describe, expect, it } from 'vitest';

import {
  BLOCKED_SWITCHES,
  findBlockedSwitches,
  isPackagedTestBuild,
} from '../../src/main/bootstrap/switch-guard';

// A fake for app.commandLine.hasSwitch: present switches are the given names.
const commandLine =
  (...present: string[]) =>
  (name: string): boolean =>
    present.includes(name);

describe('findBlockedSwitches', () => {
  it('passes a clean command line (and harmless switches such as user-data-dir)', () => {
    expect(findBlockedSwitches(commandLine(), { isTestBuild: false })).toEqual([]);
    expect(
      findBlockedSwitches(commandLine('user-data-dir', 'lang'), { isTestBuild: false }),
    ).toEqual([]);
  });

  it.each(BLOCKED_SWITCHES)('refuses --%s in the shipped build', (name) => {
    expect(findBlockedSwitches(commandLine(name), { isTestBuild: false })).toEqual([name]);
  });

  it('includes every switch named in the issue', () => {
    expect(BLOCKED_SWITCHES).toEqual(
      expect.arrayContaining([
        'remote-debugging-port',
        'remote-debugging-pipe',
        'no-sandbox',
        'disable-web-security',
        'inspect',
        'inspect-brk',
        'js-flags',
      ]),
    );
  });

  it('reports all blocked switches present, in list order', () => {
    expect(
      findBlockedSwitches(commandLine('no-sandbox', 'remote-debugging-port'), {
        isTestBuild: false,
      }),
    ).toEqual(['remote-debugging-port', 'no-sandbox']);
  });

  it('lets the test build use only --remote-debugging-port', () => {
    expect(
      findBlockedSwitches(commandLine('remote-debugging-port'), { isTestBuild: true }),
    ).toEqual([]);
    for (const name of BLOCKED_SWITCHES.filter((n) => n !== 'remote-debugging-port')) {
      expect(findBlockedSwitches(commandLine(name), { isTestBuild: true })).toEqual([name]);
    }
  });
});

describe('isPackagedTestBuild', () => {
  it('is true only for the exact boolean marker', () => {
    expect(isPackagedTestBuild({ name: 'atlas-realm', atlasRealm: { packagedTest: true } })).toBe(
      true,
    );
  });

  it.each([
    ['no package.json data', undefined],
    ['null', null],
    ['a normal package.json', { name: 'atlas-realm', productName: 'Atlas Realm' }],
    ['marker as a string', { atlasRealm: { packagedTest: 'true' } }],
    ['marker as 1', { atlasRealm: { packagedTest: 1 } }],
    ['marker false', { atlasRealm: { packagedTest: false } }],
    ['atlasRealm not an object', { atlasRealm: true }],
  ])('is false for %s', (_label, value) => {
    expect(isPackagedTestBuild(value)).toBe(false);
  });
});

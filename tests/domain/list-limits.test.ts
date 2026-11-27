import { describe, expect, it } from 'vitest';

import { omittedNotice } from '../../src/renderer/state/list-limits';

describe('omittedNotice (#61)', () => {
  it('says nothing when the whole list is shown', () => {
    expect(omittedNotice('profile', 3, 0)).toBeNull();
    expect(omittedNotice('world', 100, 0)).toBeNull();
  });

  it('names the totals and says nothing was deleted', () => {
    expect(omittedNotice('profile', 50, 1)).toBe(
      'Showing 50 of 51 profiles. The other one is kept on this computer; nothing was deleted.',
    );
    expect(omittedNotice('world', 100, 7)).toBe(
      'Showing 100 of 107 worlds. The other 7 are kept in this profile; nothing was deleted.',
    );
  });
});

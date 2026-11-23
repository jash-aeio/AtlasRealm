// The library's tab keys (M2-9 #74): the WAI-ARIA tabs pattern, as pure logic.
import { describe, expect, it } from 'vitest';

import { LIBRARY_TABS, PLANNED_LABEL, tabForKey } from '../../src/renderer/library/library-tabs';

describe('library tabs', () => {
  it('has the six UI_SPEC §6.3 tabs, and only Projects and Building Appearances are built', () => {
    expect(LIBRARY_TABS.map((tab) => tab.label)).toEqual([
      'Projects',
      'Agents',
      'Skills',
      'Tools',
      'Workflows',
      'Building Appearances',
    ]);
    const planned = LIBRARY_TABS.filter((tab) => tab.planned !== undefined).map((tab) => tab.id);
    expect(planned).toEqual(['agents', 'skills', 'tools', 'workflows']);
    expect(PLANNED_LABEL).toBe('Planned for M3');
  });

  it('arrows move to the next or previous tab and wrap around', () => {
    expect(tabForKey('projects', 'ArrowRight')).toBe('agents');
    expect(tabForKey('agents', 'ArrowLeft')).toBe('projects');
    expect(tabForKey('appearances', 'ArrowRight')).toBe('projects');
    expect(tabForKey('projects', 'ArrowLeft')).toBe('appearances');
  });

  it('Home and End jump to the first and last tab', () => {
    expect(tabForKey('tools', 'Home')).toBe('projects');
    expect(tabForKey('tools', 'End')).toBe('appearances');
  });

  it('other keys are left alone', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'e', ' ']) {
      expect(tabForKey('skills', key)).toBeNull();
    }
  });
});

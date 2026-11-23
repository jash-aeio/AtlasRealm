// The library's tabs (UI_SPEC §6.3, M2-9 #74) and how the keyboard moves between them.
//
// The tab list follows the WAI-ARIA "tabs" pattern: Tab reaches only the selected tab, the arrow
// keys move to the previous or next tab (wrapping around), Home and End jump to the first and
// last, and moving selects (automatic activation, since every panel shows at once).
//
// Pure TypeScript with no React or DOM imports, so the key logic is unit-tested in plain Node.

export type LibraryTabId = 'projects' | 'agents' | 'skills' | 'tools' | 'workflows' | 'appearances';

export interface LibraryTab {
  readonly id: LibraryTabId;
  readonly label: string;
  /** For the tabs that are not built yet: what they will hold, in plain words. */
  readonly planned?: string;
}

/** The note on every tab that is not built yet. */
export const PLANNED_LABEL = 'Planned for M3';

export const LIBRARY_TABS: readonly LibraryTab[] = [
  { id: 'projects', label: 'Projects' },
  {
    id: 'agents',
    label: 'Agents',
    planned: 'The AI agents you can add to projects, with what each one is allowed to do.',
  },
  { id: 'skills', label: 'Skills', planned: 'Reusable skills that agents can use.' },
  {
    id: 'tools',
    label: 'Tools',
    planned: 'The tools agents may use, and the permissions each one needs.',
  },
  { id: 'workflows', label: 'Workflows', planned: 'Step-by-step workflows that run work for you.' },
  { id: 'appearances', label: 'Building Appearances' },
];

/**
 * The tab a key moves to from `current`, or null when the key doesn't move between tabs (so
 * the caller leaves it alone).
 */
export function tabForKey(current: LibraryTabId, key: string): LibraryTabId | null {
  const index = LIBRARY_TABS.findIndex((tab) => tab.id === current);
  const last = LIBRARY_TABS.length - 1;
  let next: number;
  if (key === 'ArrowRight') next = index === last ? 0 : index + 1;
  else if (key === 'ArrowLeft') next = index <= 0 ? last : index - 1;
  else if (key === 'Home') next = 0;
  else if (key === 'End') next = last;
  else return null;
  return LIBRARY_TABS[next]?.id ?? null;
}

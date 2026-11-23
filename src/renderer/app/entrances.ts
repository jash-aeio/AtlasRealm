// The sidebar entrances of the main screen (UI_SPEC §6.1), plus the bottom bar's Library.
// Projects, Settings and the Library (M2-9) are built; the others open a panel that says so (no
// fake content).

export type EntranceId =
  'projects' | 'agents' | 'skills' | 'tools' | 'automations' | 'activity' | 'settings';

/** 'project' is the details panel that "Open" shows for one project (M2-6). */
export type PanelId = EntranceId | 'library' | 'project';

interface Entrance {
  readonly id: EntranceId;
  readonly label: string;
}

export const ENTRANCES: readonly Entrance[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'agents', label: 'Agents Guild' },
  { id: 'skills', label: 'Skill Library' },
  { id: 'tools', label: 'Tool Shops' },
  { id: 'automations', label: 'Automations' },
  { id: 'activity', label: 'Activity' },
  { id: 'settings', label: 'Settings' },
];

/** What an unbuilt panel will hold, in plain words, and when it is planned. */
export const NOT_BUILT: Readonly<
  Partial<Record<PanelId, { readonly planned: string; readonly purpose: string }>>
> = {
  agents: {
    planned: 'Not built yet (planned for M3+)',
    purpose: 'Where you will add and manage the AI agents that work on your projects.',
  },
  skills: {
    planned: 'Not built yet (planned for M3+)',
    purpose: 'Reusable skills that agents can use.',
  },
  tools: {
    planned: 'Not built yet (planned for M3+)',
    purpose: 'The tools agents may use, and the permissions each one needs.',
  },
  automations: {
    planned: 'Not built yet (planned for M3+)',
    purpose: 'Schedules and workflows that run work for you.',
  },
  activity: {
    planned: 'Not built yet (planned for M3+)',
    purpose: 'A history of runs, approvals and outputs.',
  },
};

export function panelTitle(id: PanelId): string {
  if (id === 'library') return 'Library';
  if (id === 'project') return 'Project details';
  return ENTRANCES.find((entrance) => entrance.id === id)?.label ?? id;
}

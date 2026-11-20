// The app's service structures: the fixed sidebar entrances (UI_SPEC §6.1) that a hotbar slot
// or, later, a building can stand for. Plain data shared by main and renderer.
//
// The database only checks the shape of a service kind (a lowercase slug, schema v5); this list
// is the exact set, checked by the repositories (ADR-0023). Adding a service is a code change
// here, not a table rebuild. Never rename or remove an entry: saved rows may already use it.

export const SERVICE_KINDS = [
  'agents-guild',
  'skill-library',
  'tool-shops',
  'automations',
  'activity',
  'settings',
] as const;

export type ServiceKind = (typeof SERVICE_KINDS)[number];

export function isServiceKind(value: string): value is ServiceKind {
  return (SERVICE_KINDS as readonly string[]).includes(value);
}

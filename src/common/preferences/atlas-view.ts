// Realm Atlas display preferences (M2-12 #77, GRAPH_MODEL §30.1, ADR-0031): per world, which tab
// is open, whether the panel is collapsed or expanded, its width, the project it is pinned to and
// whether the camera follows the selection. They live in `profile_settings.preferences_json`
// under the `atlasViews` key, next to the comfort preferences (ADR-0028), and like them they are
// cosmetic: a pin never grants access to anything, and the layout never moves files.
//
// Shared by the main process (which reads and merges them) and the renderer (which uses the
// types and bounds). Pure: no DOM, no database.
import { z } from 'zod';

import { ProjectId } from '../contracts/project';
import { WorldId } from '../contracts/world';

/** Width bounds of the Atlas + inspector column, in CSS pixels. */
export const ATLAS_WIDTH_MIN = 256;
export const ATLAS_WIDTH_MAX = 720;
export const ATLAS_WIDTH_DEFAULT = 320;

/**
 * At most this many worlds keep Atlas preferences; the least recently changed is dropped first.
 * One entry is about 170 bytes, so 32 of them (≈ 5.5 KiB) fit beside 64 saved cameras inside
 * the 16 KiB preferences limit.
 */
export const MAX_ATLAS_VIEWS = 32;

export const AtlasTab = z.enum(['map', 'connections']);
export type AtlasTab = z.infer<typeof AtlasTab>;

const AtlasWidth = z.number().int().min(ATLAS_WIDTH_MIN).max(ATLAS_WIDTH_MAX);

export const AtlasView = z.strictObject({
  tab: AtlasTab,
  collapsed: z.boolean(),
  expanded: z.boolean(),
  width: AtlasWidth,
  /** The project the Atlas stays on whatever is selected, or null to follow the selection. */
  pinnedProjectId: ProjectId.nullable(),
  /** When on, selecting a placed project centres the camera on it (never while editing). */
  followSelection: z.boolean(),
});
export type AtlasView = z.infer<typeof AtlasView>;

export const DEFAULT_ATLAS_VIEW: AtlasView = {
  tab: 'map',
  collapsed: false,
  expanded: false,
  width: ATLAS_WIDTH_DEFAULT,
  pinnedProjectId: null,
  followSelection: false,
};

/** By world ID, least recently changed first. */
export const AtlasViews = z
  .record(WorldId, AtlasView)
  .refine((views) => Object.keys(views).length <= MAX_ATLAS_VIEWS, 'too many Atlas views');
export type AtlasViews = z.infer<typeof AtlasViews>;

/** One change to one world's view. Omitted fields stay as they are. */
export const AtlasViewChange = z
  .strictObject({
    tab: AtlasTab.optional(),
    collapsed: z.boolean().optional(),
    expanded: z.boolean().optional(),
    width: AtlasWidth.optional(),
    pinnedProjectId: ProjectId.nullable().optional(),
    followSelection: z.boolean().optional(),
  })
  .refine((change) => Object.keys(change).length > 0, 'nothing to update');
export type AtlasViewChange = z.infer<typeof AtlasViewChange>;

/** The key in `preferences_json` that holds the Atlas views. */
export const ATLAS_VIEWS_KEY = 'atlasViews';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One stored view, field by field: a field that doesn't check out falls back on its own. */
function parseView(stored: Record<string, unknown>): AtlasView {
  const field = <T>(schema: z.ZodType<T>, key: keyof AtlasView, fallback: T): T => {
    const parsed = schema.safeParse(stored[key]);
    return parsed.success ? parsed.data : fallback;
  };
  const d = DEFAULT_ATLAS_VIEW;
  return {
    tab: field(AtlasTab, 'tab', d.tab),
    collapsed: field(z.boolean(), 'collapsed', d.collapsed),
    expanded: field(z.boolean(), 'expanded', d.expanded),
    width: field(AtlasWidth, 'width', d.width),
    pinnedProjectId: field(ProjectId.nullable(), 'pinnedProjectId', d.pinnedProjectId),
    followSelection: field(z.boolean(), 'followSelection', d.followSelection),
  };
}

/**
 * Reads the Atlas views out of a whole preferences object. Forgiving on purpose, like
 * parseComfortPreferences: the stored JSON may be older, newer or hand-edited, so a bad field
 * falls back to its default and an entry with a bad world ID is dropped. It never throws.
 */
export function parseAtlasViews(preferences: unknown): AtlasViews {
  const stored = isRecord(preferences) ? preferences[ATLAS_VIEWS_KEY] : undefined;
  if (!isRecord(stored)) return {};
  const entries: [string, AtlasView][] = [];
  for (const [worldId, raw] of Object.entries(stored)) {
    if (WorldId.safeParse(worldId).success && isRecord(raw))
      entries.push([worldId, parseView(raw)]);
  }
  return Object.fromEntries(entries.slice(-MAX_ATLAS_VIEWS));
}

/** A world's view, or the defaults when nothing is saved for it. */
export function atlasViewOf(views: AtlasViews, worldId: string): AtlasView {
  return views[worldId] ?? DEFAULT_ATLAS_VIEW;
}

/**
 * Applies one change to one world. The world moves to the end (most recent), and the oldest
 * entries beyond MAX_ATLAS_VIEWS are dropped.
 */
export function applyAtlasViewChange(
  views: AtlasViews,
  worldId: string,
  change: AtlasViewChange,
): AtlasViews {
  const next: AtlasView = { ...atlasViewOf(views, worldId) };
  // Copy only the fields that are present, so `undefined` never overwrites a saved value.
  if (change.tab !== undefined) next.tab = change.tab;
  if (change.collapsed !== undefined) next.collapsed = change.collapsed;
  if (change.expanded !== undefined) next.expanded = change.expanded;
  if (change.width !== undefined) next.width = change.width;
  if (change.pinnedProjectId !== undefined) next.pinnedProjectId = change.pinnedProjectId;
  if (change.followSelection !== undefined) next.followSelection = change.followSelection;
  const others = Object.entries(views).filter(([id]) => id !== worldId);
  return Object.fromEntries([...others, [worldId, next] as const].slice(-MAX_ATLAS_VIEWS));
}

/** Writes the Atlas views back into a whole preferences object, keeping its other keys. */
export function withAtlasViews(
  preferences: Readonly<Record<string, unknown>>,
  views: AtlasViews,
): Record<string, unknown> {
  return { ...preferences, [ATLAS_VIEWS_KEY]: views };
}

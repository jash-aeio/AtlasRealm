// IPC contracts for projects (M1-7 #34, ARCHITECTURE §16.1, ADR-0020).
//
// Every call names the world as well as the project: the service checks that the project
// really belongs to that world, and a mismatch is `not_found`, the same as an unknown ID.
// Every change carries the revision the caller last read (DATA_MODEL §9.2). Nothing here
// deletes: archive and trash are reversible status changes (PRD §5.6; no permanent delete in M1).
import { z } from 'zod';

import { DisplayName, Revision, Timestamp } from './display-name';
import { TemplateId, TemplateVersion } from './project-template';
import { WorldId } from './world';

/** At most this many projects per world, trashed ones included, so a world stays bounded. */
export const MAX_PROJECTS_PER_WORLD = 1000;
export const PROJECT_PAGE_SIZE_DEFAULT = 50;
export const PROJECT_PAGE_SIZE_MAX = 100;
export const PROJECT_GOAL_MAX_CHARS = 2000;

/** Lowercase UUID, the only form the app generates. */
export const ProjectId = WorldId;

export const ProjectStatus = z.enum(['active', 'archived', 'trashed']);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

// Same character rules as DisplayName, but may be empty and may span lines. The repository
// (normalizeText) runs the full check again in the main process.
const FORBIDDEN_IN_GOAL =
  /[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C\u00AD\u2060-\u2064\uFEFF\u{E0000}-\u{E007F}]/u;
const CONTROL_EXCEPT_LINE_BREAKS = /(?![\t\n\r])\p{Cc}/u;
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/** Free text, trimmed, 0–2000 characters (code points); line breaks and tabs allowed. */
export const ProjectGoal = z
  .string()
  .max(PROJECT_GOAL_MAX_CHARS * 2 + 64)
  .trim()
  .refine((goal) => Array.from(goal).length <= PROJECT_GOAL_MAX_CHARS, 'goal is too long')
  .refine(
    (goal) =>
      !FORBIDDEN_IN_GOAL.test(goal) &&
      !CONTROL_EXCEPT_LINE_BREAKS.test(goal) &&
      !LONE_SURROGATE.test(goal),
    'invalid characters',
  );

/**
 * Where the next page starts. Opaque to the renderer: it passes back what `project.list`
 * returned and never builds one. The main process decodes and checks it.
 */
export const ProjectCursor = z
  .string()
  .min(1)
  .max(1024)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Result of the stubbed "active runs" check (until the run runtime exists in M4). */
export const RunCheck = z.literal('stub');

export const ProjectSummary = z.strictObject({
  id: ProjectId,
  worldId: WorldId,
  // Plain bounded strings on output: one row with unusual stored text must not fail a page
  // (input still uses DisplayName / ProjectGoal, and the repository checks again).
  name: z.string().max(400),
  goal: z.string().max(PROJECT_GOAL_MAX_CHARS * 2),
  templateId: z.string().max(100),
  templateVersion: z.string().max(32),
  status: ProjectStatus,
  archivedAt: Timestamp.nullable(),
  trashedAt: Timestamp.nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  revision: Revision,
});
export type ProjectSummary = z.infer<typeof ProjectSummary>;

export const ProjectOutput = z.strictObject({ project: ProjectSummary });
export type ProjectOutput = z.infer<typeof ProjectOutput>;

/**
 * Archive and trash also say how active runs were checked. `stub` means no run runtime exists
 * yet, so "no active runs" was assumed, not verified (real handling arrives in M4).
 */
export const ProjectLifecycleOutput = z.strictObject({
  project: ProjectSummary,
  runCheck: RunCheck,
});
export type ProjectLifecycleOutput = z.infer<typeof ProjectLifecycleOutput>;

/** Identifies one project and the world it must belong to. */
const ProjectRef = { worldId: WorldId, projectId: ProjectId } as const;
/** A change to one project, based on the revision the caller last read. */
const ProjectChange = { ...ProjectRef, expectedRevision: Revision } as const;

// ---- project.create --------------------------------------------------------------------

export const ProjectCreateInput = z.strictObject({
  worldId: WorldId,
  templateId: TemplateId,
  templateVersion: TemplateVersion,
  name: DisplayName,
  goal: ProjectGoal.default(''),
});
export type ProjectCreateInput = z.input<typeof ProjectCreateInput>;

// ---- project.get -----------------------------------------------------------------------

export const ProjectGetInput = z.strictObject(ProjectRef);
export type ProjectGetInput = z.infer<typeof ProjectGetInput>;

// ---- project.list ----------------------------------------------------------------------

/** One status at a time (active by default), by name. Pass `cursor` back for the next page. */
export const ProjectListInput = z.strictObject({
  worldId: WorldId,
  status: ProjectStatus.default('active'),
  cursor: ProjectCursor.optional(),
  limit: z.int().min(1).max(PROJECT_PAGE_SIZE_MAX).default(PROJECT_PAGE_SIZE_DEFAULT),
});
export type ProjectListInput = z.input<typeof ProjectListInput>;

export const ProjectListOutput = z.strictObject({
  projects: z.array(ProjectSummary).max(PROJECT_PAGE_SIZE_MAX),
  /** null on the last page. */
  nextCursor: ProjectCursor.nullable(),
});
export type ProjectListOutput = z.infer<typeof ProjectListOutput>;

// ---- project.rename / project.updateGoal -----------------------------------------------

export const ProjectRenameInput = z.strictObject({ ...ProjectChange, name: DisplayName });
export type ProjectRenameInput = z.infer<typeof ProjectRenameInput>;

export const ProjectUpdateGoalInput = z.strictObject({ ...ProjectChange, goal: ProjectGoal });
export type ProjectUpdateGoalInput = z.input<typeof ProjectUpdateGoalInput>;

// ---- project.archive / restore / trash / restoreFromTrash ------------------------------

/** Shared by the four lifecycle commands: which project, at which revision. */
export const ProjectLifecycleInput = z.strictObject(ProjectChange);
export type ProjectLifecycleInput = z.infer<typeof ProjectLifecycleInput>;

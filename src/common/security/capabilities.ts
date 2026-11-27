// The registry of capability IDs (SECURITY §13.1; M3-1 #111).
//
// A capability names one kind of operation a tool can perform, such as reading a project's
// files. Packages *declare* the capabilities they need (resource-manifest.ts), and the
// permission broker (M3-10, M3-11) decides at run time whether a grant covers the request.
//
// This module only describes capabilities. It holds no grants and has no way to make one:
// installing a package or declaring a capability never gives access by itself (§13.2).
//
// IDs are internal. The interface shows `label` and `riskNote` instead.
import { z } from 'zod';

/** Every capability the app knows about. Any other ID is refused (§21.2: no invented tools). */
export const CapabilityId = z.enum([
  'project.files.list',
  'project.files.read',
  'project.artifacts.write',
  'external.files.read',
  'external.files.write',
  'external.files.delete',
  'provider.request',
  'network.fetch',
  'application.document.create',
  'application.document.edit',
  'application.ui.control',
  'external.message.send',
  'external.content.publish',
  'process.execute',
  'graph.source.index',
  'project.import.inspect',
  'project.import.copy',
  'obsidian.notes.export',
  'obsidian.notes.index',
  'obsidian.note.open',
  'asset.generation.request',
]);
export type CapabilityId = z.infer<typeof CapabilityId>;

/**
 * What a permission request is bounded to. A request always names one scope, so no package
 * can ask for "everything" (§13.4: never auto-grant the whole disk or home folder).
 * - `selected-project`: the project the user chose, and its app-managed output storage
 * - `import-session`: the folder chosen in one interactive import session (§13.3)
 * - `selected-external-folder`: a folder outside the project the user picks explicitly
 * - `connection`: one configured provider or application connection (account)
 * - `linked-vault`: the Obsidian vault or subfolder bound to the project (OBSIDIAN_BRIDGE §32)
 */
export const PermissionScope = z.enum([
  'selected-project',
  'import-session',
  'selected-external-folder',
  'connection',
  'linked-vault',
]);
export type PermissionScope = z.infer<typeof PermissionScope>;

export interface CapabilityInfo {
  /** Plain-language name shown in permission previews. */
  readonly label: string;
  /** What could go wrong if this were misused, shown next to the label. */
  readonly riskNote: string;
  /**
   * True once the app can actually perform it. A package that needs a capability marked false
   * still validates, but readiness (M3-4) reports it as waiting (ADR-0034).
   */
  readonly available: boolean;
  /**
   * Scopes a request may name. For capabilities that are not available yet these are the
   * expected scopes, to be confirmed when each one is built.
   */
  readonly scopes: readonly PermissionScope[];
}

const ENTRIES: Record<CapabilityId, CapabilityInfo> = {
  'project.files.list': {
    label: 'See the list of files in this project',
    riskNote: 'File names and folder structure can reveal private details.',
    available: true,
    scopes: ['selected-project'],
  },
  'project.files.read': {
    label: 'Read files in this project',
    riskNote: 'File contents may include private information that ends up in a prompt.',
    available: true,
    scopes: ['selected-project'],
  },
  'project.artifacts.write': {
    label: "Save results in this project's output folder",
    riskNote: 'Adds new files to the project; never overwrites your original files.',
    available: true,
    scopes: ['selected-project'],
  },
  'external.files.read': {
    label: 'Read files in a folder outside the project',
    riskNote: 'Can read anything in the folder you choose, not just project files.',
    available: false,
    scopes: ['selected-external-folder'],
  },
  'external.files.write': {
    label: 'Change files in a folder outside the project',
    riskNote: 'Can overwrite files you rely on; changes may not be undoable.',
    available: false,
    scopes: ['selected-external-folder'],
  },
  'external.files.delete': {
    label: 'Delete files in a folder outside the project',
    riskNote: 'Deleted files may be lost for good.',
    available: false,
    scopes: ['selected-external-folder'],
  },
  'provider.request': {
    label: 'Send text to an AI model',
    riskNote: 'What is sent leaves this computer for cloud models and may cost money.',
    available: false,
    scopes: ['connection'],
  },
  'network.fetch': {
    label: 'Download from the internet',
    riskNote: 'Downloaded content is untrusted and the request reveals what you looked up.',
    available: false,
    scopes: ['connection'],
  },
  'application.document.create': {
    label: 'Create documents in another app',
    riskNote: 'Adds content to an account outside Atlas Realm.',
    available: false,
    scopes: ['connection'],
  },
  'application.document.edit': {
    label: 'Edit documents in another app',
    riskNote: 'Can change or overwrite documents outside Atlas Realm.',
    available: false,
    scopes: ['connection'],
  },
  'application.ui.control': {
    label: 'Control another app on this computer',
    riskNote: 'Can click and type in another app as if it were you.',
    available: false,
    scopes: ['connection'],
  },
  'external.message.send': {
    label: 'Send messages for you',
    riskNote: 'Other people will receive them; a sent message cannot be taken back.',
    available: false,
    scopes: ['connection'],
  },
  'external.content.publish': {
    label: 'Publish content for you',
    riskNote: 'Makes content public under your name; it may be copied before you remove it.',
    available: false,
    scopes: ['connection'],
  },
  'process.execute': {
    label: 'Run programs on this computer',
    riskNote: 'A program can do anything your account can do. Not allowed in this version.',
    available: false,
    scopes: ['selected-project'],
  },
  'graph.source.index': {
    label: "Map links between this project's files",
    riskNote: 'Reads file names and links to draw the graph; file titles may be private.',
    available: true,
    scopes: ['selected-project'],
  },
  'project.import.inspect': {
    label: 'Look through a folder you are importing',
    riskNote: 'Reads names and sizes in the chosen folder; nothing is copied or run.',
    available: true,
    scopes: ['import-session'],
  },
  'project.import.copy': {
    label: 'Copy chosen files into a new project',
    riskNote: 'Copies only the files you approved; the originals are never moved or changed.',
    available: true,
    scopes: ['import-session'],
  },
  'obsidian.notes.export': {
    label: 'Export notes to your Obsidian vault',
    riskNote: 'Writes files into the vault you linked.',
    available: false,
    scopes: ['linked-vault'],
  },
  'obsidian.notes.index': {
    label: 'Read notes in your Obsidian vault',
    riskNote: 'Note titles and links in the linked folder become visible to the app.',
    available: false,
    scopes: ['linked-vault'],
  },
  'obsidian.note.open': {
    label: 'Open a note in Obsidian',
    riskNote: 'Switches to Obsidian; nothing is changed.',
    available: false,
    scopes: ['linked-vault'],
  },
  'asset.generation.request': {
    label: 'Ask an art service to draw images',
    riskNote: 'Your description is sent to an outside service and may cost money.',
    available: false,
    scopes: ['connection'],
  },
};

// A policy table must not change at run time. `Readonly<>` only binds the compiler, so every
// entry and its scopes list are frozen too (#111 security review L3).
for (const info of Object.values(ENTRIES)) {
  Object.freeze(info.scopes);
  Object.freeze(info);
}
export const CAPABILITIES: Readonly<Record<CapabilityId, CapabilityInfo>> = Object.freeze(ENTRIES);

/**
 * Capabilities a package may not even ask for in this version. Running programs is exactly the
 * executable content the declarative MVP path refuses (DATA_MODEL §10.3, SECURITY §13.4), so a
 * manifest naming it is refused outright instead of shown as "waiting" (user decision
 * 2026-11-27, ADR-0034). Allowing it later takes a new ADR.
 */
export const REFUSED_IN_PACKAGES: ReadonlySet<CapabilityId> = new Set<CapabilityId>([
  'process.execute',
]);

// Lookups take any string, because tool names may come from model output (§21.2). Only the
// table's own keys count: inherited names such as `toString` or `constructor` are unknown.
function entry(id: string): CapabilityInfo | undefined {
  return Object.hasOwn(CAPABILITIES, id) ? CAPABILITIES[id as CapabilityId] : undefined;
}

/** The plain-language entry for a capability, or undefined for an unknown ID. */
export function describeCapability(id: string): CapabilityInfo | undefined {
  return entry(id);
}

/** True if `id` is known and the app can perform it in the current version. */
export function isCapabilityAvailable(id: string): boolean {
  return entry(id)?.available ?? false;
}

/** True if `id` is known and a request for it may name `scope`. */
export function isScopeAllowed(id: string, scope: string): boolean {
  return entry(id)?.scopes.some((allowed) => allowed === scope) ?? false;
}

// Import inventory (IMPORT_SPEC §33.4, §33.6; M3-16 #126, IMP-1): a bounded, read-only look
// through a folder the user picked, before anything is imported.
//
// - Read-only: it lists folders and reads only a few small signal files (.gitignore and README
//   files). It never writes, never runs anything (scripts are just files in the list), and
//   never opens an excluded file or enters an excluded folder (§22.2 #30).
// - Inside the root: every folder is listed and every file is opened through the path policy
//   (M3-9), which works on real paths and re-checks at use. Junctions and symlinks are listed
//   as links and never followed.
// - Bounded: 5,000 entries, 16 folder levels, 5 MB per parsed text file. Hitting a limit gives
//   a partial result with a plain "narrowed" note, never an error and never silent loss.
//
// The result feeds the classifier (src/common/import/classify.ts) and, later, the setup review
// and the import commit (M3-17, M3-18).
import type { ClassifyInput } from '../../common/import/classify';
import {
  type ApprovedRoot,
  type DirectoryEntry,
  listInsideRoot,
  openInsideRoot,
  PathPolicyError,
} from '../security/path-policy';
import {
  type ExclusionRule,
  exclusionFor,
  type IgnoreRule,
  parseGitignore,
  RULE_LABELS,
} from './exclusions';

/** §33.6's suggested engineering limits. */
export const INVENTORY_MAX_ENTRIES = 5_000;
export const INVENTORY_MAX_DEPTH = 16;
export const INVENTORY_MAX_TEXT_BYTES = 5 * 1024 * 1024;
/** README files read for the classifier; more would add little evidence. */
const MAX_READMES = 5;
/** Only READMEs in the top two folder levels describe the project itself. */
const README_MAX_DEPTH = 1;
/** Names (excluded ones included) looked at in total, so a folder of junk stays cheap. */
const MAX_NAMES_SEEN = INVENTORY_MAX_ENTRIES * 10;
/** Example paths kept per exclusion rule for the review. */
const MAX_EXAMPLES = 5;

export interface InventoryEntry {
  /** Relative to the import root, with "/" separators. */
  readonly relativePath: string;
  /** `link`: a junction or symlink, listed but never followed. */
  readonly kind: DirectoryEntry['kind'];
  readonly size: number;
  /** More than one name on disk; the path policy refuses to read such a file. */
  readonly hardLinked: boolean;
}

export interface ExcludedGroup {
  readonly rule: ExclusionRule;
  readonly label: string;
  /** Files and folders left out by this rule (a folder counts once; its contents unseen). */
  readonly count: number;
  /** Up to five paths, so the user can recognise what was left out. */
  readonly examples: readonly string[];
}

export type NarrowedReason = 'entry_limit' | 'depth_limit' | 'text_too_large' | 'unreadable';

export interface NarrowedNote {
  readonly reason: NarrowedReason;
  /** Plain text for the review screen; never contains a full path. */
  readonly message: string;
}

export interface InventoryResult {
  /** Kept entries in walk order (breadth first, names sorted per folder). */
  readonly entries: readonly InventoryEntry[];
  /** What was left out, per rule, in RULE_LABELS order. */
  readonly excluded: readonly ExcludedGroup[];
  /** The rules that excluded something: the "applied rules" the review shows. */
  readonly rulesApplied: readonly string[];
  /** README files that were read, for the classifier. */
  readonly readmes: readonly { readonly path: string; readonly text: string }[];
  /** Why the result is partial; empty when `complete`. */
  readonly narrowed: readonly NarrowedNote[];
  readonly complete: boolean;
  readonly linksNotFollowed: number;
  /** .gitignore lines the matcher didn't understand (they were not applied). */
  readonly gitignoreSkippedLines: number;
}

interface Pending {
  readonly relative: string;
  readonly depth: number;
  readonly rules: readonly IgnoreRule[];
}

function isReadme(name: string): boolean {
  return /^readme(?:\.(?:md|markdown|txt|rst))?$/i.test(name);
}

const UTF8 = new TextDecoder('utf-8', { fatal: true });

type TextRead = { readonly text: string } | 'too_large' | 'unreadable';

/**
 * Reads a small text file through the path policy. The size is checked on the open handle,
 * not on the listing, so a file that grew since it was listed is still refused.
 */
async function readText(root: ApprovedRoot, relative: string): Promise<TextRead> {
  let opened;
  try {
    opened = await openInsideRoot(root, relative, 'read');
  } catch (error) {
    if (error instanceof PathPolicyError) return 'unreadable';
    throw error;
  }
  try {
    const { size } = await opened.handle.stat();
    if (size > INVENTORY_MAX_TEXT_BYTES) return 'too_large';
    const buffer = new Uint8Array(Math.min(size, INVENTORY_MAX_TEXT_BYTES) + 1);
    const { bytesRead } = await opened.handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > INVENTORY_MAX_TEXT_BYTES) return 'too_large';
    try {
      // TextDecoder drops a leading byte-order mark by itself (ignoreBOM defaults to false).
      return { text: UTF8.decode(buffer.subarray(0, bytesRead)) };
    } catch {
      return 'unreadable'; // not UTF-8 text
    }
  } catch {
    return 'unreadable';
  } finally {
    await opened.handle.close().catch(() => undefined);
  }
}

/**
 * Inventories `root` (approved by the path policy for this one operation). Never throws for
 * content problems: unreadable folders and files become "narrowed" notes. It throws only if the
 * root itself can't be listed.
 */
export async function inventoryFolder(root: ApprovedRoot): Promise<InventoryResult> {
  const entries: InventoryEntry[] = [];
  const excluded = new Map<ExclusionRule, { count: number; examples: string[] }>();
  const reasons = new Map<NarrowedReason, number>();
  const readmeCandidates: string[] = [];
  let linksNotFollowed = 0;
  let gitignoreSkippedLines = 0;
  let namesSeen = 0;

  const narrow = (reason: NarrowedReason, count = 1): void => {
    reasons.set(reason, (reasons.get(reason) ?? 0) + count);
  };
  const exclude = (rule: ExclusionRule, relative: string): void => {
    const group = excluded.get(rule) ?? { count: 0, examples: [] };
    group.count += 1;
    if (group.examples.length < MAX_EXAMPLES) group.examples.push(relative);
    excluded.set(rule, group);
  };

  const queue: Pending[] = [{ relative: '', depth: 0, rules: [] }];
  let full = false;
  for (let next = queue.shift(); next !== undefined && !full; next = queue.shift()) {
    let listing;
    try {
      listing = await listInsideRoot(root, next.relative === '' ? '.' : next.relative, {
        maxEntries: INVENTORY_MAX_ENTRIES,
      });
    } catch (error) {
      // The root must be listable; a sub-folder that can't be is skipped and reported.
      if (next.relative === '' || !(error instanceof PathPolicyError)) throw error;
      narrow('unreadable');
      continue;
    }
    if (listing.omittedCount > 0) narrow('entry_limit');

    // A .gitignore applies to its own folder and everything below it.
    let rules = next.rules;
    const gitignore = listing.entries.find(
      (entry) => entry.kind === 'file' && entry.name.toLowerCase() === '.gitignore',
    );
    if (gitignore !== undefined) {
      const relative = next.relative === '' ? '.gitignore' : `${next.relative}/.gitignore`;
      const read = await readText(root, relative);
      if (typeof read === 'object') {
        const parsed = parseGitignore(read.text, next.relative);
        rules = [...rules, ...parsed.rules];
        gitignoreSkippedLines += parsed.skippedLines;
      } else {
        narrow(read === 'too_large' ? 'text_too_large' : 'unreadable');
      }
    }

    for (const entry of listing.entries) {
      namesSeen += 1;
      if (namesSeen > MAX_NAMES_SEEN) {
        narrow('entry_limit');
        full = true;
        break;
      }
      const relative = next.relative === '' ? entry.name : `${next.relative}/${entry.name}`;
      if (entry.kind === 'file' || entry.kind === 'folder') {
        const rule = exclusionFor(relative, entry.name, entry.kind, rules);
        if (rule !== undefined) {
          exclude(rule, relative);
          continue;
        }
      }
      if (entries.length >= INVENTORY_MAX_ENTRIES) {
        narrow('entry_limit');
        full = true;
        break;
      }
      entries.push({
        relativePath: relative,
        kind: entry.kind,
        size: entry.size,
        hardLinked: entry.hardLinked,
      });
      if (entry.kind === 'link') linksNotFollowed += 1;
      if (entry.kind === 'folder') {
        if (next.depth + 1 > INVENTORY_MAX_DEPTH) narrow('depth_limit');
        else queue.push({ relative, depth: next.depth + 1, rules });
      }
      if (entry.kind === 'file' && isReadme(entry.name) && next.depth <= README_MAX_DEPTH) {
        readmeCandidates.push(relative);
      }
    }
  }
  if (queue.length > 0) narrow('entry_limit');

  const readmes: { path: string; text: string }[] = [];
  for (const relative of readmeCandidates.slice(0, MAX_READMES)) {
    const read = await readText(root, relative);
    if (typeof read === 'object') readmes.push({ path: relative, text: read.text });
    else narrow(read === 'too_large' ? 'text_too_large' : 'unreadable');
  }

  const groups: ExcludedGroup[] = (Object.keys(RULE_LABELS) as ExclusionRule[])
    .filter((rule) => excluded.has(rule))
    .map((rule) => {
      const group = excluded.get(rule) ?? { count: 0, examples: [] };
      return { rule, label: RULE_LABELS[rule], count: group.count, examples: group.examples };
    });
  const narrowed = narrowedNotes(reasons);
  return {
    entries,
    excluded: groups,
    rulesApplied: groups.map((group) => group.label),
    readmes,
    narrowed,
    complete: narrowed.length === 0,
    linksNotFollowed,
    gitignoreSkippedLines,
  };
}

/** Plain notes for each limit that was hit, in a fixed order. */
function narrowedNotes(reasons: ReadonlyMap<NarrowedReason, number>): NarrowedNote[] {
  const notes: NarrowedNote[] = [];
  if (reasons.has('entry_limit')) {
    notes.push({
      reason: 'entry_limit',
      message:
        `Only the first ${INVENTORY_MAX_ENTRIES.toLocaleString('en-US')} entries were inventoried. ` +
        'Choose a smaller folder to see the rest.',
    });
  }
  if (reasons.has('depth_limit')) {
    notes.push({
      reason: 'depth_limit',
      message: `Folders more than ${String(INVENTORY_MAX_DEPTH)} levels deep were not opened.`,
    });
  }
  const large = reasons.get('text_too_large');
  if (large !== undefined) {
    notes.push({
      reason: 'text_too_large',
      message: `${String(large)} text ${large === 1 ? 'file was' : 'files were'} larger than 5 MB and not read.`,
    });
  }
  const unreadable = reasons.get('unreadable');
  if (unreadable !== undefined) {
    notes.push({
      reason: 'unreadable',
      message: `${String(unreadable)} ${unreadable === 1 ? 'item' : 'items'} could not be read and ${unreadable === 1 ? 'was' : 'were'} skipped.`,
    });
  }
  return notes;
}

/** The classifier's view of an inventory: kept files and folders, and the READMEs read. */
export function toClassifyInput(result: InventoryResult): ClassifyInput {
  return {
    files: result.entries
      .filter((entry) => entry.kind === 'file')
      .map((entry) => entry.relativePath),
    folders: result.entries
      .filter((entry) => entry.kind === 'folder')
      .map((entry) => entry.relativePath),
    readmes: result.readmes,
  };
}

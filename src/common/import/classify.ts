// Import classifier (IMPORT_SPEC §33.4; M3-16 #126): suggests a project template for an
// imported folder from deterministic signals only: file extensions, file and folder names,
// README text and software manifests. Same input, same answer, every time.
//
// It returns the evidence it used, never a confidence score: a number like "87%" would claim a
// certainty this kind of guess doesn't have (§33.4). The user always reviews and can override
// the suggestion. No model is involved, and README text is only searched for keywords; an
// instruction written in a README is source content, never an instruction to the importer.
//
// Pure module (no I/O), shared so the review screen can explain the same result.

export const CONTENT_CAMPAIGN_TEMPLATE = 'builtin.content-campaign';
export const GENERIC_TEMPLATE = 'builtin.generic';

export type SuggestedTemplate = typeof CONTENT_CAMPAIGN_TEMPLATE | typeof GENERIC_TEMPLATE;

/** What the folder looks like, in plain categories the review can explain. */
export type FolderKind = 'content_campaign' | 'software' | 'mixed' | 'empty';

export interface ClassifyInput {
  /** Inventory files, relative paths with "/" separators. */
  readonly files: readonly string[];
  /** Inventory folders, relative paths with "/" separators. */
  readonly folders: readonly string[];
  /** README-like files that were read, with their text. */
  readonly readmes: readonly { readonly path: string; readonly text: string }[];
}

export interface Evidence {
  /** What the evidence points to. */
  readonly signal: 'campaign' | 'software';
  /** Plain description, e.g. "file name mentions a content calendar". */
  readonly detail: string;
  /** Where it was found (relative path); omitted for counts over the whole folder. */
  readonly path?: string;
}

export interface Classification {
  readonly templateId: SuggestedTemplate;
  readonly kind: FolderKind;
  /** Sorted, deduplicated, at most MAX_EVIDENCE items. */
  readonly evidence: readonly Evidence[];
  /** Plain notes for the review, e.g. why a software folder gets Generic. */
  readonly notes: readonly string[];
}

/** At most this many evidence lines, so a huge folder gives a readable list. */
export const MAX_EVIDENCE = 20;

/**
 * Words that point to a content campaign, with the plain phrase used in the evidence.
 * Matched as whole words in file and folder names, and in README text.
 */
const CAMPAIGN_WORDS: ReadonlyMap<string, string> = new Map([
  ['brief', 'a brief'],
  ['brand', 'brand material'],
  ['branding', 'brand material'],
  ['campaign', 'a campaign'],
  ['calendar', 'a content calendar'],
  ['channel', 'channel plans'],
  ['channels', 'channel plans'],
  ['social', 'social media'],
  ['post', 'posts'],
  ['posts', 'posts'],
  ['draft', 'drafts'],
  ['drafts', 'drafts'],
  ['newsletter', 'a newsletter'],
  ['marketing', 'marketing'],
  ['launch', 'a launch'],
  ['press', 'press material'],
  ['audience', 'audience notes'],
  ['persona', 'audience personas'],
  ['personas', 'audience personas'],
  ['tagline', 'taglines'],
  ['copywriting', 'copywriting'],
]);

/** Files that only software projects have (at the top two folder levels). */
const SOFTWARE_MANIFESTS: ReadonlySet<string> = new Set([
  'package.json',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
  'cargo.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'composer.json',
  'gemfile',
  'cmakelists.txt',
  'makefile',
]);
const SOFTWARE_MANIFEST_EXTENSIONS: ReadonlySet<string> = new Set(['.csproj', '.sln', '.vcxproj']);

const CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.kt',
  '.cs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.rb',
  '.php',
  '.swift',
  '.scala',
  '.lua',
  '.sh',
  '.ps1',
]);

/** A code-heavy folder: at least this many code files and at least half of all files. */
const MIN_CODE_FILES = 5;
/** Campaign needs at least this many different campaign words, so one "draft.md" isn't enough. */
const MIN_CAMPAIGN_WORDS = 2;

function lower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
}

function nameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : lower(name.slice(dot));
}

/** Lowercase words of a name or text: "Content-Calendar_Q3.xlsx" → content, calendar, q3, xlsx. */
function words(text: string): string[] {
  return lower(text)
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== '');
}

function depthOf(path: string): number {
  return path.split('/').length - 1;
}

/** Suggests a template for an imported folder, with the evidence behind it. */
export function classifyFolder(input: ClassifyInput): Classification {
  const evidence: Evidence[] = [];
  const campaignWords = new Set<string>();

  // Campaign signals from names (folders first, then files), each word once per path.
  for (const path of [...input.folders, ...input.files]) {
    const name = nameOf(path);
    const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
    for (const word of new Set(words(stem))) {
      const phrase = CAMPAIGN_WORDS.get(word);
      if (phrase === undefined) continue;
      campaignWords.add(word);
      evidence.push({ signal: 'campaign', detail: `name mentions ${phrase}`, path });
    }
  }
  // Campaign signals from README text: whole-word keyword search only.
  for (const readme of input.readmes) {
    const found = new Set(words(readme.text).filter((word) => CAMPAIGN_WORDS.has(word)));
    for (const word of found) {
      campaignWords.add(word);
      evidence.push({
        signal: 'campaign',
        detail: `README mentions ${CAMPAIGN_WORDS.get(word) ?? word}`,
        path: readme.path,
      });
    }
  }

  // Software signals: manifests near the top, and a code-heavy file mix.
  let software = false;
  for (const path of input.files) {
    if (depthOf(path) > 1) continue;
    const name = lower(nameOf(path));
    if (SOFTWARE_MANIFESTS.has(name) || SOFTWARE_MANIFEST_EXTENSIONS.has(extensionOf(name))) {
      software = true;
      evidence.push({ signal: 'software', detail: 'software project file', path });
    }
  }
  const codeFiles = input.files.filter((path) => CODE_EXTENSIONS.has(extensionOf(nameOf(path))));
  if (codeFiles.length >= MIN_CODE_FILES && codeFiles.length * 2 >= input.files.length) {
    software = true;
    evidence.push({
      signal: 'software',
      detail: `${String(codeFiles.length)} of ${String(input.files.length)} files are source code`,
    });
  }

  const sorted = dedupe(evidence).slice(0, MAX_EVIDENCE);
  const campaign = campaignWords.size >= MIN_CAMPAIGN_WORDS;

  if (input.files.length === 0) {
    return {
      templateId: GENERIC_TEMPLATE,
      kind: 'empty',
      evidence: sorted,
      notes: ['No files were found to inspect, so the Generic template is suggested.'],
    };
  }
  if (software) {
    const notes = [
      'This looks like a software project. It is suggested as Generic: Atlas Realm can plan ' +
        "and write about it, but running or building code isn't available.",
    ];
    if (campaign)
      notes.push('Some content-campaign signals were found too; you can switch the template.');
    return { templateId: GENERIC_TEMPLATE, kind: 'software', evidence: sorted, notes };
  }
  if (campaign) {
    return {
      templateId: CONTENT_CAMPAIGN_TEMPLATE,
      kind: 'content_campaign',
      evidence: sorted,
      notes: ['Names and notes point to campaign material. You can switch the template.'],
    };
  }
  return {
    templateId: GENERIC_TEMPLATE,
    kind: 'mixed',
    evidence: sorted,
    notes: [
      'The material is mixed or unclear, so the Generic template is suggested. You can switch it.',
    ],
  };
}

/** Removes repeated evidence and sorts it so the same folder always gives the same list. */
function dedupe(items: readonly Evidence[]): Evidence[] {
  const seen = new Map<string, Evidence>();
  for (const item of items) {
    const key = `${item.signal}|${item.path ?? ''}|${item.detail}`;
    if (!seen.has(key)) seen.set(key, item);
  }
  return [...seen.values()].sort((a, b) => {
    const left = `${a.signal}|${a.path ?? ''}|${a.detail}`;
    const right = `${b.signal}|${b.path ?? ''}|${b.detail}`;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

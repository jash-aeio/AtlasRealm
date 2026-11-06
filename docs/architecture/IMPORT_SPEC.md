# Import Existing Project Wizard

> **Source:** Atlas Realm Build Plan rev 1.1, §33 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 33. Import Existing Project wizard

### 33.1 Purpose and distinct import types

An existing project import converts selected user work into an Atlas project, proposed team/workflow, graph, and placeable structure. It is distinct from installing an agent/skill/tool package and from restoring a world backup. Use separate entry points and clear names.

MVP input is a user-selected local folder. A cloned software repository is inspected as a folder without running Git hooks or project commands. Archive, remote Git, cloud-drive, document-suite, and whole-vault imports can be added later through explicit adapters.

### 33.2 Workflow

```text
Select folder and import mode
  → Preview exclusions, limits, and source access
  → Perform bounded read-only inventory
  → Detect supported content and explicit relationships
  → Propose editable project setup
  → User reviews name, type, files, team, tools, permissions, and theme
  → Stage and validate app-owned data
  → Commit project, mappings, and initial graph
  → Offer building placement or Open Project
```

Do not delay access until every file is deeply analyzed. Complete a useful bounded first inventory, show limits/unknowns, and offer authorized incremental indexing later.

### 33.3 Copy and link modes

| Mode | Ownership and initial behavior |
|---|---|
| Copy into Atlas Realm — recommended default | Copy the reviewed eligible files into managed project storage; originals remain unchanged; edits affect the managed copy |
| Link existing folder — advanced | Register the selected root and allowed content; read-only analysis initially; editing originals requires a separate scoped grant |

Show estimated eligible size and the excluded file count before copying. Do not copy all dependencies or duplicate an entire Obsidian vault just to connect selected notes. Vault integration should normally select a binding/folder through the Obsidian bridge.

### 33.4 Inspection and classification

First use deterministic signals: file extensions, folder names, README/project notes, supported manifest metadata, Markdown links, and selected explicit project settings. Inspect text with size and encoding limits. Treat unknown binary formats as inventory entries without claiming their meaning.

Example setup evidence:

| Evidence | Suggested package |
|---|---|
| Brand brief, content calendar, channel drafts | Content Campaign |
| Event schedule, responsibilities, budget | Organization Event |
| Assignment instructions, source notes, references | School Research Support |
| README and supported code manifests | Software Planning; execution still unavailable without a development runner |
| Mixed or unclear material | Generic Project, with an editable explanation |

Optional local/cloud AI can summarize approved material and improve setup suggestions after model preflight. Content must not leave the device merely because an import was selected. Display evidence and uncertainty, not a fabricated exact confidence score.

### 33.5 Proposed setup review

The review includes project name/type/goal; source and copy/link mode; file inventory/exclusions; detected relationships; proposed agent templates, skills, tools, workflow, and automations; missing requirements; building/interior appearance; and a plain summary of what will be written.

Suggested automations remain disabled. Suggested tools and agents must resolve to installed resources or appear as optional setup steps; do not silently purchase, install, authenticate, or grant them. A README or `.md` file requesting execution is source content, not an instruction to the importer.

### 33.6 Boundaries and consistency

- Exclude dependency/build/cache directories such as `node_modules`, `.git` internals, temporary output, and known secret-bearing files such as `.env` and private keys by default. Omit `.obsidian` configuration/plugin internals from ordinary note import.
- Combine explicit exclusions, supported ignore rules, and content limits; show which rules were applied. Hidden content is excluded unless deliberately selected and permitted.
- Never follow links outside the approved root. Handle junction/symlink changes and path normalization through the broker.
- Do not execute scripts, macros, binaries, install commands, Git hooks, existing agent configs, or imported workflows.
- Suggested initial engineering limits: 5,000 inventory entries and 5 MB per parsed text file; show partial results and let users narrow scope when exceeded. Actual copy-size limits are configurable and previewed, not silently discarded.
- Detect an already registered canonical root or matching managed import. Offer Open Existing or a deliberate second copy, rather than silently duplicating projects.
- Store an import session, inventory/proposal revision, input digests, and mapping IDs. Revalidate changed sources before commit.
- Stage app-owned copies, commit metadata with a recoverable protocol, and clean up only app-owned staging on cancellation/failure. Never roll back by deleting original files.
- If the source root moves, request a reviewed re-link. Do not search the whole disk for a replacement without permission.

### 33.7 Acceptance

Import a small marketing folder and a software folder; the setup review explains the detected differences, the correct package can be overridden, source data remains intact, and both projects can be opened before placement. Verify linked originals remain read-only, scripts do not run, missing dependencies do not block inventory, duplicate import is handled, and interruptions leave a recoverable session.

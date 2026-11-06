# Optional Obsidian Bridge

> **Source:** Atlas Realm Build Plan rev 1.1, §32 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 32. Optional Obsidian bridge

### 32.1 Independence and enablement

Obsidian is an optional external knowledge tool, not Atlas Realm's database, required editor, or workflow engine. Keep all graph/project functions available when it is absent or disabled.

Provide a profile-level master switch and per-world/project bindings. Effective access requires the master switch, an enabled binding, a selected vault/subfolder, and the relevant grant. Initial state is Off. Detecting an Obsidian installation never grants access to every vault.

### 32.2 Three delivery stages

| Stage | Behavior | Scope |
|---|---|---|
| O1 — MVP | User-triggered export of selected notes/project summary as Markdown and planning graph as `.canvas`; explicit Open in Obsidian | One-way export/open, no automatic import or background synchronization |
| O2 — Later | Read-only indexing of selected vault folders, supported links, and changed notes | Explicit read scope; index availability/freshness visible |
| O3 — Later | Deliberate two-way updates for selected editable notes | Ownership, version comparison, conflicts, loop prevention, deletion policy |

O1 is part of M7/MVP completion. O2 can follow M9; O3 follows a separate integration slice in M10. Do not describe O1 as bidirectional synchronization.

### 32.3 Local interoperability

Obsidian exposes a URI protocol for actions such as opening notes. Use a validated and encoded `obsidian://open` route only in response to an explicit action; do not place secrets or whole private document contents into a URI. [Obsidian URI documentation](https://help.obsidian.md/uri).

Canvas uses the open JSON Canvas format. Export supported text/file/link/group nodes and labeled edges as a portable board. [JSON Canvas specification](https://jsoncanvas.org/spec/1.0/).

An Atlas graph may contain runtime-specific relationships that the format does not encode fully. Export them as descriptive labels or summary notes and report what is omitted. A Canvas edge does not automatically create a Markdown backlink or appear as the same relationship in Obsidian Graph view. Write actual note links only when the user chooses that export behavior. Do not claim lossless round-trip of permissions, jobs, agents, or workflow semantics.

### 32.4 Export layout and ownership

Suggested selected-vault layout:

```text
<chosen-vault>/<approved-export-subfolder>/
  Atlas Realm/
    <project-safe-name>/
      Project.md
      Notes/
      Deliverables/
      Project.canvas
```

Use stable Atlas IDs in bounded metadata and a binding record to resolve renames. File references in exported boards must resolve inside the approved vault/export layout or be represented as explicit external links; never emit secret or unrelated absolute paths.

Show a preview of selected content, destinations, new files, and collisions. Copy only chosen attachments. O1 creates files or new uniquely named revisions. It does not overwrite an externally edited file silently; compare the last export digest and offer Save Copy or a separately reviewed replacement. The bridge does not export credentials, grants, hidden prompts, private run context, or executable tool configurations.

### 32.5 Disable, disconnect, and conflicts

- Turning the master switch or binding Off prevents new bridge dispatches, cancels queued transfers, and stops its watchers when implemented.
- Already dispatched filesystem work may finish; show the outcome accurately.
- Leave existing Atlas and vault files intact. A separate cleanup action may remove only app-created files after a concrete preview.
- Pausing O2/O3 retains a last-indexed indicator and prevents outdated content from appearing current.
- O3 compares both sides against a shared base digest/version, uses origin IDs to prevent feedback loops, and never resolves simultaneous edits with silent last-writer-wins.
- Deleted notes become missing/tombstoned references; deletion propagation is off initially.
- Connecting or re-linking a moved vault revalidates the exact authorized root.
- A restored backup leaves bridge bindings disabled until explicitly reconnected.

Acceptance: O1 works with a local selected vault, note opening is correctly encoded, external edits cause a conflict, disabling stops new exports, and the Atlas graph remains fully usable while disconnected.

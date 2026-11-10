# Risks & Decision Log (original)

> **Source:** Atlas Realm Build Plan rev 1.1, §26 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 26. Risks and decision log

| Risk | Design response |
|---|---|
| Attractive world hides weak execution | Build real artifacts, reviews, and recovery before extensive visual polish |
| Game controls confuse beginners | Conventional lists, visible buttons, auto-placement, optional avatar navigation |
| Offline promise is misunderstood | Per-capability readiness and visible data destination |
| Local hardware cannot run chosen models | Capability checks, limited concurrency, user-selected cloud alternative |
| Imported resources are incompatible | Versioned manifests, adapters, curated sources, explicit requirement reports |
| Imported code exceeds permissions | Keep declarative MVP; add OS isolation before arbitrary executables |
| Repeated external actions after failure | Operation journal, idempotency where supported, unknown-effect reconciliation |
| Large multi-agent bills | Small teams, bounded turns, reservations, measured single-agent baseline |
| UI and runner disagree | Committed state/events shared by canvas and panels |
| Local profiles imply false security | Explain OS-user boundary and separate data ownership from encryption |
| App update breaks stored work | Migrations, pre-update backups, versioned schemas, packaged smoke tests |
| "Any project" expands scope endlessly | Common engine plus evaluated project packages and honest limitations |

Record architecture changes in `docs/DECISIONS.md` using date, decision, alternatives, reason, consequences, and affected milestones. Existing defaults can be revised when evidence warrants it.

Decisions the builder can revisit without blocking the start:

- Final logo and brand treatment; the approved product name is Atlas Realm and full title is Atlas Realm: An Agentic AI Ecosystem.
- Detailed fantasy palette and asset execution within the approved welcoming fantasy RPG direction; PixelLab MCP is the preferred production route, subject to service access and terms.
- Whether avatar walking is desirable after basic navigation tests.
- Whether a future Tauri implementation offers enough benefit to justify changing the desktop stack.
- Whether complex orchestration warrants LangGraph or another engine later.
- Whether the intended commercial product is paid desktop software, hosted service, or hybrid.
- Which exact third-party resources and applications deserve the first curated integrations.

**Approved decisions, November 6, 2026:** Atlas Realm naming; upper-right context-sensitive Map/Connections panel; 2.5D enterable cutaway interiors and Blueprint mode before true 3D; optional Obsidian O1 export/open before O2 indexing and O3 two-way edits; reviewed automatic setup for existing folders with copy/link choices; PixelLab MCP preferred for producing a locally packaged fantasy asset set. Do not reopen these decisions as unresolved preferences without new evidence.

## Risk review log

Added after each milestone close. The table above stays as the spec wrote it; this log records what the milestones actually taught.

### M0 close (2026-11-10)
- **Retired: "the stack can't be packaged."** The packaged Windows build starts from a path with spaces and non-ASCII characters, loads `node:sqlite`, the worker and bundled art from `app.asar`, and keeps data across restarts (packaged E2E 9/9, in CI).
- **Retired: "the Pixi world and the React Flow Atlas can't share state."** One selection store drives both (M0-5 E2E). 150 nodes / 300 edges load in under 0.2 s.
- **Open, scheduled: Chromium debug switches** (`--remote-debugging-port`, `--no-sandbox`, …) still work on the packaged app. Low impact today. Moved to M1 as #20; it must land before M3's file, secret and provider commands.
- **New: security hardening makes scope grow.** Two M0 issues (M0-9 `app://`, M0-10 switches) came from per-PR security reviews, not the plan. *Response:* leave room in each milestone plan for review findings, and track every accepted finding as an issue with a deadline gate.
- **New: unsigned installer.** SmartScreen warns on install. Fine for development; code signing is decided in M7 (packaging hardening).

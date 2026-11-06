# Metrics, Release Gates & Final Checklist

> **Source:** Atlas Realm Build Plan rev 1.1, §25, §29 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 25. Product metrics, costs, and release gates

### 25.1 Measure usefulness

- Time from first launch to first accepted deliverable.
- Percentage of initiated projects that produce a usable saved output.
- User corrections per deliverable and recurring failure categories.
- Cost and elapsed time per accepted output, with model/tool charges separated.
- Automation completion rate, skipped occurrences, and unresolved approval count.
- Recovery success after simulated interruption.
- Ability of a new user to find files, identify a blocker, and stop work without help.
- Frequency of switching from world view to list view; use this to improve both.

Collect locally by default. Any external telemetry is an explicit product decision with documented data fields and user control. Do not upload project content for analytics by default.

### 25.2 Operating costs

Local inference uses hardware, storage, memory, and electricity even when there is no per-token cloud bill. Cloud execution can include input/output tokens, caching, hosted tools, media generation, and external-service charges. Catalog hosting, update distribution, code signing, support, and optional remote execution add product costs later.

Avoid a fixed cost forecast before selecting actual models and measuring representative workflows. Maintain a dated price configuration and mark estimates as estimates.

### 25.3 MVP release gate

- All P0 requirements have demonstrable evidence.
- No known bypass allows renderer/model input to invoke arbitrary privileged operations.
- No raw credentials in logs, backups, source control, or ordinary renderer responses.
- Offline organization and configured local inference work after setup.
- Real artifact versioning, cancellation, crash handling, and schedule deduplication work.
- Packaged Windows installation has been tested outside the developer environment.
- At least two project fields have been evaluated with a human rubric.
- Provider/integration availability and untested paths are clearly documented.
- Asset/package attribution and distribution license decisions are recorded.
- Users can export and restore their work.
- Realm Atlas does not leak unauthorized graph metadata and remains usable without Obsidian.
- Imported originals remain unchanged unless a separately granted edit was performed; scripts never auto-run.
- Obsidian O1 can be disabled without deleting files; export conflict handling is demonstrated.
- Enterable interiors and Blueprint selection connect to real project/file controls.
- Bundled fantasy assets load offline with no PixelLab connection; source/provenance and generation terms are recorded.

## 29. Final implementation checklist

### Product and navigation

- [ ] Offline local profile and world creation work.
- [ ] Avatar/theme setup can be skipped.
- [ ] Project creation persists before placement.
- [ ] Unplaced projects are usable.
- [ ] Ten hotbar slots are references, not storage limits.
- [ ] Library and sidebar work without placing service structures.
- [ ] Essential operations have accessible conventional controls.
- [ ] Upper-right Map/Connections panel follows world, project, and selected-item context.
- [ ] Enterable 2.5D interiors and Blueprint mode open actual project controls/editors.
- [ ] Graph layouts do not move files; typed edges distinguish user, parsed, recorded, and AI-suggested origins.
- [ ] Project import offers reviewed copy/link modes, safe exclusions, Generic fallback, and duplicate handling.

### Resources and AI

- [ ] Agent templates and project instances are distinct.
- [ ] Skills, tools, models, and workflows have separate meanings and records.
- [ ] Installed resources are manageable offline.
- [ ] Readiness reports actual missing requirements.
- [ ] Local/cloud processing and data destinations are visible.
- [ ] Model adapters enforce capability and account choices.
- [ ] Subscription support is claimed only for verified supported routes.

### Execution and automation

- [ ] Tool proposals pass broker validation and authorization.
- [ ] Runs and workflow/resource snapshots persist.
- [ ] Review limits and budgets are finite.
- [ ] Artifacts are real, versioned, and reopenable.
- [ ] Cancel prevents subsequent actions.
- [ ] Crash recovery handles unknown effects honestly.
- [ ] Schedules use timezones and occurrence deduplication.
- [ ] Tray, quit, sleep, and missed-run behavior are explicit.
- [ ] World animation reflects actual activity.

### Data and release

- [ ] Credentials are protected and excluded from logs/backups.
- [ ] Project/world boundaries are enforced by services.
- [ ] Scoped export and fresh-profile restore work.
- [ ] Database migrations preserve a recovery path.
- [ ] Packaged Windows behavior has been checked.
- [ ] Two distinct project fields have real evaluation evidence.
- [ ] License/asset attribution records exist.
- [ ] Support matrix, known limitations, and next milestone are documented.
- [ ] Obsidian O1 is optional, scoped, conflict-aware, and disableable without deleting files.
- [ ] Exported Canvas connections and Markdown note links are not treated as identical.
- [ ] Graph/index/export services cannot leak another project's unauthorized metadata.
- [ ] Fantasy art bible, asset manifest, pivots/footprints, and source/terms records exist.
- [ ] PixelLab-generated assets are local packaged files; no account/token is shipped with them.
- [ ] PixelLab free/trial/subscription eligibility is checked rather than assumed.

# Glossary

Two kinds of terms: **product terms** (what things mean inside Atlas Realm; the authoritative table is in [PRODUCT_RULES.md §3](PRODUCT_RULES.md)) and **developer terms** (concepts you'll meet while building). Claude adds new developer terms here the first time they come up.

## Product terms (quick reference)
| Term | Plain meaning |
|---|---|
| World | A workspace, shown as a village/city/kingdom |
| Project | A goal plus its files, team, tasks and workflows. Shown as a building, but it exists even without one. |
| Agent template / instance | A recruitable role (Guild card) / that role hired into one specific project |
| Skill | Instructions (and assets) that teach an agent how to do something |
| Tool | A callable, permission-controlled capability (e.g. "read project files") |
| Workflow / Run | A reusable procedure / one execution of it |
| Automation | A trigger (schedule) that starts a workflow run |
| Artifact | A real saved output file, with version history |
| Realm Atlas | Upper-right panel: Map (where?) and Connections (how related?) |
| Project link (relation) | A user-made, typed arrow from one project to another in the same world: depends on, supports or references. Descriptive only: it never changes permissions, scheduling or files |
| Blueprint mode | Simplified structural view of a project interior |

## Developer terms
| Term | Meaning | Where it shows up |
|---|---|---|
| **Acceptance criteria** | Checkable statements that define when a task is done | every issue |
| **Acceptance test** | An end-to-end test of a promise made to the user (an M2 Check, a §22.2 scenario), driven through the real UI, often across a restart | `tests/e2e/m2-acceptance.spec.ts`, lesson 041 |
| **ADR** | Architecture Decision Record: a short file explaining one important decision and why | `docs/adr/` |
| **Branch / PR** | A separate line of work / a request to merge it into `main`, with review | GitHub |
| **CI** | Continuous Integration: automatic checks on every push or PR | `.github/workflows/ci.yml` |
| **Context isolation** | Electron setting that runs the preload in a separate JavaScript world from the page, so the page can't tamper with it | `src/main/bootstrap/window.ts` |
| **contextBridge** | The Electron API a preload uses to hand specific functions to the page (`window.atlas`) | `src/preload/index.ts` |
| **Conventional Commits** | A commit message format: `type(scope): summary` | `process/GIT_WORKFLOW.md` |
| **Corepack** | A tool bundled with Node 24 that downloads the exact package-manager version named in `package.json` | ADR-0007 |
| **CSP (Content Security Policy)** | A rule list telling the browser engine which scripts, styles and connections a page may load. Blocks injected scripts | `src/common/security/csp.ts` |
| **Custom protocol (app://)** | A URL scheme the app registers and answers itself; we serve the built UI from `app://atlas/` instead of `file://` | `src/main/bootstrap/app-protocol.ts` |
| **E2E test** | End-to-end test: drives the real built app like a user would (we use Playwright) | `tests/e2e/` |
| **Electron main / preload / renderer** | The privileged Node process / a tiny bridge script / the web page UI (no privileges) | `architecture/ARCHITECTURE.md` §7.2 |
| **Exhaustiveness check** | Making the compiler prove every case of a union is handled, using `assertNever` in a `switch` default | `src/common/errors/assert-never.ts` |
| **Flaky test** | A test that sometimes fails without any code change, usually because it races the app's timing. Rerun to tell it from a real failure, then fix or track it | #56, #108 |
| **Formatter** | A tool that rewrites code layout (quotes, spacing) without changing behavior. We use Prettier. | `.prettierrc.json` |
| **Hook (Claude Code)** | A script the harness runs automatically on events (before a tool runs, at session start…) | `.claude/hooks/` |
| **Shared validation** | One pure rule used by both the preview (renderer) and the authoritative check (main), so they give the same answer. Main still runs it again itself, because the renderer is not trusted | `src/common/world/placement-rules.ts`, lesson 026 |
| **Synthetic vs real input** | Synthetic input is a click or pointer move a test sends straight into the page (Playwright uses CDP). Real input comes from the operating system: the physical mouse and keyboard. Both reach the page, so a person using the computer can disturb a test | `tests/e2e/world.spec.ts`, lesson 042 |
| **Summed-area table** | A grid where each cell stores the total of everything above and to its left, so the total of any rectangle takes four lookups. Auto-place uses it to test "are these tiles all free?" quickly | `placement-rules.ts` |
| **Trust boundary** | The line where data crosses from code we don't control (the renderer) into code we do (main). Data crossing it is checked, and anything the main process can look up itself is never taken from the request | `placement-service.ts`, lesson 027 |
| **Derived data** | A value that follows from other data, like a building's footprint from its art. Look it up from the trusted source instead of accepting it as input | `building-appearances.ts`, ADR-0025 |
| **Negative control** | Breaking the code on purpose to check that a test really fails, so a passing test means something | lesson 027 |
| **Idempotent** | Doing it twice has the same effect as doing it once | workflow engine §12.6 |
| **Installer (NSIS)** | A Setup.exe that copies the app into a folder and adds Start-menu and uninstall entries. NSIS is the installer system electron-builder uses | `electron-builder.yml` |
| **Invariant** | A rule that must *always* hold (e.g. "removing a building never deletes a project") | `PRODUCT_RULES.md` §3.1 |
| **IPC** | Inter-Process Communication: messages between renderer and main | §16 |
| **Linter** | A tool that flags suspicious code that still compiles (unawaited promises, empty catch). We use ESLint. | `eslint.config.js` |
| **asar** | Electron's read-only archive format: our built files packed into one `app.asar`, read like a folder | `electron-builder.yml` |
| **asar integrity** | A fingerprint of every file in `app.asar`, stored in the `.exe` and checked at startup, so a modified app refuses to run | `electron-builder.yml` |
| **Lockfile** | A generated file recording the exact version of every installed dependency, so all machines match | `pnpm-lock.yaml` |
| **Binding (SQLite)** | The bridge library between JavaScript and SQLite's C code; ours is the built-in `node:sqlite` (ADR-0010) | `src/main/storage/database.ts` |
| **CDP (Chrome DevTools Protocol)** | The protocol DevTools uses to inspect and control a Chromium page; our packaged tests connect with it | `tests/e2e-packaged/` |
| **Chromium switch** | A command-line option such as `--remote-debugging-port` that changes how Electron's browser engine behaves. The packaged app refuses the dangerous ones | `src/main/bootstrap/switch-guard.ts` |
| **Deny-list / allowlist** | A list of what's forbidden (everything else allowed) / a list of what's permitted (everything else refused) | ADR-0015 |
| **Code signing** | A certificate-backed signature on the `.exe` that tells Windows who made it; not done yet (costs money), so SmartScreen warns | `electron-builder.yml` |
| **MCP** | Model Context Protocol: a standard way to give AI tools access to external services | `.mcp.json` |
| **Fuse (Electron)** | An on/off switch inside the Electron binary, flipped at package time to remove risky features such as `ELECTRON_RUN_AS_NODE` | `electron-builder.yml` |
| **Migration** | A versioned script that changes the database schema safely | §9 |
| **Online backup** | A consistent copy of a live SQLite database made by SQLite itself, not by copying the file | `src/main/storage/database.ts` |
| **Mock** | A fake implementation used in tests (must be labeled as such) | providers |
| **Origin** | A page's identity for security checks: scheme + host + port. CSP `'self'` means "same origin" | `src/main/bootstrap/app-origin.ts` |
| **Packaging** | Turning the project into an installable app: Electron runtime + our bundled code + installer | `pnpm package` |
| **Path traversal** | An attack that uses `..` (often URL-encoded) to read files outside an allowed folder | `resolveAppRequestPath` |
| **Peer dependency** | A library a package expects *you* to install alongside it (Vitest 5 needs Vite) | `package.json` |
| **Positive control** | A test case that must succeed, proving the test can tell success from failure (not passing vacuously) | `tests/e2e/shell.spec.ts` |
| **Vacuous pass** | A test that passes only because its check could never fail (it can't see what it is looking for). A positive control catches this | lesson 022 |
| **Repository** | The only code allowed to read/write a table; callers get typed methods instead of SQL | `src/main/storage/repositories/` |
| **Rollback** | Undoing every write in a transaction that failed | `withTransaction` |
| **Sandbox (Electron)** | Runs the renderer inside Chromium's OS-level sandbox with no Node.js access | `src/main/bootstrap/window.ts` |
| **Skill (Claude Code)** | A packaged procedure Claude runs on request, e.g. `/ship` | `.claude/skills/` |
| **Spike** | A short experiment to reduce risk before committing to a design | M0 |
| **Strict mode (TypeScript)** | A group of compiler checks, e.g. no implicit `any` and null-safety | `tsconfig.json` |
| **Subagent** | A helper Claude with its own context, used for focused tasks | `.claude/agents/` |
| **Transaction** | A group of database writes that succeed or fail together | `withTransaction` |
| **Type-aware linting** | Lint rules that ask the TypeScript compiler about types (e.g. "is this a promise?") | `eslint.config.js` |
| **WAL (write-ahead log)** | SQLite mode that writes changes to a side file first; crash-safe and lets reads run during a write | `openDatabase` |
| **Worktree** | An extra checkout of the repo on another branch, used for parallel agents | `process/MULTI_AGENT_GUIDE.md` |
| **Zod** | A TypeScript library that validates data at runtime | IPC contracts |
| **Isometric projection** | Drawing a flat grid as 2:1 diamonds so it looks tilted in 3D. Tile positions are stored as grid coordinates and converted to pixels only for display | `src/renderer/world/projection.ts` |
| **Inverse projection** | The reverse conversion: from a pointer position on screen back to grid coordinates (after undoing the camera's pan and zoom) | `pickTile` |
| **Camera (pan / zoom)** | The view transform from world pixels to screen pixels: `screen = world × zoom + pan`. Cosmetic: it never changes stored positions | `projection.ts` |
| **WebGL / Canvas2D** | Two browser drawing APIs. WebGL uses the GPU and is fast; Canvas2D is a slower, simpler fallback. Pixi tries WebGL first (ADR-0011) | `grid-scene.ts` |
| **WebGL context (lost)** | The page's connection to the GPU. Browsers cap how many exist and can take one away (driver reset); a context must be released when its canvas goes away | `WorldCanvas.tsx` |
| **Error boundary** | A React component that catches a crash in its children and shows a fallback instead of blanking the whole app | `WorldErrorBoundary.tsx` |
| **StrictMode (React)** | A development-only mode that mounts components twice to expose missing cleanup | `src/renderer/app/main.tsx` |
| **Mutation check** | Breaking the code on purpose to confirm a test fails; proves the test isn't passing vacuously | session logs |
| **Single source of truth** | Keeping a value in exactly one place; every view reads it from there instead of keeping its own copy | `src/renderer/state/` |
| **Store (external)** | An object outside React that holds a value, lets code change it and notifies subscribers. React reads it with `useSyncExternalStore` | `state/store.ts` |
| **Semantic versioning (semver)** | Version numbers shaped `MAJOR.MINOR.PATCH`. A major bump (6 → 7) may break things; minor adds features; patch fixes bugs | `package.json` |
| **Dependabot** | GitHub's bot that opens PRs to update dependencies. Groups bundle several updates into one PR; `ignore` rules skip some | `.github/dependabot.yml` |
| **Controlled component** | A component that shows a value passed in from outside and only *reports* user actions, instead of keeping its own state | `ConnectionsGraph.tsx` |
| **React Flow** | The library (`@xyflow/react`) that draws the Realm Atlas Connections graph as HTML/SVG nodes and edges (ADR-0003) | `src/renderer/atlas/` |
| **Shared entity ID** | One stable ID used by every view of the same thing (world marker, graph node, list item), so selection can be shared | `spike-graph.ts` |
| **Worker (process)** | A separate process that does long or risky work for the main process and reports back, so the app never freezes or crashes with it | `src/worker/` |
| **Utility process** | Electron's API (`utilityProcess.fork`) for starting a Node-capable child process from main. It reports an exit code and can be killed (ADR-0012) | `utility-transport.ts` |
| **Message passing** | Processes share no memory; they send each other copies of plain-data messages | `worker-protocol.ts` |
| **MessagePort / MessageChannel** | A private two-way pipe. Whoever holds the two ends can talk; nobody else can | `utility-transport.ts` |
| **Request ID (correlation ID)** | A unique ID on each request that its reply repeats, so replies can arrive in any order and still reach the right caller | `worker-bridge.ts` |
| **Reconciliation (React)** | How React compares the new render with the old one: an element of the same type at the same position is reused (only its props change); a different type or `key` is thrown away and mounted fresh | lesson 038 |
| **Remount (forced with `key`)** | Giving a component a new `key` so React builds it from scratch, which resets its state and re-runs mount-only behaviour such as `autoFocus` | `PinToHotbar.tsx`, `ProjectInspector.tsx`, lesson 038 |
| **AbortController / AbortSignal** | The standard JavaScript way to ask running work to stop. The controller fires; code holding the signal stops | `dispatcher.ts` |
| **Stale reply** | A reply that arrives after its request was cancelled or timed out. It's dropped, never delivered | `worker-bridge.ts` |
| **Sprite** | A single picture (PNG) drawn into the world at a position, e.g. a building or a marker | `grid-scene.ts` |
| **Footprint** | The grid tiles a sprite covers on the ground, e.g. 2×2. Used for placement and collision, never for permissions | `asset-manifest.json` |
| **Ground pivot (anchor)** | The point of an image that is placed on the grid. Ours is the south corner of the footprint, the corner nearest the viewer (ADR-0013) | `asset-manifest.ts` |
| **Placement anchor** | The tile a saved building position names: the north corner of its footprint (lowest x and y). Not the same point as the ground pivot, which sits on the opposite (south) corner (ADR-0024) | `placement-rules.ts` |
| **Auto-place** | "Find me a spot": searches outward from a start tile in a fixed order and returns the nearest free spot, or nothing if the world is full (UI_SPEC §17.2) | `findNearbyPlot` |
| **Asset manifest** | One JSON list of every bundled image with its size, pivot, footprint and digest, checked by a schema and tests | `resources/assets/asset-manifest.json` |
| **Digest (SHA-256)** | A fingerprint of a file's bytes; any change gives a different value, so it detects edited or corrupted files | manifest `sha256` |
| **Nearest-neighbour sampling** | Scaling an image by copying the closest pixel instead of blending, so pixel art stays crisp | `grid-scene.ts` |
| **Placeholder art** | Simple stand-in images, clearly flagged, used until approved art exists | `resources/assets/placeholders/` |
| **JIT (in Zod)** | "Just-in-time": Zod 4 can generate parser code at runtime with `new Function`. Our CSP forbids that, so the renderer sets `jitless` | `src/renderer/app/zod-config.ts` |
| **Optimistic concurrency (expected revision)** | Every save says which `revision` it last read. If the row has moved on, the save changes nothing and fails with `revision_conflict` instead of overwriting someone else's change | `repository-support.ts` (`guardedUpdate`), lesson 012 |
| **Lost update** | Two edits start from the same old version, and the later save silently wipes out the earlier one. Optimistic concurrency prevents it | lesson 012 |
| **Soft delete** | Marking a row as removed (status + timestamp) instead of running `DELETE`, so it can be restored. Our archive and trash work this way | `project-repository.ts`, ADR-0016 |
| **STRICT table** | A SQLite table that refuses values of the wrong type (e.g. text in an INTEGER column) instead of quietly storing them | `src/main/storage/migrations/` |
| **CHECK constraint** | A rule stored in the table itself. SQLite refuses any row that breaks it, even from code that skips the repositories | migration 2 |
| **Project template (starter package)** | A versioned description of a kind of project: the inputs it asks for, the outputs it plans, and what it can't do offline. A project records which template ID and version it came from. In M1 templates are metadata only | `resources/project-templates/` |
| **Discriminated union** | A schema with several shapes told apart by one field (here `type` or `status`), so each shape gets its own rules and TypeScript knows which one it has | `project-template.ts` |
| **Build-time import (`import.meta.glob`)** | A Vite feature that finds files by pattern while building and bundles them into the code, so the app needs no file paths at runtime | `bundled-templates.ts` |
| **Graceful degradation** | When one part fails, only that part stops and says why; the rest keeps working. A broken template is listed as "unavailable" instead of stopping the app | `catalog.ts`, lesson 014 |
| **Invisible format characters (bidi controls)** | Unicode characters that show nothing themselves but change how text is displayed. A right-to-left override (U+202E) can make `txt.exe` look like `exe.txt`. We refuse them in display text | `project-template.ts` |
| **Profile (local)** | A separate local data set (its own folder and database), not a security account. Listed in `profiles-index.json` | `src/main/storage/profiles/`, ADR-0014 |
| **Atomic write** | Writing a file so readers see either the whole old content or the whole new content, never half. We write a temp file, flush it to disk (fsync), then rename it over the original | `profiles-index.ts` (`writeProfilesIndex`) |
| **fsync** | Asking the operating system to push a file's buffered bytes onto the disk now, so a power cut can't lose them | `profiles-index.ts` |
| **Branded type** | A TypeScript type like `string & { brand }`: at runtime it is a plain string, but the compiler only accepts values that came through a validator, so an unchecked string can't be passed by accident | `ProfileId` in `profile-id.ts` |
| **TOCTOU (time of check to time of use)** | A bug where code checks something ("the file exists") and then acts on it, but the world changes in between. Safer: make the action itself refuse the wrong case | `openAppDatabase({ requireExisting })` |
| **Fail closed** | When something is wrong or unclear, stop and report instead of carrying on with a guess. The opposite, "fail open", keeps going and can hide data or weaken security | `ProfilesIndexMissingError` |
| **Flaky test** | A test that passes or fails without any code change, often because of timing or machine load. Find the cause before re-running: it may be a real bug | `tests/integration/ipc-router.test.ts` |
| **Algorithmic-complexity DoS** | Making a program do a lot of work with a cheap input (e.g. a huge typed array that a validator walks key by key). Defended by bounded checks that run first | `checkPlainJson` in `json-size.ts` |
| **Graph entity** | The stable node ID a world or project has in the Realm Atlas graph. It has its own UUID, separate from the name and from any position on screen | `graph-entity-repository.ts`, ADR-0018 |
| **Tombstone** | A mark saying "this is gone" (a timestamp) on a row that is kept instead of deleted. A trashed project's graph entity is tombstoned, and restoring clears it | `graph_entities.tombstoned_at` |
| **Savepoint** | A named checkpoint inside a transaction. Rolling back to it undoes only the writes made since, and the outer transaction carries on. It lets all-or-nothing steps nest | `withSavepoint` (`database.ts`), lesson 016 |
| **Backfill** | Filling a new table or column for data that already existed before the change, as part of the migration | migration 3 |
| **Composite foreign key** | A foreign key made of two columns together, e.g. `(project_id, world_id)` must match a real project *in that world* | migration 3 |
| **Domain error code** | A stable word for an expected failure of a well-formed request (`not_found`, `revision_conflict`, `limit_reached`). The UI branches on it; bugs stay `internal_error` | `ipc-result.ts`, `CommandError` (`router.ts`), ADR-0019, lesson 017 |
| **Active profile** | The profile whose database is open right now. Every profile and world command acts on it only; switching (M1-8) swaps it | `ActiveProfile` (`src/main/profiles/active-profile.ts`) |
| **Application service** | Main-process code between IPC handlers and repositories that combines several stores into one operation (e.g. the profiles index plus a settings row) | `ProfileService` (`profile-service.ts`) |
| **Keyset paging** | Fetching the next page as "rows after this exact row" (by its sort key) instead of "skip N rows", so added or removed rows can't shift later pages | `project-repository.ts` (`pageByWorld`), lesson 018 |
| **Cursor (paging)** | An opaque token the UI hands back to get the next page. It wraps the last row's sort key and is re-checked by the main process | `project-service.ts`, ADR-0020 |
| **Table rebuild** | Changing a SQLite table's constraints by creating a new table, copying the rows, dropping the old one and renaming the new one (SQLite can't edit a CHECK in place) | migration v4, lesson 018 |
| **Make-before-break** | Replacing something live by preparing the replacement fully before releasing the original, so a failure leaves the original in place | profile switching (`profile-session.ts`), ADR-0021, lesson 019 |
| **Command gate** | A switch that makes every incoming command fail with one clear code (`profile_switching`) while a risky change runs, instead of running or queueing it | `refuseWhileSwitching` (`active-profile.ts`), lesson 019 |
| **Stub** | A stand-in that returns a fixed answer until the real code exists; must be labelled (e.g. `runCheck: 'stub'`) so nothing claims it was verified | `noActiveRunsStub` |
| **Onboarding** | The first-launch steps that get a new user to a usable state (here: profile → optional avatar → world). Shown while the active profile has no world | `src/renderer/onboarding/`, ADR-0022 |
| **Derived state** | A value computed from data you already have instead of stored separately, so it can't drift (e.g. "first launch" = "no world yet") | `src/renderer/state/session.ts` |
| **Empty state** | What a screen shows when there's nothing in it yet; it should say so plainly and point to the next action | `src/renderer/app/MainScreen.tsx` |
| **Focus management** | Moving keyboard focus on purpose (e.g. to a new step's heading) so keyboard and screen-reader users don't get lost | `src/renderer/onboarding/Onboarding.tsx` |
| **Keyboard shortcut layer** | One `keydown` listener on the window that decides what a key means, and leaves keys alone while you type in a text field or a dialog is open. Features add keys through it instead of their own listeners | `src/renderer/app/shortcuts.ts`, lesson 029 |
| **Event bubbling** | A browser event starts at the element where it happened, then travels up through its parents to `window`, so one listener high up can hear events from the whole page | `shortcuts.ts`, lesson 029 |
| **Focus restoration** | After a panel, dialog or drawer closes, putting keyboard focus back on the control that opened it | `MainScreen.tsx`, `ConfirmDialog.tsx` |
| **Drawer** | A side panel that slides over the page in narrow windows instead of taking a fixed column | `.side-column` in `app.css` |
| **Modal dialog** | A box that sits on top of the page and must be answered or closed before the rest of the page works again. The native `<dialog>` element opened with `showModal()` keeps keyboard focus inside it and closes on Escape | `src/renderer/projects/ConfirmDialog.tsx` |
| **Live region** | A part of the page (`role="status"` or `role="alert"`) whose changes screen readers announce without moving focus. `status` waits politely; `alert` interrupts | `src/renderer/projects/ProjectsPanel.tsx` |
| **Guard clause** | An early check at the top of a function that throws or returns before anything changes when a rule is broken. With several guards, their order decides which reason the caller hears | `ProjectService.mutable()`, lesson 024 |
| **Information leak** | An error or answer that tells the caller something they shouldn't know, such as "this ID exists in another world". We answer `not_found` the same way in every such case | `project-service.ts` (ownership), ADR-0020 |
| **Partial unique index** | A UNIQUE index that only covers rows matching a WHERE clause, e.g. "a project is pinned at most once per world" checks only rows with a `project_id` | `hotbar_slots_one_per_project` (migration 5), ADR-0023 |
| **Representation (of a project)** | Something that stands for a project without being it: a building placement or a hotbar slot. Removing one never changes the project | `representation-target.ts`, PRODUCT_RULES §3.1 |
| **Fixture (database)** | A frozen SQL snapshot of an older database, kept unchanged in the repo so migration tests run against what real users have on disk | `tests/fixtures/db/v4-app.sql` |
| **Expected target (hotbar)** | The ID of what the caller believes is in a hotbar slot. Replacing or clearing a slot only works if it still holds that target, otherwise `slot_occupied`. Used instead of a revision because a cleared and refilled slot starts at revision 1 again | `hotbar-service.ts`, ADR-0026 |
| **Silent replacement** | Overwriting something the user had (a hotbar pin) without them choosing to. Forbidden: a filled slot only changes when the request names its current occupant | PRODUCT_RULES §3.1, §22.2 #2, ADR-0026 |
| **ABA problem** | A stale check passes because the value it compares changed and then came back (A → B → A). Example: a hotbar slot cleared and refilled restarts at revision 1, so an old revision matches the new pin | lesson 028, ADR-0026 |
| **Depth sort (painter's algorithm)** | Drawing far things first and near things on top. Each building gets a depth key from the centre of its footprint on the ground, with fixed tie-breakers so the order never flickers | `src/renderer/world/buildings.ts`, lesson 030 |
| **Culling** | Not drawing what is outside the view. Offscreen buildings are hidden so the GPU skips them (UI_SPEC §17.4) | `grid-scene.ts`, lesson 030 |
| **Hit testing** | Working out what is under the mouse. The front-most building whose outline contains the point wins | `pickBuilding` in `buildings.ts`, lesson 030 |
| **Inspector** | The card under the Realm Atlas that shows the selected project's summary. It reads the project again from the main process; selecting changes nothing | `ProjectInspector.tsx`, UI_SPEC §6.1 |
| **State machine** | A fixed list of states and the allowed moves between them. The placement tool is idle, placing or moving, and each input means one thing in each state | `placement-tool.ts`, lesson 031 |
| **Pointer capture** | Asking the browser to keep sending pointer events to one element until the button is released, even if the pointer leaves it. A drag that ends off the map is still seen | `WorldView.tsx`, lesson 031 |
| **Placement tool** | The mode for placing, moving or removing a building, with a preview that says whether the spot fits. Every change goes through the placement commands | `placement-tool.ts`, UI_SPEC §17.2 |
| **Command pattern** | Keeping each change as a small object that knows how to do itself again and how to reverse itself. Undo and redo are built on it | `placement-history.ts`, M2-8 |
| **Inverse operation** | The change that reverses another: removing what was placed, moving back, placing again what was removed. Undo sends it as an ordinary command, which can still be refused | `placement-history.ts`, M2-8 |
| **Undo stack / redo stack** | Two lists of changes, newest last. Undo takes from the first and puts on the second; a new change empties the second | `placement-history.ts`, UI_SPEC §17.2 |
| **Design tokens** | Named values for colours, type sizes and spacing that every UI component reads, so the whole app stays consistent and one change updates it everywhere | M8 (ADR-0027) |
| **Vertical slice** | A small piece taken through every step of a process end to end (here one building from generation to the packaged offline build), to prove the process works before scaling it up | M5 art pipeline proof, ADR-0027 |
| **Texture atlas** | Many small sprites packed into one image with a map of where each sits, so the GPU loads and draws them faster | art bible §34.5, M8 |
| **WCAG AA contrast** | The common accessibility standard for readable text: at least 4.5:1 contrast between text and background (3:1 for large text) | UI_SPEC §6.6, M8 |
| **Usability session** | Watching someone do a few real tasks in the app and noting where they get stuck. The findings become fixes or issues | M8 exit (ADR-0027) |
| **Debounce** | Waiting until something has stopped changing for a moment before acting on it. A camera drag becomes one save after 500 ms of stillness instead of 60 saves a second | `comfort.ts`, lesson 033 |
| **Last write wins** | A concurrency rule where the newest save simply replaces what is stored, with no revision check. Safe only when the newest value is always the right one, like a camera position | ADR-0028, lesson 033 |
| **Comfort preferences** | Per-profile settings that make the app easier to use without changing any data: reduced motion, building labels and the saved camera per world | `src/common/preferences/comfort.ts`, UI_SPEC §6.6 |
| **Reduced motion** | A mode that turns off easing and decorative animation. Follows the operating system's `prefers-reduced-motion` setting unless the profile overrides it | `use-reduced-motion.ts`, UI_SPEC §6.6 |
| **WAI-ARIA tabs pattern** | The standard way to build accessible tabs: a `tablist` holding `tab` buttons, each controlling a `tabpanel`. Screen readers announce "tab 2 of 6, selected", the arrow keys move between tabs, and Home and End jump to the first and last | `src/renderer/library/library-tabs.ts` (M2-9), lesson 034 |
| **Roving tabindex** | Only the selected item in a group gets `tabindex="0"`; the rest get `-1`. Tab then stops once on the group, and the arrow keys move inside it, so a long row of tabs doesn't cost six Tab presses | `LibraryPanel.tsx` (M2-9), lesson 034 |
| **Directed edge** | A link with a start and an end, like an arrow. `A depends_on B` and `B depends_on A` are two different links. We store the direction as the source → target order, so it can never disagree with itself | ADR-0029 |
| **Truncation (bounded query)** | Returning only the first N results by a fixed order, together with how many were left out, so a large world can never freeze the screen and the user always knows something is hidden | `graph.worldConnections`, GRAPH_MODEL §30.6 |
| **Deterministic ordering** | Sorting by values that don't change on their own (status, link count, creation time, ID) so the same data always gives the same answer. Names aren't used, because a rename would reshuffle the cut | ADR-0029 |
| **Resource-exhaustion attack (DoS)** | Making an app unusable by feeding it more data or requests than it can handle, instead of stealing anything. A per-world cap on stored links (5000) prevents it for the graph query | ADR-0029, lesson 035 |
| **Minimap** | A small overview of the whole map that shows where things are and which part the camera shows. The Realm Atlas Map tab is one, drawn from saved placements only | `MapTab.tsx` (M2-12), lesson 036 |
| **Viewport (camera)** | The part of the world the screen is showing right now. Worked out by running the camera transform backwards on the canvas corners, and drawn on the Map as a dashed box | `world-camera.ts`, lesson 036 |
| **SVG viewBox** | The part of an SVG's own coordinate space that gets shown; the browser scales it to fit the element. Setting it to world pixels lets the Map reuse the projection with no scaling code | `map-geometry.ts`, lesson 036 |
| **Pinned context** | The project the Realm Atlas stays on whatever else is selected, shown as "Pinned to: …". A display choice only: it grants nothing and moves nothing | GRAPH_MODEL §30.1, ADR-0031 |
| **Window splitter** | The WAI-ARIA pattern for a draggable divider (`role="separator"` with a value), usable with the arrow keys as well as the mouse. The Atlas column's resize handle is one | `RealmAtlasPanel.tsx` (M2-12) |
| **Deterministic layout** | A way of placing graph nodes that gives the same picture for the same data every time, with no randomness or ongoing simulation. The Connections graph uses a ring layout | `connections-layout.ts` (M2-13), ADR-0032, lesson 037 |
| **Polar coordinates** | A position given as an angle and a distance from a centre point instead of x and y; converted with cos and sin. Used to spread nodes around a circle | `connections-layout.ts`, lesson 037 |
| **List equivalent** | A plain, keyboard-usable list that offers the same information and actions as a visual canvas such as a graph or map | `ConnectionsList.tsx`, GRAPH_MODEL §30.6 |
| **Accessible description** | Extra context a screen reader reads after an element's name, linked with `aria-describedby`. The profile security note is the description of its profile section | `ProfilePrivacyNote.tsx` (#62), lesson 039 |
| **OS user boundary** | The real line of protection for local data: anything this Windows account (or an administrator) can open, it can read. Atlas Realm profiles are separate folders inside it, not locked ones | SECURITY.md §13.5, #62 |
| **Variation selector** | An invisible Unicode character that changes how the character before it is drawn, e.g. U+FE0F turns a plain heart into an emoji. One is normal; a run of them (or the U+E0100–U+E01EF range) can hide data | `hidden-characters.ts` (#60), ADR-0033 |
| **ASCII smuggling** | Hiding text inside invisible Unicode characters so a person sees nothing but a model still reads it, e.g. hidden instructions in a project goal. A form of prompt injection | `hidden-characters.ts` (#60), SECURITY.md §21.2 |
| **Strict on input, lenient on read** | Check new data with the newest rules, but don't re-check stored data with them: rows saved under older rules would otherwise break lists or block startup | ADR-0033, `StoredDisplayName` |
| **Critical path** | The longest chain of tasks that each wait on the one before. It sets the shortest possible time to finish a milestone; speeding up anything off this chain doesn't finish sooner | `docs/pm/milestones/M3.md` |
| **Default deny** | A rule style where anything not explicitly allowed is refused. A missing grant means "no", never "probably fine" | SECURITY.md §13.2, M3-10 (#120) |
| **Capability** | A named, narrow permission such as `project.files.read`. Tools declare which capabilities they need; only a grant from the user lets them use one | SECURITY.md §13.1, M3-1 (#111) |
| **Manifest (envelope)** | A package's `manifest.json`: who made it, its license, what it needs and which permissions it asks for. "Envelope" means the shared fields every kind (agent, skill, tool) has, around a small kind-specific block | `resource-manifest.ts`, DATA_MODEL §10.1 |
| **Caret range (`^1.2.0`)** | "This version or a newer compatible one": the leftmost non-zero part stays fixed, so `^1.2.0` accepts 1.9.0 but not 2.0.0 | ADR-0034 |
| **Permission request vs grant** | A request is what a package *asks* for in its manifest; a grant is what the *user* allows. Only grants give access, and a package can never turn its own request into one | `PermissionRequest`, SECURITY.md §13.2 |
| **Junction** | A Windows folder that is really a pointer to another folder; any user can create one (`mklink /J`). A path through it can look inside a folder while the file is elsewhere | `path-policy.ts` (#119), lesson 044 |
| **Real (canonical) path** | Where a path really ends up after the OS follows every junction and symlink. Security checks compare real paths, never the text as typed | `realpath.native` in `path-policy.ts` (#119) |
| **Alternate data stream** | Hidden extra content attached to a file on NTFS, named like `file.txt:stream`. It doesn't show in Explorer, so paths with such a colon are refused | `path-policy.ts` (#119), SECURITY §13.4 |
| **Hard link** | A second name for the very same file (`mklink /H`). Neither name is "the real one", so a real-path check can't catch it; the link count (`nlink`) shows it. The path policy refuses files with more than one name | `path-policy.ts` (#142), ADR-0035, lesson 045 |
| **Dangling link** | A junction or symlink whose target doesn't exist. Asking for its real path says "not found", yet creating through it builds the target elsewhere | `assertNothingAt` (#142), lesson 045 |
| **`lstat`** | "Link stat": information about a name itself, without following it if it's a link. Used to tell "nothing here" from "a link to nothing" | `path-policy.ts` (#142) |
| **Capability object (unforgeable token)** | An object whose possession *is* the permission, so only trusted code can create it (here: a class with a private field, a secret token and a frozen class) | `ApprovedRoot` (#142), lesson 045 |
| **Broad root** | A folder too big to approve without an explicit choice: a whole drive, the home folder, Documents, AppData, or a folder containing one. Needs `broad: true` | `approveRoot` (#142), ADR-0035 |
| **Re-check at use** | Checking a file again after opening it (here: by its volume and file ID), so a link swapped between the check and the open is caught. The fix for TOCTOU on files | `openInsideRoot` (#119) |

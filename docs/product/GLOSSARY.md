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
| Blueprint mode | Simplified structural view of a project interior |

## Developer terms
| Term | Meaning | Where it shows up |
|---|---|---|
| **Acceptance criteria** | Checkable statements that define when a task is done | every issue |
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
| **Formatter** | A tool that rewrites code layout (quotes, spacing) without changing behavior. We use Prettier. | `.prettierrc.json` |
| **Hook (Claude Code)** | A script the harness runs automatically on events (before a tool runs, at session start…) | `.claude/hooks/` |
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
| **AbortController / AbortSignal** | The standard JavaScript way to ask running work to stop. The controller fires; code holding the signal stops | `dispatcher.ts` |
| **Stale reply** | A reply that arrives after its request was cancelled or timed out. It's dropped, never delivered | `worker-bridge.ts` |
| **Sprite** | A single picture (PNG) drawn into the world at a position, e.g. a building or a marker | `grid-scene.ts` |
| **Footprint** | The grid tiles a sprite covers on the ground, e.g. 2×2. Used for placement and collision, never for permissions | `asset-manifest.json` |
| **Ground pivot (anchor)** | The point of an image that is placed on the grid. Ours is the south corner of the footprint, the corner nearest the viewer (ADR-0013) | `asset-manifest.ts` |
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

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

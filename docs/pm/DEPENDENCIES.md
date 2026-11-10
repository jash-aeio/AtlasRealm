# Dependency graph & parallel lanes

> **What is this?** A map of *what must finish before what can start*. Anything without an arrow between it is a candidate for parallel work (see [MULTI_AGENT_GUIDE.md](../process/MULTI_AGENT_GUIDE.md)). Mermaid diagrams render on GitHub.

## Milestone level

```mermaid
flowchart LR
  S[Setup ✅] --> M0
  M0 --> M1
  M1 --> M2
  M1 --> M3
  M1 --> IMP1[IMP-1 Import inspect]
  IMP1 --> M3
  M3 --> M4
  M2 --> ALPHA((Alpha))
  M4 --> ALPHA
  M4 --> M5
  M4 --> M6
  M5 -. core views .-> M6
  M5 --> M7
  M6 --> M7
  M7 --> M8((MVP))
  M8 --> M9 --> M10 --> M11
```

**Parallel opportunities between milestones**
| After | Can run in parallel | Watch out for |
|---|---|---|
| M1 | M2 (world/canvas) ∥ M3 (resources/broker) ∥ IMP-1 | M2 and M3 both add DB migrations, so serialize migration numbering |
| M4 | M5 (experience) ∥ M6 (scheduler core) | M6 UI needs M5 project tabs. Do M6 backend first. |
| Any time | Art (ART_BIBLE, placeholders, later PixelLab batches) | Assets need the manifest format from M0-8 |
| M3+ | Provider adapters (OpenAI, Anthropic) behind the contract | Contract must be frozen first (M4) |

## Task level: M0

| Issue | Task | Depends on | Lane | Parallel-safe | Files owned |
|---|---|---|---|---|---|
| M0-1 ([#4](https://github.com/jash-aeio/AtlasRealm/issues/4)) | Tooling scaffold (pnpm, TS strict, ESLint/Prettier, Vitest, real CI) | — | — | ❌ goes first | root config, `.github/workflows` |
| M0-2 ([#5](https://github.com/jash-aeio/AtlasRealm/issues/5)) | Electron + React + Vite shell, minimal preload, typed IPC round-trip | M0-1 | A | ✅ | `src/main/bootstrap`, `src/preload`, `src/renderer/app`, `src/common/contracts` |
| M0-3 ([#6](https://github.com/jash-aeio/AtlasRealm/issues/6)) | SQLite binding + migration runner + persistence test | M0-1 | B | ✅ | `src/main/storage` |
| M0-4 ([#7](https://github.com/jash-aeio/AtlasRealm/issues/7)) | PixiJS placeholder canvas | M0-2 (renderer exists) | C | ✅ | `src/renderer/world` |
| M0-5 ([#8](https://github.com/jash-aeio/AtlasRealm/issues/8)) | React Flow selection-sharing spike | M0-2 | C | ✅ | `src/renderer/atlas` |
| M0-6 ([#9](https://github.com/jash-aeio/AtlasRealm/issues/9)) | Worker messaging spike | M0-2 | A | ✅ | `src/worker` |
| M0-7 ([#10](https://github.com/jash-aeio/AtlasRealm/issues/10)) | Windows packaging + smoke test | M0-2, M0-3 | — | ❌ integrator | packaging config |
| M0-8 ([#11](https://github.com/jash-aeio/AtlasRealm/issues/11)) | Minimal ART_BIBLE values + placeholder sprites + asset manifest | — | D | ✅ any time | `resources/assets`, `docs/art` |

```mermaid
flowchart LR
  M01[M0-1 Tooling] --> M02[M0-2 Shell + IPC]
  M01 --> M03[M0-3 SQLite]
  M02 --> M04[M0-4 Pixi]
  M02 --> M05[M0-5 React Flow]
  M02 --> M06[M0-6 Worker]
  M02 --> M07[M0-7 Packaging]
  M03 --> M07
  M08[M0-8 Art placeholders]
```

> Note: M0-4/M0-5 depend on M0-2 only because they need a renderer to mount into. If M0-2 lands its app skeleton early, C can start right away.

## Task level: M1

| Issue | Task | Depends on | Lane | Parallel-safe | Files owned |
|---|---|---|---|---|---|
| M1-1 ([#20](https://github.com/jash-aeio/AtlasRealm/issues/20)) | Block Chromium debug and security switches | — | A | ✅ | `src/main/index.ts` (early guard), `electron-builder.yml`, `tests/e2e-packaged` |
| M1-2 ([#29](https://github.com/jash-aeio/AtlasRealm/issues/29)) | Profile storage (index, folders, adopt M0 default) | M1-1 | A | ❌ | `src/main/storage/profiles/*`, `src/main/storage/app-database.ts`, `src/main/index.ts` |
| M1-3 ([#30](https://github.com/jash-aeio/AtlasRealm/issues/30)) | Schema v2 + repositories | — | B | ✅ (migration) | `src/main/storage/migrations/index.ts`, `src/main/storage/repositories/{profile-settings,world,project}-repository.ts`, `tests/fixtures/db` |
| M1-4 ([#31](https://github.com/jash-aeio/AtlasRealm/issues/31)) | Graph entity IDs + ownership | M1-3 | B | ✅ (migration, after M1-3) | `src/main/storage/migrations/index.ts`, `src/main/storage/repositories/graph-entity-repository.ts` |
| M1-5 ([#32](https://github.com/jash-aeio/AtlasRealm/issues/32)) | Project template metadata | — | C | ✅ | `resources/project-templates/**`, `src/common/contracts/project-template.ts`, `src/main/templates/*` |
| M1-6 ([#33](https://github.com/jash-aeio/AtlasRealm/issues/33)) | Profile + world commands | M1-2, M1-3 | A | ❌ shared preload/channels | `src/main/ipc/commands/{profile,world}*`, `src/common/contracts/{profile,world}.ts`, `channels.ts`, `atlas-api.ts`, `src/preload/index.ts` |
| M1-7 ([#34](https://github.com/jash-aeio/AtlasRealm/issues/34)) | Project commands | M1-3, M1-4, M1-5, M1-6 | B | ❌ shared preload/channels | `src/main/services/project-service.ts`, `src/main/ipc/commands/project*`, `src/common/contracts/project.ts` |
| M1-8 ([#35](https://github.com/jash-aeio/AtlasRealm/issues/35)) | Profile switching | M1-2, M1-6 | A | ❌ | `src/main/services/profile-session.ts`, `src/main/runtime-bridge/*` |
| M1-9 ([#36](https://github.com/jash-aeio/AtlasRealm/issues/36)) | First-launch UI | M1-6 | C | ❌ | `src/renderer/app/*`, `src/renderer/onboarding/*`, `src/renderer/state/*` |
| M1-10 ([#37](https://github.com/jash-aeio/AtlasRealm/issues/37)) | Project list UI | M1-7, M1-9 | C | ❌ | `src/renderer/projects/*` |
| M1-11 ([#38](https://github.com/jash-aeio/AtlasRealm/issues/38)) | Acceptance E2E + packaged smoke | M1-8, M1-10 | — | ❌ integrator | `tests/e2e/m1-*.spec.ts`, `tests/e2e-packaged/*` |

```mermaid
flowchart LR
  M11[M1-1 #20 Switch guard] --> M12[M1-2 #29 Profile storage]
  M13[M1-3 #30 Schema v2] --> M14[M1-4 #31 Graph entity IDs]
  M15[M1-5 #32 Template metadata]
  M12 --> M16[M1-6 #33 Profile + world cmds]
  M13 --> M16
  M16 --> M17[M1-7 #34 Project cmds]
  M14 --> M17
  M15 --> M17
  M12 --> M18[M1-8 #35 Profile switching]
  M16 --> M18
  M16 --> M19[M1-9 #36 First-launch UI]
  M17 --> M110[M1-10 #37 Project list UI]
  M19 --> M110
  M18 --> M111[M1-11 #38 Acceptance E2E]
  M110 --> M111
```

**Critical path:** M1-1 → M1-2 → M1-6 → M1-7 → M1-10 → M1-11.
**Parallel lanes at the start:** A = M1-1 → M1-2 · B = M1-3 → M1-4 · C = M1-5. From M1-6 on, the command tasks share `channels.ts`, `atlas-api.ts` and the preload, so they run one after another. M1-8 (lane A) and M1-9 (lane C) can overlap once M1-6 lands.
> Migration numbering: M1-3 owns migration 2 and M1-4 owns migration 3. No other M1 task adds a migration.

## Updating this file
`/plan-milestone Mx` adds a task table and graph for each new milestone. Keep **Files owned** accurate. It's what makes parallel work safe.

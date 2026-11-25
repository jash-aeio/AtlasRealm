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
  IMP1 -. planned inside M3 .-> M3
  M3 --> M4
  M2 --> ALPHA((Alpha))
  M4 --> ALPHA
  M4 --> M5
  M4 --> M6
  M5 -. core views .-> M6
  M5 --> M7
  M6 --> M7
  M7 --> M8[M8 UI/UX + art]
  M8 --> M9((MVP))
  M9 --> M10 --> M11 --> M12
```

**Parallel opportunities between milestones**
| After | Can run in parallel | Watch out for |
|---|---|---|
| M1 | M2 (world/canvas) ∥ M3 (resources/broker); IMP-1 is planned inside M3 | M2 and M3 both add DB migrations, so serialize migration numbering |
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

## Task level: M2

| Issue | Task | Depends on | Lane | Parallel-safe | Files owned |
|---|---|---|---|---|---|
| M2-1 ([#66](https://github.com/jash-aeio/AtlasRealm/issues/66)) | Placement rules | — | C | ✅ | `src/common/world/placement-rules.ts`, `tests/domain/placement-rules.test.ts` |
| M2-2 ([#67](https://github.com/jash-aeio/AtlasRealm/issues/67)) | Schema v5: placements + hotbar | — | A | ✅ (migration 5) | `src/main/storage/migrations/index.ts`, `src/main/storage/repositories/{placement,hotbar}-repository.ts`, `tests/fixtures/db` |
| M2-3 ([#68](https://github.com/jash-aeio/AtlasRealm/issues/68)) | Placement commands | M2-1, M2-2, #59 | A | ❌ shared preload/channels | `src/main/services/placement-service.ts`, `src/main/ipc/commands/placement.ts`, `src/common/contracts/placement.ts`, `project-service.ts` (archive/trash hook) |
| M2-4 ([#69](https://github.com/jash-aeio/AtlasRealm/issues/69)) | Hotbar commands | M2-2, M2-3 | A | ❌ shared preload/channels | `src/main/services/hotbar-service.ts`, `src/main/ipc/commands/hotbar.ts`, `src/common/contracts/hotbar.ts` |
| M2-5 ([#70](https://github.com/jash-aeio/AtlasRealm/issues/70)) | Main layout + shortcut layer + sidebar | — | B | ✅ | `src/renderer/app/*`, `tests/e2e/shell.spec.ts` |
| M2-6 ([#71](https://github.com/jash-aeio/AtlasRealm/issues/71)) | World shows real buildings | M2-3, M2-5 | B | ❌ | `src/renderer/world/*`, `src/renderer/state/selection.ts`, `tests/e2e/world.spec.ts` |
| M2-7 ([#72](https://github.com/jash-aeio/AtlasRealm/issues/72)) | Placement tool | M2-6 | B | ❌ | `src/renderer/world/placement-tool.ts`, `src/renderer/projects/ProjectItem.tsx`, `tests/e2e/placement.spec.ts` |
| M2-8 ([#73](https://github.com/jash-aeio/AtlasRealm/issues/73)) | Placement undo/redo | M2-7 | B | ❌ | `src/renderer/world/placement-history.ts`, `tests/domain/placement-history.test.ts` |
| M2-9 ([#74](https://github.com/jash-aeio/AtlasRealm/issues/74)) | Library panel (E) | M2-3, M2-5 | C | ❌ | `src/renderer/library/*`, `src/renderer/projects/*` (filters), `tests/e2e/library.spec.ts` |
| M2-10 ([#75](https://github.com/jash-aeio/AtlasRealm/issues/75)) | Hotbar UI | M2-4, M2-9 | C | ❌ | `src/renderer/hotbar/*`, `tests/e2e/hotbar.spec.ts` |
| M2-11 ([#76](https://github.com/jash-aeio/AtlasRealm/issues/76)) | Project links + bounded graph query | M2-2, M2-4 | A | ❌ shared preload/channels | migration 6, `src/main/services/graph-service.ts`, `src/main/ipc/commands/{relation,graph}.ts`, `src/common/contracts/{relation,graph}.ts` |
| M2-12 ([#77](https://github.com/jash-aeio/AtlasRealm/issues/77)) | Atlas shell + Map tab | M2-6 | C | ❌ | `src/renderer/atlas/RealmAtlasPanel.tsx`, `src/renderer/atlas/MapTab.tsx`, `tests/e2e/atlas.spec.ts` |
| M2-13 ([#78](https://github.com/jash-aeio/AtlasRealm/issues/78)) | Atlas Connections | M2-11, M2-12 | C | ❌ | `src/renderer/atlas/{ConnectionsGraph,ConnectionsList,LinkForm}.tsx` |
| M2-14 ([#79](https://github.com/jash-aeio/AtlasRealm/issues/79)) | Comfort settings | M2-6 | B | ❌ | `src/renderer/world/comfort.ts`, `SettingsView.tsx` (comfort section) |
| M2-15 ([#80](https://github.com/jash-aeio/AtlasRealm/issues/80)) | Acceptance E2E + packaged smoke | all | — | ❌ integrator | `tests/e2e/m2-acceptance.spec.ts`, `tests/e2e-packaged/*` |
| [#56](https://github.com/jash-aeio/AtlasRealm/issues/56) | Fix flaky timing tests + IPC payload gate | — | D | ✅ | `tests/integration/{ipc-router,worker-messaging}.test.ts`, `src/main/ipc/router.ts`, `src/common/contracts/json-size.ts` (any later task touching these two goes after #56) |
| [#57](https://github.com/jash-aeio/AtlasRealm/issues/57) | Packaged offline resource-timing test | — | D | ✅ | `tests/e2e-packaged/packaged.spec.ts` |
| [#58](https://github.com/jash-aeio/AtlasRealm/issues/58) | CSP: drop `data:` from `img-src` | — | D | ✅ | `src/common/security/csp.ts` |
| [#59](https://github.com/jash-aeio/AtlasRealm/issues/59) | Archived-world guard (F5) | — | D | ❌ before M2-3 | `src/main/services/project-service.ts` |
| [#60](https://github.com/jash-aeio/AtlasRealm/issues/60) | Hidden Unicode in names/goals | — | D | ✅ | `src/common/contracts/{display-name,world,project}.ts`, `repository-support.ts` |
| [#62](https://github.com/jash-aeio/AtlasRealm/issues/62) | Profile security notice | M2-5 | D | ❌ | `src/renderer/app/SettingsView.tsx` |

```mermaid
flowchart LR
  M21[M2-1 #66 Placement rules] --> M23[M2-3 #68 Placement cmds]
  M22[M2-2 #67 Schema v5] --> M23
  I59[#59 Archived-world guard] --> M23
  M23 --> M24[M2-4 #69 Hotbar cmds]
  M22 --> M24
  M24 --> M211[M2-11 #76 Project links]
  M22 --> M211
  M25[M2-5 #70 Layout + shortcuts] --> M26[M2-6 #71 World buildings]
  M23 --> M26
  M26 --> M27[M2-7 #72 Placement tool] --> M28[M2-8 #73 Undo/redo]
  M23 --> M29[M2-9 #74 Library]
  M25 --> M29
  M29 --> M210[M2-10 #75 Hotbar UI]
  M24 --> M210
  M26 --> M212[M2-12 #77 Atlas Map]
  M212 --> M213[M2-13 #78 Atlas Connections]
  M211 --> M213
  M26 --> M214[M2-14 #79 Comfort]
  M25 --> I62[#62 Profile notice]
  I56[#56 Flaky tests]
  I57[#57 Packaged timing test]
  I58[#58 CSP img-src]
  I60[#60 Hidden Unicode]
  M28 --> M215[M2-15 #80 Acceptance]
  M210 --> M215
  M213 --> M215
  M214 --> M215
  I56 --> M215
  I57 --> M215
  I58 --> M215
  I60 --> M215
  I62 --> M215
```

**Critical path:** M2-2 → M2-3 → M2-6 → M2-7 → M2-8 → M2-15. A second path of the same length: M2-3 → M2-4 → M2-11 → M2-13 → M2-15.
**Parallel lanes at the start (max 3):** A = M2-2 (schema), with #59 first or alongside it · B = M2-5 (layout) · C = M2-1 (rules). Lane D follow-ups (#56 already in progress, #57, #58, #60) are small and parallel-safe, so they fill gaps. M2-3, M2-4 and M2-11 share `channels.ts`, `atlas-api.ts` and the preload, so they run one after another. Once M2-6 lands, B (M2-7 → M2-8, M2-14) and C (M2-12, M2-9 → M2-10) can overlap.
> Migration numbering: M2-2 owns migration 5 and M2-11 owns migration 6. No other M2 task adds a migration. If M3 work starts in parallel, it takes migration 7 or later.

## Task level: M3

| Issue | Task | Depends on | Lane | Parallel-safe | Files owned |
|---|---|---|---|---|---|
| [#108](https://github.com/jash-aeio/AtlasRealm/issues/108) | world.spec hover flake | — | A | ✅ | `tests/e2e/world.spec.ts` (`src/renderer/world/*` only if the cause is there) |
| [#61](https://github.com/jash-aeio/AtlasRealm/issues/61) | Profile/world caps on read | — | D | ✅ | `src/main/profiles/profile-service.ts`, `src/main/storage/profiles/profiles-index.ts`, `src/common/contracts/{profile,world}.ts` |
| [#106](https://github.com/jash-aeio/AtlasRealm/issues/106) | Hidden-data combinations | — | C | ✅ | `src/common/text/hidden-characters.ts`, `profile-service.ts` (duplicate check; after #61 if both are open) |
| M3-1 ([#111](https://github.com/jash-aeio/AtlasRealm/issues/111)) | Manifest schema + capability registry | — | A | ✅ contract, goes first | `src/common/contracts/resource-manifest.ts`, `src/common/security/capabilities.ts` |
| M3-2 ([#112](https://github.com/jash-aeio/AtlasRealm/issues/112)) | Bundled packages + catalog loader | M3-1 | A | ❌ | `resources/packages/**`, `src/main/resources/*`, electron-builder extraResources |
| M3-3 ([#113](https://github.com/jash-aeio/AtlasRealm/issues/113)) | Schema v7: resources + team | M3-1 | A | ❌ migration 7 | `src/main/storage/migrations/index.ts`, `src/main/storage/repositories/{resource-*,agent-instance,binding}-repository.ts` |
| M3-4 ([#114](https://github.com/jash-aeio/AtlasRealm/issues/114)) | Readiness calculation | M3-1 | C | ✅ | `src/common/resources/readiness.ts` |
| M3-5 ([#115](https://github.com/jash-aeio/AtlasRealm/issues/115)) | Install/enable commands | M3-2, M3-3, M3-4 | A | ❌ shared preload/channels | `src/common/contracts/resource.ts`, `src/main/services/resource-service.ts`, `src/main/ipc/commands/resource.ts` |
| M3-6 ([#116](https://github.com/jash-aeio/AtlasRealm/issues/116)) | Recruit + bindings | M3-5 | A | ❌ shared preload/channels | `src/common/contracts/agent.ts`, `src/main/services/agent-service.ts`, `src/main/ipc/commands/agent.ts` |
| M3-7 ([#117](https://github.com/jash-aeio/AtlasRealm/issues/117)) | Library Agents/Skills/Tools | M3-5 | C | ❌ | `src/renderer/library/{Agents,Skills,Tools}Tab.tsx`, `src/renderer/library/resource-card/*`, `tests/e2e/resources.spec.ts` |
| M3-8 ([#118](https://github.com/jash-aeio/AtlasRealm/issues/118)) | Recruit dialog + Team panel | M3-6, M3-7 | C | ❌ | `src/renderer/projects/team/*`, `src/renderer/library/RecruitDialog.tsx`, `tests/e2e/team.spec.ts` |
| M3-9 ([#119](https://github.com/jash-aeio/AtlasRealm/issues/119)) | Path policy | — | B | ✅ | `src/main/security/path-policy.ts` |
| M3-10 ([#120](https://github.com/jash-aeio/AtlasRealm/issues/120)) | Schema v8 + policy evaluator | M3-1, M3-3 | B | ❌ migration 8 | `migrations/index.ts`, `repositories/{grant,approval,audit,artifact}-repository.ts`, `src/common/security/authorize.ts` |
| M3-11 ([#121](https://github.com/jash-aeio/AtlasRealm/issues/121)) | Grant/approval/audit services | M3-10 | B | ❌ shared preload/channels | `src/common/contracts/permission.ts`, `src/main/services/{permission,audit}-service.ts`, `src/main/ipc/commands/permission.ts` |
| M3-12 ([#122](https://github.com/jash-aeio/AtlasRealm/issues/122)) | Immutable artifact storage | M3-9, M3-10 | B | ❌ | `src/main/services/artifact-store.ts`, `src/main/storage/managed-paths.ts` |
| M3-13 ([#123](https://github.com/jash-aeio/AtlasRealm/issues/123)) | File tools + broker | M3-11, M3-12 | B | ❌ shared preload/channels | `src/main/broker/*`, `src/main/ipc/commands/tool.ts`, `src/common/contracts/tool.ts` |
| M3-14 ([#124](https://github.com/jash-aeio/AtlasRealm/issues/124)) | Approval card, manual run, artifacts, preview | M3-8, M3-13 | C | ❌ | `src/renderer/{projects/files,approvals,projects/activity}/*`, `tests/e2e/artifacts.spec.ts` |
| M3-15 ([#125](https://github.com/jash-aeio/AtlasRealm/issues/125)) | Permission-aware file index | M3-13 | B | ❌ | `src/main/services/{graph,index}-service.ts`, `graph-entity-repository.ts` |
| M3-16 ([#126](https://github.com/jash-aeio/AtlasRealm/issues/126)) | IMP-1 inventory + classifier | M3-9 | D | ✅ | `src/main/import/{inventory,exclusions}.ts`, `src/common/import/classify.ts` |
| M3-17 ([#127](https://github.com/jash-aeio/AtlasRealm/issues/127)) | Schema v9: import sessions + inspect | M3-10, M3-11, M3-16 | D | ❌ migration 9 | `migrations/index.ts`, `repositories/import-repository.ts`, `src/main/services/import-service.ts`, `src/main/ipc/commands/import.ts`, `src/common/contracts/import.ts` |
| M3-18 ([#128](https://github.com/jash-aeio/AtlasRealm/issues/128)) | IMP-2 commit | M3-12, M3-17, #61 | D | ❌ | `src/main/import/{commit,staging}.ts`, `import-service.ts` |
| M3-19 ([#129](https://github.com/jash-aeio/AtlasRealm/issues/129)) | Duplicates + re-link | M3-18 | D | ❌ | `src/main/import/{duplicates,relink}.ts` |
| M3-20 ([#130](https://github.com/jash-aeio/AtlasRealm/issues/130)) | Import wizard UI | M3-7, M3-19 | C | ❌ | `src/renderer/import/*`, `tests/e2e/import.spec.ts`, `tests/fixtures/import/**` |
| M3-21 ([#131](https://github.com/jash-aeio/AtlasRealm/issues/131)) | Acceptance E2E + packaged smoke | all | — | ❌ integrator | `tests/e2e/m3-acceptance.spec.ts`, `tests/e2e-packaged/*` |

```mermaid
flowchart LR
  I108[#108 Hover flake]
  I61[#61 Read caps]
  I106[#106 Hidden-data rules]
  M31[M3-1 #111 Manifest + capabilities] --> M32[M3-2 #112 Bundled catalog]
  M31 --> M33[M3-3 #113 Schema v7]
  M31 --> M34[M3-4 #114 Readiness]
  M32 --> M35[M3-5 #115 Install cmds]
  M33 --> M35
  M34 --> M35
  M35 --> M36[M3-6 #116 Recruit cmds]
  M35 --> M37[M3-7 #117 Library tabs]
  M36 --> M38[M3-8 #118 Team panel]
  M37 --> M38
  M39[M3-9 #119 Path policy] --> M312[M3-12 #122 Artifact store]
  M31 --> M310[M3-10 #120 Schema v8 + authorize]
  M33 --> M310
  M310 --> M311[M3-11 #121 Grants/approvals]
  M310 --> M312
  M311 --> M313[M3-13 #123 Broker + file tools]
  M312 --> M313
  M38 --> M314[M3-14 #124 Approval + artifacts UI]
  M313 --> M314
  M313 --> M315[M3-15 #125 File index]
  M39 --> M316[M3-16 #126 Inventory]
  M316 --> M317[M3-17 #127 Schema v9 + inspect]
  M310 --> M317
  M311 --> M317
  M317 --> M318[M3-18 #128 Import commit]
  M312 --> M318
  I61 --> M318
  M318 --> M319[M3-19 #129 Duplicates + re-link]
  M319 --> M320[M3-20 #130 Wizard UI]
  M37 --> M320
  M314 --> M321[M3-21 #131 Acceptance]
  M315 --> M321
  M320 --> M321
  I108 --> M321
  I106 --> M321
```

**Critical path:** M3-1 → M3-3 → M3-10 → M3-11 → M3-13 → M3-14 → M3-21. The import chain M3-10 → M3-17 → M3-18 → M3-19 → M3-20 → M3-21 is about as long.
**Parallel lanes at the start (max 3):** A = #108, then M3-1 (contract, first) → M3-3 → M3-2 · B = M3-9 (path policy) · D = #61 → M3-16 once M3-9 lands (or alongside it, since M3-16 only imports the path-policy API). Lane C (#106, M3-4) fills gaps and becomes the UI lane once M3-5 lands. M3-5, M3-6, M3-11, M3-13 and M3-17 all add IPC channels and preload methods, so they run one after another, never at the same time. Every lane uses its own git worktree from the start (M2 retro).
> Migration numbering: M3-3 owns migration 7, M3-10 owns migration 8 and M3-17 owns migration 9. No other M3 task adds a migration. Each bumps the expected schema version in `tests/e2e/storage.spec.ts` and `tests/e2e-packaged/packaged.spec.ts`.

## Updating this file
`/plan-milestone Mx` adds a task table and graph for each new milestone. Keep **Files owned** accurate. It's what makes parallel work safe.

# ADR-0030: Upgrade React Flow to v13

- **Status:** Accepted
- **Date:** 2026-11-23
- **Milestone(s) affected:** M2 (M2-13 #78 Atlas Connections), M5
- **Decided by:** the user, who squash-merged Dependabot PR #55 on 2026-11-23 after reviewing the v13 fix and the option to stay on v12

## Context
[ADR-0003](0003-react-flow-realm-atlas.md) chose React Flow for the Realm Atlas Connections graph (spec §30) and pinned `@xyflow/react` 12.12.1. Dependabot PR #55 bundled nine updates into its "dev-dependencies" group, all minor or patch releases except one: `@xyflow/react` 12.12.1 → **13.0.2**. A major version may break existing code, and this one broke typecheck (`pnpm typecheck` failed in CI).

Only one file uses React Flow: `src/renderer/atlas/ConnectionsGraph.tsx` (the M0-5 spike graph). M2-13 (#78) will build the real Connections tab on it, so we needed to pick a version before that work starts. The official docs (reactflow.dev, via context7) still describe v12, so the v13 API was read from the published type definitions of `@xyflow/react` 13.0.2 and `@xyflow/system` 1.0.0.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **Upgrade to v13 now** (fix the code in PR #55) | #78 starts on the current major version; only two small code changes; the other eight updates land at once | The docs don't cover v13 yet, so we read type definitions; a young major release may still get fixes |
| Stay on v12 (take `@xyflow/react` out of the group, add a Dependabot `ignore` for majors) | No code change; docs match | #78 would be built on a version we'd have to migrate later, with more code to change by then |

## Decision
We upgrade to **`@xyflow/react` 13.0.2** (exact pin, still MIT). Two v13 changes affected our code; both were fixed in `ConnectionsGraph.tsx` (commit `2644ac2`, squash-merged as `918a758`):

1. **`onNodesChange` gets a `NodeChangeset` object instead of an array.** The changeset can be looped over and has helpers. We now read `changes.getByType('select')` and forward only "this node was selected" to the shared selection store, exactly as before. Selection stays *controlled*: the store, not React Flow, decides what is selected (ADR-0003).
2. **The `colorMode` prop is now `forceColorMode`.** It still adds a `dark` class to the graph container. v13's stylesheet uses the CSS `light-dark()` function; it is still a static file that Vite bundles into our stylesheet, so the strict CSP (`style-src 'self'`) is unchanged.

Unchanged in v13 and still true from ADR-0003: the CSS file `@xyflow/react/dist/style.css`, no runtime `<style>` tags, and the attribution link (`proOptions.hideAttribution`), whose credit decision is still open.

Evidence (2026-11-23, local Windows 11, PR branch merged with main @ 39400be): typecheck, lint and format:check pass; unit/integration 1072/1072; E2E 87/87, including the Atlas graph click and keyboard selection tests; CI green on PR #55. After merge, main @ 918a758: typecheck and 1072/1072 again. Packaged E2E was not run for this change.

## Consequences
- **For M2-13 (#78):** type change handlers with `NodeChangeset` / `EdgeChangeset` (or `OnNodesChange<T>`), not arrays. Use `changeset.getByType(...)` to pick change kinds. React Flow's state is still never the authoritative copy: links are saved through `relation.create` / `relation.remove`, and the graph is refetched after each committed change.
- Use `forceColorMode` for the Atlas theme, or set `data-theme` on `<html>` if the whole app gets theming in M8.
- Docs examples on reactflow.dev may still show v12 signatures. When in doubt, check the installed `.d.ts` files.
- Dependabot groups major updates together with minor ones. A future major bump will fail typecheck again in the same way; that is the intended warning, and each one gets its own look.
- **Signals to revisit:** a v13 bug affecting selection or performance at 150 nodes / 300 edges (re-measure as in the ADR-0003 spike), or #78 needing an API that only exists in v12. Then pin back to 12.x and record why.

## Learning note
Semantic versioning (`MAJOR.MINOR.PATCH`) is a promise: a new major number means "your code may need changes". A strict type checker turns that promise into a concrete list of what to fix, which is why `pnpm typecheck` caught this before anyone ran the app.

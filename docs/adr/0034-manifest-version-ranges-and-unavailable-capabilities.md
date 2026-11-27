# ADR-0034: Manifest version ranges and capabilities that aren't built yet

- **Status:** Accepted
- **Date:** 2026-11-27
- **Milestone(s) affected:** M3 (M3-1 #111, used by M3-2 #112 and M3-4 #114); later community imports
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-27)

## Context
M3-1 defines the one manifest "envelope" for agent, skill and tool packages (DATA_MODEL §10.1). Two parts of that contract weren't settled by the spec:

1. **Version ranges.** An agent names the skills and tools it uses by default, and any package can need another package. M3-2 must report "missing dependency" and "incompatible version" (DATA_MODEL §10.2), so each reference needs a way to say which versions work. Community manifests are untrusted, so the format is attack surface.
2. **Known but unavailable capabilities.** The registry lists all 21 capability IDs from SECURITY §13.1, but M3 builds only six of them. The spec doesn't say whether a manifest may request one of the other 15 (for example `network.fetch`).

## Options considered
**Version ranges**

| Option | Pros | Cons |
|---|---|---|
| **Our own tiny format: `1.2.0` or `^1.2.0`** | No new dependency; about 20 lines, fully tested; the caret reads like npm | Fewer forms than npm. A wider range needs a format change later |
| Add the `semver` package | Full npm grammar (`>=`, `\|\|`, `~`, x-ranges) | A new dependency, and a much bigger grammar for untrusted input to exercise |
| `{ "min", "below" }` object | Nothing to parse | Wordier, and unfamiliar to people who know npm |

**Unavailable capabilities**

| Option | Pros | Cons |
|---|---|---|
| **Accept the manifest; readiness marks it not ready** | Honest: a future package shows as "waiting", not "broken". Truly unknown IDs are still refused | Readiness (M3-4) and the broker have to check `available` |
| Refuse the manifest | Simpler today | A valid package looks broken, and we'd have to loosen the rule later |

## Decision
- **Version ranges:** our own format. A range is either an exact version (`1.2.0`) or a caret range (`^1.2.0`). The caret follows npm: the leftmost non-zero part stays fixed, so `^1.2.0` accepts 1.x.x from 1.2.0, `^0.3.1` accepts 0.3.x from 0.3.1, and `^0.0.4` accepts only 0.0.4. The code is `VersionRange` and `satisfiesRange` in `src/common/contracts/resource-manifest.ts`.
- **Unavailable capabilities:** the manifest is accepted if every capability ID is in the registry. `CAPABILITIES[id].available` (`src/common/security/capabilities.ts`) is false for the 15 that aren't built, and readiness reports the package as waiting. An ID outside the registry is refused with `unknown_capability`.

### Added after the security review (2026-11-27)
- **Running programs is refused, not "waiting".** The review pointed out that a package could declare `process.execute`. It was harmless, but §10.3 and SECURITY §13.4 forbid executable content in the MVP. The user chose to refuse it when the manifest is parsed, with reason `executable_content`, instead of the softer "known but not available". `REFUSED_IN_PACKAGES` in `capabilities.ts` holds this list, and allowing anything on it later takes a new ADR.
- **The loader decides where a manifest came from, not the manifest.** `parseResourceManifest(raw, origin)` takes `'bundled'` or `'import'` from the code that found the file. A manifest that claims to be bundled, or uses the reserved `builtin.*` namespace, without coming from the app's own folder is refused as `origin_mismatch`. Without this, an imported `builtin.structured-brief` 9.0.0 could pass for a newer bundled package. This is a routine fix from the review and was not a separate question.

## Consequences
- Adds no dependency. M3-2 and M3-4 call `satisfiesRange` instead of writing their own check.
- `available: false` never stops a manifest from loading, so **every** consumer that would use a capability must check it. The broker (M3-10) must refuse to authorize a capability that isn't available even when a grant exists, and readiness (M3-4) must not show such a package as Ready.
- The scopes listed for unavailable capabilities are best guesses, to be confirmed when each capability is built.
- **Signals to revisit:** packages need ranges such as "1.x or 2.x", or a community format we want to import uses npm ranges.

## Learning note
Choose the smallest input format that does the job when the input comes from strangers. Every extra syntax rule is another place for a parser bug. And "known but not ready yet" is a different state from "invalid": showing it honestly beats pretending the package is broken.

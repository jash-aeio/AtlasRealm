# ADR-0027: Add M8 "UI/UX polish and art integration" before MVP completion

- **Status:** Accepted
- **Date:** 2026-11-23
- **Milestone(s) affected:** M5, new M8, old M8–M11 (now M9–M12)
- **Decided by:** the developer (asked via AskUserQuestion on 2026-11-23)

## Context
The original roadmap (ROADMAP_SPEC §23) has no milestone where the UI/UX and art of the whole app are the main focus. The art work was a single line in M5 ("a small locally bundled fantasy asset set … or built from placeholders"). The rest was scattered: the art bible and placeholders in M0, placeholder-art world UI in M2, offline asset checks in M7, and an optional in-app asset studio in M10. Meanwhile the MVP release gate (RELEASE_GATES §25.3) needs bundled fantasy assets with recorded provenance, and UI_SPEC §17.3 says placeholders must be replaced before public release. Nothing scheduled one consistent pass over every screen, the full art batch (art bible §34.4), and accessibility. Three questions were open:
1. Where does the new milestone go, and how is it numbered?
2. Where does the art come from?
3. What happens to M5's asset line?

## Options considered
| Question | Option | Pros | Cons |
|---|---|---|---|
| Numbering | **New M8, renumber the rest** (chosen) | Plain sequence; "M8" names the milestone just before MVP | About 10 references in 6 docs and the GitHub milestone must change; older session logs (which are never rewritten) use "M8" for what is now M9 |
| | M7.5, keep other numbers | Nothing else changes | Unusual name; issue codes like `M7.5-3` read awkwardly |
| Art source | **PixelLab MCP with a per-batch budget cap** (chosen) | The art bible's chosen route; one consistent custom style | Needs the user's paid subscription and an approved credit budget per batch |
| | Free CC0 packs (e.g. Kenney) | No cost or account; clear licence | Style may not match the "warm storybook" palette; mixing packs risks inconsistency |
| | Mixed CC0 + PixelLab | Lower cost | Needs a careful consistency test scene |
| M5 assets | **M5 proves the pipeline with a small slice** (chosen) | Pipeline problems (scale, pivots, atlas packing, packaging) show up early; art isn't made twice | M5 still needs one small budgeted PixelLab batch |
| | Move all art to M8 | Simplest M5 | Pipeline risks surface late, close to MVP |
| | Keep M5 as is | No change | Art made before the UI settles may be redone |

## Decision
- A new **M8 — UI/UX polish and art integration** goes after M7 and before MVP completion. The old M8 (Provider breadth and MVP completion) becomes **M9**, and the old M9, M10 and M11 become **M10, M11 and M12**. The GitHub milestone `M8` is renamed `M9`, and a new `M8` is created.
- M8 covers a screen-by-screen UX audit against UI_SPEC §6, a visual system (design tokens, shared panels, a status icon set), the full art bible §34.4 batch, manifest and atlas integration with provenance, state-driven animation with reduced-motion variants, an accessibility pass, and performance measured against UI_SPEC §17.4 with the real art. ROADMAP_SPEC holds the build, checks and exit text.
- Art comes from **PixelLab MCP** as a development-time tool (art bible §34.2). Each batch has a request/credit cap approved by the user before generation. Labelled placeholders stay as the offline fallback.
- **M5 only proves the pipeline**: a small vertical slice (for example one building and the avatar) goes through art bible §34.5 into the offline bundle.

## Consequences
- MVP is reached one milestone later, but it now explicitly includes the design, art and accessibility work that RELEASE_GATES already required without saying when.
- Docs updated: ROADMAP_SPEC, ROADMAP, DEPENDENCIES, OBSIDIAN_BRIDGE (O2 after M10, O3 in M11), PROMPTS (the original §27.8 prompt says "M7/M8"; it now means M7/M9), and art bible §34.4. ORIGINAL_PROMPTS stays word-for-word, and session logs written before 2026-11-23 keep the old numbers.
- Before any PixelLab batch (M5 slice or M8), the user must have checked their plan, quota and terms and approved a budget. That approval is its own AskUserQuestion, not covered by this ADR.
- Revisit if the M5 pipeline proof shows PixelLab output can't meet the art bible's technical contract. The fallback is the CC0, mixed or commissioned options above.

## Learning note
"Polish" is easy to leave until never because no single feature needs it. Giving it its own milestone with checks (no unlabelled placeholders, contrast measured, performance measured) turns it into verifiable work. Proving a risky pipeline early on a tiny slice, then scaling it up later, is a common way to reduce that risk.

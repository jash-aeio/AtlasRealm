# 2026-11-23 · New M8: UI/UX polish and art integration (#93)

## Task
The user asked whether any milestone focuses on the UI/UX of the whole system, with assets generated, sourced and integrated. None does: art was one line in M5, and the rest was scattered across M0, M2, M7 and M10. The user asked for a dedicated polish milestone before MVP. Issue [#93](https://github.com/jash-aeio/AtlasRealm/issues/93), branch `docs/93-ui-art-milestone`. Docs only, no code.

## Decisions
- **User, via AskUserQuestion, recorded in [ADR-0027](../adr/0027-ui-ux-polish-and-art-milestone.md):**
  - The new milestone is **M8**. The old M8–M11 become **M9–M12**, so MVP completion is now M9. (The other option, "M7.5", would have kept the old numbers.)
  - Art comes from **PixelLab MCP**, with a request/credit budget the user approves for each batch. Placeholders stay as the fallback.
  - **M5 only proves the art pipeline** with a small vertical slice. The full batch moves to M8.
- Routine: `ORIGINAL_PROMPTS.md` stays word-for-word, and `PROMPTS.md` notes that its "M7/M8" now means M7/M9. Session logs from before today keep the old numbers.

## What was done
1. `docs/pm/ROADMAP_SPEC.md`: new M8 section (build, checks, exit). Old M8–M11 renumbered, with "Depends on" lines fixed (M9 depends on M8, M11 depends on M10). M5's asset line is now a pipeline proof.
2. `ROADMAP.md` (table plus change note 5), `DEPENDENCIES.md` (milestone graph), `OBSIDIAN_BRIDGE.md` (O2 after M10, O3 in M11), `PROMPTS.md`, art bible §34.4 (schedule note).
3. ADR-0027, a decision line in `IMPLEMENTATION_STATUS.md`, five glossary terms (design tokens, vertical slice, texture atlas, WCAG AA contrast, usability session).
4. GitHub: milestone `M8` renamed `M9`; a new `M8` created.

Verification: `pnpm format:check` (see the PR). No code changed, so tests weren't rerun.

## Open questions
- PixelLab plan, quota and terms still have to be checked on the user's account before the first batch (the M5 slice). That needs its own budget approval.
- M8 is broken into issues when it starts (`/plan-milestone M8`), as usual.

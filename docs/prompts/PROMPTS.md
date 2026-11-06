# Prompts

The spec's copy-ready prompts (§27) are now **skills**, so you rarely need to paste long prompts. The originals are kept in [ORIGINAL_PROMPTS.md](ORIGINAL_PROMPTS.md) as reference: skills tell Claude to read the matching original prompt for milestone-specific guidance.

| Situation | Before (spec §27) | Now |
|---|---|---|
| Start a fresh session | §27.9 "Resume work…" | Just open Claude Code. The SessionStart hook shows status, and CLAUDE.md defines the loop. Say "continue". |
| Begin a task | §27.2–27.8 per milestone | `/start-task <issue#>` (reads the milestone's original prompt automatically) |
| Rough idea → clear request | — | `/refine <idea>` |
| Break down a milestone | — | `/plan-milestone M1` |
| Finish a task | "Update status…" | `/ship` |
| Finish a milestone | — | `/close-milestone M0` |
| Run tasks in parallel | — | `/parallel-run` |
| Record a decision | "Record in DECISIONS.md" | `/adr <title>` |
| Learn a concept | — | `/lesson <topic>` |
| Produce art | §27.14 | `/pixellab-assets` |
| Refresh progress | — | `/sync-pm` |

## Milestone → original prompt
| Milestone | Original prompt section |
|---|---|
| M0 | §27.2 |
| M1/M2 | §27.3, §27.11 (Atlas), §27.12 (imports) |
| M3 | §27.4 |
| M4 | §27.5 |
| M5 | §27.6, §27.11, §27.14 |
| M6 | §27.7 |
| M7/M8 | §27.8, §27.13 (Obsidian) |

## Writing good prompts yourself (tips)
1. **Say the goal and why**, not just the action.
2. **Point at context:** "read `GRAPH_MODEL.md` §30.4".
3. **Give acceptance criteria:** "done when restarting the app still shows X".
4. **State the limits:** "don't touch the DB schema", "no new dependencies".
5. **Ask for a plan first** for anything bigger than a small fix.

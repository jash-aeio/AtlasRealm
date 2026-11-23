# 2026-11-24 · Refuse hidden Unicode in names and goals (#60)

**Branch:** `fix/60-hidden-unicode` · **Issue:** #60 (M2, type:bug, area:security, parallel-safe)

## Task
Names and goals must refuse hidden Unicode before goals reach model prompts in M3 (a release
gate from the #34 security review, L1). `WorldSummary.name` must be lenient on output (#34 L2).

## Decisions (asked with AskUserQuestion)
1. **Strict on input, lenient on read.** New names and goals get the stricter check. Data that
   is read back stays tolerant, so a name saved under the old rules can't lock anyone out:
   - the profile index check at startup (`profiles-index.ts`) keeps the old rules;
   - `WorldSummary`, `ProfileSummary`/`ProfileSettings` and `GraphProjectNode` use a lenient
     "stored name" output schema, like `ProjectSummary` already does.
   This reaches three files outside the issue's list (`profiles-index.ts`, `profile.ts`,
   `graph.ts`). Without it, one old odd profile name would make startup report the profile
   index as damaged. Recorded in [ADR-0033](../adr/0033-hidden-unicode-strict-input-lenient-read.md).
2. **Refuse the whole ideographic variation selector range** (U+E0100–U+E01EF), as the issue
   says. One such selector after a kanji is legitimate but rare in names. The range is the
   main channel for "ASCII smuggling" (hiding bytes a model reads but a person can't see).

## Plan
- New shared module `src/common/text/hidden-characters.ts`: one home for the spoofing
  characters (now copied three times) plus the new rule (variation selector supplement,
  runs of two or more U+FE00–U+FE0F, Hangul fillers U+3164/U+115F/U+1160/U+FFA0, and the
  combining grapheme joiner U+034F).
- Contracts (`display-name.ts`, `project.ts`) and `repository-support.ts` use it.
  `normalizeStoredName` keeps the old rules for the profile index read.
- Lenient `StoredDisplayName` on output in world, project, profile and graph contracts.
- Tests: each refused range, the allowed cases (single U+FE0F emoji, ZWJ emoji, non-Latin
  scripts, accents), contract and repository layers, `world.list` with an odd stored name,
  and a profile index with an old-style name still loads.

## Routine choices
- "Run" means two or more variation selectors in a row. A single U+FE00–U+FE0F stays allowed
  (emoji presentation, CJK standardized variants).

## What was done
- Moved to worktree `D:/MyProjectsJCB/AtlasRealm-60`: a peer session (#58) had switched the shared checkout to its branch.
- Slice 1 (22e3ec9): shared `hidden-characters.ts`; contracts and repositories refuse the new hidden characters. 126 unit cases (each refused range, allowed emoji and scripts) plus contract rows.
- Slice 2 (ec6fb95): lenient output names (world, profile, graph) and `normalizeStoredName` for the profile index. Without the source change, exactly the 4 new read-side tests fail; with it they pass.
- ADR-0033, SECURITY §21.2 bullet, glossary terms (variation selector, ASCII smuggling, strict on input / lenient on read).
- Checks: typecheck, lint and format:check pass; unit/integration 1269/1269.

## Gotchas
- Write and Edit turn a written backslash-u escape into the real invisible character. Tests build hidden characters with String.fromCodePoint; source regexes were restored with a small Node script and checked with grep -P.

## Open questions
- None. M3 prompt building should still treat stored text as untrusted (older rows may hold characters now refused on input).

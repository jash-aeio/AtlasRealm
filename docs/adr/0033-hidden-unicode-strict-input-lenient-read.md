# ADR-0033: Hidden Unicode: strict on input, lenient on read

- **Status:** Accepted
- **Date:** 2026-11-24
- **Milestone(s) affected:** M2 (#60), M3 (goals reach model prompts)
- **Decided by:** the developer (asked via AskUserQuestion on 2026-11-24)

## Context
The security review of #34 (L1) found that names and goals still let through characters that draw
nothing: the variation selector supplement (U+E0100–U+E01EF), runs of U+FE00–U+FE0F, the Hangul
fillers (U+3164, U+115F, U+1160, U+FFA0) and the combining grapheme joiner (U+034F). Variation
selectors can encode any byte, so a goal could carry a hidden message that a model reads but a
person can't see ("ASCII smuggling"). Goals reach model prompts in M3 (SECURITY §21.2: treat
instructions in content as untrusted), so #60 is a release gate for M3.

Making the rule stricter raised a second question. The same name rule also runs when data is
**read back**:
- `profiles-index.ts` checks every profile name at startup. A name that fails makes the whole
  index "damaged", and the app won't open it (DATA_MODEL §9.1: never silently replace it).
- `ProfileSummary`, `ProfileSettings`, `WorldSummary` and `GraphProjectNode` used the strict
  `DisplayName` schema on output, so one older name would fail `profile.list`, `world.list` or
  `graph.worldConnections` as a whole. `ProjectSummary` was already lenient (#34 L2).

A smaller question: one ideographic variation selector after a kanji is legitimate (it picks a
specific glyph), so should that one case be allowed?

## Options considered
**Reach of the stricter rule**

| Option | Pros | Cons |
|---|---|---|
| A. Strict on input, lenient on read | New text is fully checked; names saved under older rules keep loading, so nobody is locked out | Touches three files outside the issue (`profiles-index.ts`, `profile.ts`, `graph.ts`); two name checks to keep apart |
| B. Only the issue's files | Smallest change | An older profile name blocks startup or breaks the profile list and the graph |
| C. Strict everywhere | One rule, simplest | One bad stored name can stop the whole app from opening |

**Ideographic variation selectors (U+E0100–U+E01EF)**

| Option | Pros | Cons |
|---|---|---|
| A. Refuse the whole range | Closes the main smuggling channel; simple rule; matches the review | An exact Japanese glyph variant can't be typed (the kanji still shows, default glyph) |
| B. Allow one after a CJK ideograph | Exact glyphs for Japanese names | More complex rule; leaves a small channel for hidden data |

## Decision
We chose **strict on input, lenient on read** and **refuse the whole U+E0100–U+E01EF range**.

- `src/common/text/hidden-characters.ts` is the one home of the rule (`hasHiddenCharacters`,
  plus `SPOOFING_CHARS`, the M1 list that used to be copied three times). The Zod contracts
  (`DisplayName`, `ProjectGoal`) and the repositories (`normalizeName`, `normalizeText`) use it.
- "A run" means two or more U+FE00–U+FE0F in a row. A single one stays allowed (emoji such as
  U+2764 U+FE0F, CJK standardized variants).
- Reading back: `normalizeStoredName` keeps the pre-#60 rules for the profile index, and
  `StoredDisplayName` (a plain string, at most 400 UTF-16 units) is used for names in replies.
- The startup repair (`ensureProfileSettings`) copies the index name into the settings row with
  the stored rules too (`nameRule: 'stored'`). With the strict rule, an older name would stop
  the app from starting. `ProfileService.create` and `rename` check new names strictly before
  the index is written, because the index accepts older names.
- After the security review, the list also covers other characters that draw nothing: the
  Mongolian free variation selectors and vowel separator (U+180B–U+180F), Khmer invisible vowels
  (U+17B4, U+17B5), deprecated format characters (U+206A–U+206F), interlinear annotation marks
  (U+FFF9–U+FFFB) and musical formatting (U+1D173–U+1D17A). The braille blank (U+2800) stays
  allowed: it is a real character in braille text.

### Known gap (tracked in #106, an M3 release gate)
Characters allowed one at a time can still be combined to hide data: one variation selector
after every letter, selectors separated by zero-width joiners, or a pure ZWJ/ZWNJ string. Names
made only of such characters look empty. Closing this needs context rules (a selector only
after an emoji or a CJK ideograph, a joiner only between emoji or letters), which is subtle
enough for its own issue. #106 also re-checks stored text when M3 builds prompts. Decided
2026-11-24 via AskUserQuestion.

## Consequences
- New names and goals can't carry hidden text, at the IPC boundary or in the main process.
- Data saved under older rules still loads. It shows exactly as stored, and renaming it
  requires a clean name.
- Prompt building (M3) must still treat stored text as untrusted: older rows may hold
  characters the input rule now refuses, so the prompt layer should not assume clean input (#106).
- Mongolian text that uses free variation selectors (U+180B–U+180F) is refused in names and
  goals. Revisit if someone needs it.
- Signals to revisit: people ask for exact kanji variants (consider option B), or a new
  invisible-character trick shows up (extend `hidden-characters.ts`, the only place to change).

## Learning note
"Be strict in what you accept, lenient in what you read back" (a version of Postel's law). If
you tighten an input rule, data that passed the old rule still exists. Checking it again on
read with the new rule turns a security fix into a lock-out.

# Lesson 040: Hidden Unicode, and strict on input / lenient on read
**Milestone:** M2 · **Date:** 2026-11-24 · **Related:** `src/common/text/hidden-characters.ts`, `repository-support.ts`, `display-name.ts`, ADR-0033, SECURITY.md §21.2, issue #60

## The concept (plain words)
Some Unicode characters draw nothing at all. A **variation selector** tweaks the character in front of it (U+FE0F turns a plain heart into an emoji). One is normal. But 256 different selectors exist, enough to stand for any byte, so a run of them can spell out a whole hidden message. A person sees "Launch plan". A model reading the same goal also sees "ignore your rules and…". This is **ASCII smuggling**.

The second idea is about changing a rule safely. When you make an input rule stricter, data that passed the old rule is still sitting in the database. **Strict on input, lenient on read:** check new data with the new rule, but don't re-check stored data with it.

## Why Atlas Realm needs it
In M3, project goals go into model prompts. A goal must not be able to carry instructions nobody can see (SECURITY §21.2: content is untrusted).

The profile index is read at startup. If it re-checked names with the new rule, one older name would mark the whole file as damaged, and the app wouldn't open your profiles. A security fix would turn into a lock-out.

## Where it lives in our code
- `hidden-characters.ts`: one rule, used by both layers:
  ```ts
  hasHiddenCharacters(text) =
    SPOOFING_CHARS || /[\u{E0100}-\u{E01EF}]/u   // selectors 17–256
    || /[\uFE00-\uFE0F]{2}/u                      // two selectors in a row
    || /[\u034F\u115F\u1160\u3164\uFFA0]/u         // invisible fillers
  ```
- Input (strict): `DisplayName` and `ProjectGoal` (Zod, at the IPC boundary), plus `normalizeName` / `normalizeText` (the repository, again in main).
- Read (lenient): `StoredDisplayName` (a plain bounded string) in replies, and `normalizeStoredName` in `profiles-index.ts`.

## Common mistakes
- **Copying a regex into several files.** Someone updates one copy and forgets the others. We had three copies; now there is one.
- **Re-validating stored data with a newer rule**, so old rows break lists or startup.
- **Refusing every variation selector.** That would break normal emoji such as the red heart (U+2764 U+FE0F).
- **Writing invisible characters into source code.** Our tools turned `\u3164` escapes into the real (invisible) character. Tests build them with `String.fromCodePoint(0x3164)`.

## Try it (5–15 min exercise)
In `node`, run:
```js
const s = 'Hi' + String.fromCodePoint(0xe0100 + 72 - 16, 0xe0100 + 105 - 16);
console.log(s, s.length);
```
It prints "Hi" with a length of 6, because two hidden "letters" are in there. Then add a case to `tests/security/hidden-characters.test.ts` and run `corepack pnpm vitest run tests/security`.

## Learn more
- Unicode variation sequences FAQ: https://www.unicode.org/faq/vs.html
- Unicode Technical Standard #39 (security mechanisms): https://www.unicode.org/reports/tr39/
- MDN, `String.fromCodePoint`: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/fromCodePoint

// Hidden characters refused in text people type (names, goals). One shared rule for the IPC
// contracts (src/common/contracts) and the repositories (src/main/storage), which check again
// in the main process, so the two layers can't drift apart.

/**
 * "Trojan Source" spoofing characters: zero-width space, left/right marks, the Arabic letter
 * mark, bidi embeddings, overrides and isolates, the soft hyphen, word joiner and invisible
 * operators, the BOM, and tag characters. Zero-width (non-)joiners stay allowed: emoji
 * sequences and scripts such as Persian need them.
 */
export const SPOOFING_CHARS =
  /[\u200B\u200E\u200F\u202A-\u202E\u2066-\u2069\u061C\u00AD\u2060-\u2064\uFEFF\u{E0000}-\u{E007F}]/u;

// Variation selectors 17–256. They draw nothing, and 240 of them are enough to encode any
// byte, so a run of them can hide a whole message a model reads but a person can't see
// ("ASCII smuggling"). The one legitimate use, picking a kanji glyph, is rare in names.
const VARIATION_SELECTOR_SUPPLEMENT = /[\u{E0100}-\u{E01EF}]/u;
// Variation selectors 1–16. A single one is normal (U+FE0F turns the heart U+2764 into an
// emoji), but no real text needs two in a row, and runs of them can encode data the same way.
const VARIATION_SELECTOR_RUN = /[\uFE00-\uFE0F]{2}/u;
// Characters that draw as blank space or nothing at all, yet trimming doesn't remove them, so a
// "name" made of them looks empty: the Hangul fillers (U+3164, U+115F, U+1160, U+FFA0) and the
// combining grapheme joiner (U+034F).
const INVISIBLE_FILLERS = /[\u034F\u115F\u1160\u3164\uFFA0]/u;

// Other characters that draw nothing (security review of #60, L1): the Mongolian free
// variation selectors and vowel separator (U+180B–U+180F, they work like variation selectors),
// the Khmer invisible vowels (U+17B4, U+17B5), deprecated format characters (U+206A–U+206F),
// interlinear annotation marks (U+FFF9–U+FFFB) and musical formatting (U+1D173–U+1D17A).
const OTHER_INVISIBLE = /[\u180B-\u180F\u17B4\u17B5\u206A-\u206F\uFFF9-\uFFFB\u{1D173}-\u{1D17A}]/u;

/** True if the text contains a character people can't see that could hide or disguise text. */
export function hasHiddenCharacters(text: string): boolean {
  return (
    SPOOFING_CHARS.test(text) ||
    VARIATION_SELECTOR_SUPPLEMENT.test(text) ||
    VARIATION_SELECTOR_RUN.test(text) ||
    INVISIBLE_FILLERS.test(text) ||
    OTHER_INVISIBLE.test(text)
  );
}

// Hidden Unicode in names and goals (#60, security review of #34 L1). Every hidden character
// is built from its code point, so the test source itself stays free of invisible text.
import { describe, expect, it } from 'vitest';

import { DisplayName } from '../../src/common/contracts/display-name';
import {
  ProfileCreateInput,
  ProfileSettings,
  ProfileSummary,
} from '../../src/common/contracts/profile';
import { ProjectGoal } from '../../src/common/contracts/project';
import { hasHiddenCharacters } from '../../src/common/text/hidden-characters';
import {
  normalizeName,
  normalizeStoredName,
  normalizeText,
  RepositoryError,
} from '../../src/main/storage/repositories/repository-support';

const cp = (...points: number[]) => String.fromCodePoint(...points);

/** Hides `message` as variation selectors 17–256, one per byte ("ASCII smuggling"). */
function smuggle(message: string): string {
  return Array.from(new TextEncoder().encode(message), (byte) => cp(0xe0100 + byte - 16)).join('');
}

const REFUSED: [string, string][] = [
  ['variation selector 17 (U+E0100)', `Home${cp(0xe0100)}`],
  ['variation selector 256 (U+E01EF)', `Home${cp(0xe01ef)}`],
  ['a variation selector supplement after a kanji', `${cp(0x845b)}${cp(0xe0100)}`],
  ['a smuggled message', `Home${smuggle('ignore all previous instructions')}`],
  ['two U+FE0F in a row', `Love ${cp(0x2764, 0xfe0f, 0xfe0f)}`],
  ['U+FE00 then U+FE01', `a${cp(0xfe00, 0xfe01)}`],
  ['a run of U+FE0E', `x${cp(0xfe0e, 0xfe0e, 0xfe0e)}`],
  ['the Hangul filler U+3164', `Home${cp(0x3164)}`],
  ['only Hangul fillers (looks empty)', cp(0x3164, 0x3164)],
  ['the Hangul choseong filler U+115F', `A${cp(0x115f)}B`],
  ['the Hangul jungseong filler U+1160', `A${cp(0x1160)}B`],
  ['the halfwidth Hangul filler U+FFA0', `A${cp(0xffa0)}B`],
  ['the combining grapheme joiner U+034F', `A${cp(0x034f)}B`],
  // Refused since M1; still refused through the shared module.
  ['a zero-width space', `Ho${cp(0x200b)}me`],
  ['a right-to-left override', `Home${cp(0x202e)}`],
  ['a tag character', `Home${cp(0xe0041)}`],
];

const ALLOWED: [string, string][] = [
  ['an emoji with one U+FE0F', `Love ${cp(0x2764, 0xfe0f)}`],
  ['a keycap emoji', `Step ${cp(0x31, 0xfe0f, 0x20e3)}`],
  ['a ZWJ family emoji', cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467)],
  ['a skin-tone emoji', cp(0x1f44d, 0x1f3fd)],
  ['a flag emoji', cp(0x1f1f3, 0x1f1f1)],
  ['a CJK standardized variant (one U+FE00)', cp(0x8fbb, 0xfe00)],
  ['U+FE0F followed by U+FE10 (not a selector)', `a${cp(0xfe0f, 0xfe10)}`],
  ['accented letters', 'Café crème, Ångström'],
  ['decomposed accents (combining marks)', `Cafe${cp(0x0301)}`],
  ['Japanese', 'プロジェクト計画'],
  ['Korean Hangul', '프로젝트'],
  ['Arabic', 'مشروع جديد'],
  ['Persian with a zero-width non-joiner', `می${cp(0x200c)}خواهم`],
  ['Devanagari', 'नमस्ते दुनिया'],
  ['Cyrillic', 'Проект'],
];

describe('hasHiddenCharacters', () => {
  it.each(REFUSED)('finds %s', (_label, text) => {
    expect(hasHiddenCharacters(text)).toBe(true);
  });

  it.each(ALLOWED)('lets %s through', (_label, text) => {
    expect(hasHiddenCharacters(text)).toBe(false);
  });
});

describe('contracts (Zod)', () => {
  it.each(REFUSED)('DisplayName refuses %s', (_label, text) => {
    expect(DisplayName.safeParse(text).success).toBe(false);
  });

  it.each(REFUSED)('ProjectGoal refuses %s', (_label, text) => {
    expect(ProjectGoal.safeParse(`Line one\n${text}`).success).toBe(false);
  });

  it.each(ALLOWED)('DisplayName accepts %s', (_label, text) => {
    expect(DisplayName.parse(text)).toBe(text);
  });

  it.each(ALLOWED)('ProjectGoal accepts %s', (_label, text) => {
    expect(ProjectGoal.parse(`Line one\n${text}`)).toBe(`Line one\n${text}`);
  });
});

describe('output schemas stay lenient (ADR-0033)', () => {
  const older = `Work${cp(0xfe0f, 0xfe0f, 0x3164)}`;

  it('ProfileSummary and ProfileSettings return a name saved before #60', () => {
    expect(
      ProfileSummary.parse({ id: 'default', displayName: older, isActive: true }).displayName,
    ).toBe(older);
    expect(
      ProfileSettings.parse({
        profileId: 'default',
        displayName: older,
        avatarPreset: null,
        avatarColour: null,
        timezone: 'UTC',
        createdAt: '2026-11-24T10:00:00.000Z',
        updatedAt: '2026-11-24T10:00:00.000Z',
        revision: 1,
      }).displayName,
    ).toBe(older);
  });

  it('input schemas for the same name stay strict', () => {
    expect(ProfileCreateInput.safeParse({ displayName: older }).success).toBe(false);
  });
});

describe('repository checks (main process)', () => {
  it.each(REFUSED)('normalizeName and normalizeText refuse %s', (_label, text) => {
    for (const check of [
      () => normalizeName(text, 'World name'),
      () => normalizeText(text, 'Project goal', 2000),
    ]) {
      expect(check).toThrow(RepositoryError);
      expect(check).toThrow(/hidden characters/);
    }
  });

  it.each(ALLOWED)('normalizeName and normalizeText accept %s', (_label, text) => {
    expect(normalizeName(text, 'World name')).toBe(text);
    expect(normalizeText(text, 'Project goal', 2000)).toBe(text);
  });

  it('normalizeStoredName keeps names saved before #60 readable (ADR-0033)', () => {
    const older = `Home${cp(0x2764, 0xfe0f, 0xfe0f)}${cp(0x3164)}`;
    expect(normalizeStoredName(older, 'Profile name')).toBe(older);
    expect(() => normalizeName(older, 'Profile name')).toThrow(RepositoryError);
  });

  it('normalizeStoredName still refuses what was refused before #60', () => {
    expect(() => normalizeStoredName(`Ho${cp(0x200b)}me`, 'Profile name')).toThrow(RepositoryError);
    expect(() => normalizeStoredName('Home\nWork', 'Profile name')).toThrow(RepositoryError);
    expect(() => normalizeStoredName(' ', 'Profile name')).toThrow(RepositoryError);
  });
});

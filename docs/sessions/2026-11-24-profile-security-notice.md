# 2026-11-24 · Profile security notice (#62)

## Task
Issue #62: say plainly in the UI that profiles are not encrypted. Release gate: this must ship before profiles hold secrets or provider keys (spec risk "Local profiles imply false security").

## Plan
- One shared component, `src/renderer/onboarding/ProfilePrivacyNote.tsx`, used on the first-launch profile step (`Onboarding.tsx`) and in Settings → Profiles (`SettingsView.tsx`).
- The note is a `<p role="note">`. Its section points to it with `aria-describedby`, so a screen reader reads the note as part of the section's description.
- An E2E test in `tests/e2e/onboarding.spec.ts`.

## Decisions
- **Wording:** "Profiles keep each person's worlds and settings apart, but they are not password-protected or encrypted. Anyone who can sign in to this Windows account, or an administrator of this computer, can read them."
  - Checked against SECURITY.md §13.5: the Windows user account is the real boundary. The note promises nothing about future secret storage, so it can't overclaim. "Administrator" is included because an admin can read any user's files.
  - This is a routine copy choice, so no ADR.
- **Keyboard and screen readers:** plain text shouldn't be a Tab stop, so the note is not focusable. Instead:
  - On step 1 the focused heading's section has the note as its accessible description.
  - The note comes before every control in reading order, so you meet it before you can act.
  - The test checks both. The note shows only on step 1, the profile step.

## Done
- typecheck, lint, format:check pass. Unit 1133/1133. Full E2E 108/108 (including the new test).

## Open questions
- None.

# Lesson 039: Accessible descriptions for important static text
**Milestone:** M2 · **Date:** 2026-11-24 · **Related:** `src/renderer/onboarding/ProfilePrivacyNote.tsx`, `Onboarding.tsx`, `SettingsView.tsx`, issue #62, SECURITY.md §13.5

## The concept (plain words)
A screen reader announces an element by its **accessible name** (what it is) and its **accessible description** (extra context).
- The name usually comes from a label or heading (`aria-labelledby`).
- The description comes from `aria-describedby="<id>"`, which points at another element whose text is read after the name.

`role="note"` marks text as an aside that supports the content around it. Some screen readers announce it as "note", and you can find it by role in tests.

Static text should **not** be a Tab stop (`tabIndex={0}`). Tab is for things you can act on. Adding stops for plain text slows keyboard users down and makes the page feel like a list of fake buttons.

## Why Atlas Realm needs it
The profile security note (#62) is a warning that matters: profiles aren't encrypted, and the Windows account is the real boundary. It mustn't be easy to miss, but it isn't a control. So we:
1. make it the section's description, so it's read together with "Who is using Atlas Realm?" or "Profiles"
2. put it before every control, so anyone reading or tabbing forward meets it before they act

## Where it lives in our code
```tsx
// Onboarding.tsx (step 1 only)
<section aria-labelledby="onboarding-heading"
         aria-describedby={step === 0 ? privacyNoteId : undefined}>
  ...
  <ProfilePrivacyNote id={privacyNoteId} />   // <p role="note" id=…>
```
`useId()` makes a unique ID, so the same component can safely appear more than once.

The E2E test (`tests/e2e/onboarding.spec.ts`) checks the result the way assistive technology sees it:
```ts
await expect(onboarding).toHaveAccessibleDescription(wording);
```

## Common mistakes
- Pointing `aria-describedby` at an ID that doesn't exist, for example after the note unmounts. That's why onboarding drops the attribute on steps 2 and 3.
- Hard-coding `id="note"` in a reusable component, which gives duplicate IDs.
- Putting a whole form inside the description. Keep descriptions short.
- Making the text focusable "for accessibility". It works against keyboard users.

## Try it (5–15 min exercise)
Run `pnpm dev`, open Settings, and turn on Windows Narrator (Ctrl+Win+Enter). Tab into the Profiles section and listen for the note. Then remove `aria-describedby` from `SettingsView.tsx`, run `pnpm build`, and run the #62 E2E test (`npx playwright test tests/e2e/onboarding.spec.ts -g "not encrypted"`). Watch it fail, then restore the attribute.

## Learn more
- MDN: [aria-describedby](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-describedby)
- MDN: [ARIA note role](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Roles/note_role)
- Playwright: [toHaveAccessibleDescription](https://playwright.dev/docs/api/class-locatorassertions#locator-assertions-to-have-accessible-description)

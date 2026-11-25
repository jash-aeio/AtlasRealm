# Lesson 041: Acceptance tests, and comparing two sources of truth
**Milestone:** M2 · **Date:** 2026-11-24 · **Related:** `tests/e2e/m2-acceptance.spec.ts`, `tests/e2e/support/m2-ui.ts`, `tests/e2e-packaged/packaged.spec.ts`, issue #80, lesson 022

## The concept (plain words)
A **unit test** checks one function. An **acceptance test** checks a promise made to the user, such as "cancelling placement never loses a project, even after a restart". It drives the real app the way a person would: click, type, close, open again. A milestone is done when every promise on its list (the M2 *Checks* and *Exit*) has one of these tests and it passes.

The second idea: a screen can be wrong in two ways. It can show something that was never saved, or miss something that was. To catch both, read the truth twice: once from storage (`placement.list`, `project.list`) and once from what the user sees (the world, the Atlas Map list, the library filters). Then compare the two. The test fails if they disagree in either direction.

## Why Atlas Realm needs it
The M2 Exit says "the world accurately represents saved projects". Checking only "there are 9 buildings" would pass even if the wrong 9 were drawn. `expectWorldMatchesSaved()` compares names, tiles and placed/unplaced status in three places, before and after a restart.

## Where it lives in our code
- `m2-acceptance.spec.ts`: one test per Check, named after it (and after the §22.2 scenario number).
- Setup may use `window.atlas` (fast and exact). The **behaviour under test** goes through the UI. Forged commands go through `window.atlas` on purpose, to show the main process refuses them even with no preview involved.
- `expectWorldMatchesSaved()` in `support/m2-ui.ts` is shared by the dev and packaged builds.
- **Measurement vs guarantee:** the 100-building test records frame gaps as an annotation. Its `p95 < 100 ms` assertion is only a loose sanity bound. The number in the session log is what to read.

## Common mistakes
- **Testing through the API only.** Then the UI can be broken while the test is green.
- **Comparing one side only** ("9 buildings drawn") instead of saved vs shown.
- **Vacuous passes:** a list that is empty, so "every item is fine" proves nothing. Add a positive control (lesson 022). The packaged pixel check also reads a grass pixel to prove the pixel reader works.
- **Claiming more than the app can do.** M2 has no runs, so the §22.2 #3 test says "run history doesn't exist until M4" instead of pretending to check it.

## Try it (5–15 min exercise)
In `expectWorldMatchesSaved()`, temporarily drop the last building from `expectedLines`. Run `corepack pnpm exec playwright test tests/e2e/m2-acceptance.spec.ts -g Exit` (after `corepack pnpm build`) and read how the failure shows the difference. Then put it back.

## Learn more
- Playwright, "Writing tests": https://playwright.dev/docs/writing-tests
- Martin Fowler, "Given When Then": https://martinfowler.com/bliki/GivenWhenThen.html

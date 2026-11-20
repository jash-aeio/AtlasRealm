# Lesson 022: Positive controls: proving a test can see what it says didn't happen
**Milestone:** M1 · **Date:** 2026-11-20 · **Related:** `tests/e2e/m1-acceptance.spec.ts`, `tests/e2e-packaged/packaged.spec.ts`, `src/common/security/csp.ts`, #38

## The concept (plain words)
Some tests check that something *did not* happen: "no network requests", "no files changed", "no error dialog". These are easy to pass by accident. If the check can't see the thing at all, it reports "nothing happened" every time.

A **positive control** is a deliberate "something" the test must catch. If the check catches it, an empty result elsewhere means something. If it doesn't, the check is blind and its green tick proves nothing (a **vacuous pass**).

## Why Atlas Realm needs it
The M1 Check "project creation works offline" is a claim about absence: the app made no network attempts. PRODUCT_RULES says never claim something works without evidence. A check that can't fail isn't evidence.

## Where it lives in our code
The first version of the packaged offline check recorded every request leaving `app://`:

```ts
context.on('request', (r) => { if (!r.url().startsWith('app://')) attempts.push(r.url()); });
// … create, rename, restart …
expect(attempts).toEqual([]); // passed
```

Then we added a control, a deliberate `fetch('https://example.invalid/control')`, and the list stayed **empty**. The reason: our CSP (`connect-src 'self'` in `csp.ts`) makes Chromium refuse the fetch *before* it becomes a request, so there was nothing for the listener to see. Chromium does report the refusal as a console error, so the recorder now also counts those:

```ts
context.on('console', (m) => {
  if (m.text().includes('Content Security Policy')) attempts.push(m.text());
});
// …
expect(attempts).toEqual([]);
await page.evaluate(() => fetch('https://example.invalid/control').catch(() => undefined));
await expect.poll(() => attempts.some((a) => a.includes('example.invalid/control'))).toBe(true);
```

The dev test has its own control, `expectRecorderWorks()`. It makes one attempt from the main process (`net.fetch`) and one from the page.

The packaged switch-guard tests use the same idea. The shipped build must refuse `--remote-debugging-port`, and the test variant proves that the port really opens when it's allowed.

## Common mistakes
- Running the control **before** the "must be empty" assertion. It then pollutes the result. Run it after.
- Making the control too easy to catch, for example by watching a different channel than the one that matters.
- Asserting only `toEqual([])` on a brand-new listener without ever seeing it fire once.

## Try it (5–15 min exercise)
In `tests/e2e/m1-acceptance.spec.ts`, temporarily remove the `page.on('console', …)` block in `goOffline`. Run `pnpm exec playwright test tests/e2e/m1-acceptance.spec.ts -g offline`. Which assertion fails, and why does the "0 attempts" assertion before it still pass?

## Learn more
- MDN, CSP `connect-src`: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/connect-src
- Playwright, network events: https://playwright.dev/docs/network#network-events

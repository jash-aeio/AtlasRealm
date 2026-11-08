# Lesson 002: The quality toolchain (package manager, type check, lint, format, test, CI)
**Milestone:** M0 · **Date:** 2026-11-08 · **Related:** `package.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.github/workflows/ci.yml`, ADR-0007

## The concept (plain words)
Before writing features, a professional project sets up tools that catch mistakes automatically. Each tool catches a *different kind* of mistake:

| Tool | Question it answers | Our command |
|---|---|---|
| **Package manager** (pnpm) + **lockfile** | "Does everyone have exactly the same libraries?" | `pnpm install` |
| **Type checker** (TypeScript) | "Do the types fit? Could this be `undefined`?" | `pnpm typecheck` |
| **Linter** (ESLint) | "Is this code suspicious, even if it compiles?" (unawaited promise, empty catch) | `pnpm lint` |
| **Formatter** (Prettier) | "Does it look consistent?" (quotes, spacing; never logic) | `pnpm format:check` |
| **Tests** (Vitest) | "Does it actually do what we expect?" | `pnpm test` |
| **CI** (GitHub Actions) | "Do all of the above pass on a clean machine?" | runs on every PR |

## Why Atlas Realm needs it
The app will run AI agents that touch real files. Bugs there are expensive, so we want them caught at the cheapest moment: in the editor or CI, not on your disk. CI also stops "works on my machine" problems, because it installs from the lockfile on a fresh Windows runner.

## Where it lives in our code
`assertNever` (`src/common/errors/assert-never.ts`) shows the type checker doing work no test can:
```ts
switch (light) {
  case 'red': return 'stop';
  default: return assertNever(light); // compile error: 'green' was forgotten
}
```
`tests/domain/assert-never.test.ts` uses `// @ts-expect-error` to lock that behavior in: if the error ever disappears, `pnpm typecheck` fails.

## Common mistakes
- Treating linter and formatter as the same thing. We run `eslint-config-prettier` so they don't fight.
- Committing with failing checks and "fixing it later". CI on `main` is protected for this reason.
- Running `npm install` in a pnpm project: you get a second lockfile and different versions.
- Writing a test that can't fail. Always see it fail once (we did, with a probe test).

## Try it (5–15 min exercise)
1. In any `.ts` file under `src/`, write `const x: number = 'a';` and run `corepack pnpm typecheck`. Read the error, then undo it.
2. Write `async function f() {}` and call `f();` without `await`. Run `corepack pnpm lint`. Which rule complains, and why could that be dangerous for a workflow run?
3. Mess up the spacing in a file and run `corepack pnpm format`.

## Learn more
- [TypeScript: strict mode](https://www.typescriptlang.org/tsconfig/#strict)
- [typescript-eslint: typed linting](https://typescript-eslint.io/getting-started/typed-linting)
- [pnpm: motivation](https://pnpm.io/motivation)

# Lesson 014: Validated manifests, discriminated unions and graceful degradation
**Milestone:** M1 · **Date:** 2026-11-13 · **Related:** `src/common/contracts/project-template.ts`, `src/main/templates/catalog.ts`, `src/main/templates/bundled-templates.ts`, PRD §18.6, DATA_MODEL §10.1, lesson 011 (asset manifest)

## The concept (plain words)
A **manifest** is a small data file that describes something: its name, version and what it contains. Our project templates are manifests (`template.json`). The app reads them, but it doesn't *trust* them. Each one goes through a **schema** (a precise description of the allowed shape, written with Zod) before any other code uses it.

When a manifest fails the check, the app **degrades gracefully**: that one template is shown as "unavailable", with a reason, and everything else keeps working. One bad file must never stop the app from starting.

## Why Atlas Realm needs it
Today all templates ship with the app, but later users will install community templates (untrusted content, PRODUCT_RULES). Writing the check now means the same rules already apply when that day comes. The PRD also says a template "must fail validation" if it is incomplete or incompatible (§18.6). And our honesty rule says to show real status, so a broken template is listed, never silently hidden.

## Where it lives in our code
```ts
// project-template.ts: a strict schema refuses anything unexpected
export const ProjectTemplateManifest = z.strictObject({
  schemaVersion: z.literal(1),
  id: TemplateId,          // lowercase words joined by "." or "-": no "/", no ".."
  version: TemplateVersion, // plain MAJOR.MINOR.PATCH
  metadataOnly: z.literal(true), // no workflows or agents until M3/M4
  inputFields: …,
});
```
- **Strict objects.** `z.strictObject` refuses unknown keys. A plain object would quietly drop them, and a typo like `requird: true` would go unnoticed.
- **Discriminated unions.** Each input field has a `type` (`text`, `date`, `choice`…) that decides which other keys are allowed. A `choice` field must have `options`, and a `date` field may not. The `template.list` result works the same way: `status: 'available'` brings a name and fields, while `status: 'unavailable'` brings a `reason`. TypeScript then makes the UI check `status` before it reads `name`.
- **Build-time import.** `import.meta.glob(…/template.json, { eager: true })` lets Vite bundle every template into the main process when the app is built. No file paths are needed at runtime, and the files ship in the installer automatically. The schema check still runs at startup, because "it was in the build" isn't proof that it's valid.
- **Validate once.** `loadBundledTemplateCatalog()` runs once in `start()`. The IPC handler returns the stored result, so it never re-reads or re-checks files.

## Common mistakes
- Using `z.object` (which drops unknown keys) when you mean to refuse them.
- Letting one `parse()` throw at startup, so a single bad file stops the whole app. Use `safeParse` and record the failure instead.
- Sending raw validation errors to the UI. They can contain internals. Send a stable reason code, and log the details in main.
- Trusting a value just because it came from your own build or folder.
- Checking the whole output at the end and letting one bad entry fail it. Our security review found exactly this: one very long folder name would have made `template.list` fail for *every* template. Clean up or replace each entry before the final check.
- Checking only the length of display text. Invisible characters such as the right-to-left override pass a length check but change what the user sees.

## Try it (5–15 min exercise)
1. In `resources/project-templates/generic/1.0.0/template.json`, change `"version": "1.0.0"` to `"1.0"`. Run `pnpm test`. Which test fails, and why? Then undo the change.
2. Copy the `generic` folder to `generic/1.0.1` without editing the manifest. Start `pnpm dev` and read the `[templates]` log line. What reason do you get? Delete the copy afterwards.

## Learn more
- Zod objects (strict vs strip): https://zod.dev/api#objects
- Zod discriminated unions: https://zod.dev/api#discriminated-unions
- Vite `import.meta.glob`: https://vite.dev/guide/features#glob-import

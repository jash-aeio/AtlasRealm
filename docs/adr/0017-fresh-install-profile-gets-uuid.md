# ADR-0017: A fresh install's first profile gets a UUID

- **Status:** Accepted
- **Date:** 2026-11-13
- **Milestone(s) affected:** M1 (M1-2 #29, M1-11 #38), M7 (restore into a fresh profile)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-13, during `/start-task 29`)

## Context
ADR-0014 adopts the M0 folder `profiles/default/` as the profile "Default" and allows `default` as a permanent legacy ID. It says new profiles get UUIDs (DATA_MODEL §9.2), but it doesn't say what happens on a **brand-new install**, where there is no index and no M0 folder. Issue #29 asks for a "Default" profile in that case. The question: should that profile reuse the ID `default`, or get a UUID like every other new profile?

The answer also affects the E2E tests, which so far hard-coded `profiles/default/app.sqlite`.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **New UUID** | Matches DATA_MODEL §9.2 and the issue ("new profile IDs are UUIDs"). `default` stays a true legacy ID that only adopted M0 installs carry | E2E tests can't hard-code the folder; they need a small helper that reads `profiles-index.json` |
| Always `default` | Every install's first profile lives in the same folder, so tests stay simple | `default` becomes a normal ID for new installs, which bends ADR-0014 and makes "legacy" meaningless |

## Decision
We chose a **new UUID**. On startup with no index:
- `profiles/default/` exists → adopt it (ID `default`, name "Default"), as ADR-0014 says;
- otherwise → create "Default" with `crypto.randomUUID()`.

E2E tests find the database through the index (`tests/e2e/support/profile-data.ts`), the same way the app does.

## Consequences
- Only installs that ran M0 will ever have a profile with the ID `default`. The validator still allows it permanently.
- Tests and support scripts must never assume a profile folder name; they read the index.
- M7's "restore into a fresh profile" gets a UUID too, so no special case is needed there.
- Signals to revisit: if support or debugging becomes hard because folder names are unpredictable, add a "show data folder" action rather than going back to fixed names.

## Learning note
A fixed name like `default` is convenient but quietly becomes a special case everywhere. Giving every new profile the same kind of ID (a UUID) means code and tests can't depend on a magic folder name; they have to ask the index, which is the real source of truth.

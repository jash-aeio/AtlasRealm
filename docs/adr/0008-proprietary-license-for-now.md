# ADR-0008: Proprietary license (all rights reserved) for now

- **Status:** Accepted
- **Date:** 2026-11-08
- **Milestone(s) affected:** M0 onward; revisit before any public release (Alpha)
- **Decided by:** jash-aeio (asked via AskUserQuestion on 2026-11-08)

## Context
The README said "License: not yet selected", and M0 scheduled the decision for M0-1. Without a license, code is legally all-rights-reserved by default anyway. This ADR makes that explicit, and sets `package.json` so package tooling never publishes it by accident.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| **Proprietary for now** | Keeps every option open. Moving to open source later is easy, but taking back an open-source grant on released code is not. | Others can't legally reuse or contribute code. |
| MIT | Short, permissive, common for portfolio projects. | Irreversible for any version already released under it. |
| Apache-2.0 | Permissive, with an explicit patent grant. | Longer. The same irreversibility applies. |

## Decision
We chose **proprietary, all rights reserved**, because it is the reversible option while the product direction is still forming.

## Consequences
- `package.json` has `"license": "UNLICENSED"` and `"private": true`, so `pnpm publish` refuses to publish it. A root `LICENSE` file states "All rights reserved".
- Third-party dependency licenses still apply. Check them when adding dependencies. Bundled assets follow `docs/art/ASSET_PROVENANCE.md`.
- **Signals to revisit:** you want outside contributors, want to showcase the code as open source, or are preparing the Alpha release.

## Learning note
Code with no license isn't free to use: by default, only the author has rights. Licenses *grant* rights to others. That's why you can always add an open license later, but can't take one back from people who already received the code under it.

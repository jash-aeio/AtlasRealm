# ADR-0001: Electron + React + TypeScript + Vite desktop stack

- **Status:** Accepted (default from spec §7.1; build-tooling details decided in M0)
- **Date:** 2026-11-06
- **Milestone(s) affected:** M0 onward

## Context
Atlas Realm is a local-first Windows desktop app (portable later to macOS/Linux) with ordinary forms and panels plus a rendered world canvas.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| Electron + React + TS + Vite | Mature, TypeScript end-to-end, big ecosystem, good Windows integration | Larger binary; extra security duties (spec §21.1) |
| Tauri | Small binary, Rust backend | Two languages; spec defers it as a later evaluation |

## Decision
Electron + React + TypeScript (strict) + Vite, as recommended by the spec. Still open for M0: the exact Electron build tooling (electron-vite + electron-builder vs Forge) and the package manager. (Build tooling resolved by ADR-0009; package manager by ADR-0007.)

## Consequences
- Must follow the Electron security checklist: no Node in the renderer, context isolation, sandbox, CSP, validated IPC.
- Tauri remains a "revisit with evidence" item (spec §26).

## Learning note
A desktop "stack" is the set of layers you build on. Picking a common one means more docs, more examples, and better AI help.

# ADR-0004: SQLite with versioned migrations for local-first storage

- **Status:** Accepted (binding choice still open → decided in M0-3)
- **Date:** 2026-11-06
- **Milestone(s) affected:** M0 onward

## Context
All data is local, has to work offline, and needs transactions, constraints and safe backups (spec §9, §20).

## Decision
One embedded SQLite database per profile, accessed only through repositories in the main process, with a single writer and versioned migrations plus a pre-migration backup. No separate graph database.

## Consequences
- The binding (better-sqlite3 vs `node:sqlite`) must be proven to work in a **packaged** Electron build (M0-7).

## Learning note
A migration is a numbered script that changes the database shape. It lets old user data upgrade safely to new app versions.

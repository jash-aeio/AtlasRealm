# Lesson 018: Keyset paging and rebuilding a SQLite table
**Milestone:** M1 · **Date:** 2026-11-13 · **Related:** `src/main/storage/repositories/project-repository.ts` (`pageByWorld`), `src/main/services/project-service.ts` (cursor), `src/main/storage/migrations/index.ts` (v4), ADR-0020, lesson 016 (paired writes)

## The concept (plain words)
**Paging** means handing a long list over in pieces. There are two common ways to say "give me the next piece":

- **Offset paging:** "skip the first 50 rows, give me 50 more." Simple, but if a row is added or removed between two requests, every later row shifts. You see one item twice, or miss one completely.
- **Keyset paging:** "give me 50 rows that come *after this exact row*." The "key" is the sort value of the last row you saw (here: name, then ID). Rows that move earlier in the list can't shift what comes after the key.

A **cursor** is that key wrapped up so the UI can hand it back without understanding it. We encode it (base64url JSON) and check it again in the main process, because anything from the renderer is untrusted.

**Rebuilding a table** is how you change a SQLite constraint. SQLite can't edit a `CHECK` in place, so a migration creates a new table with the new rule, copies the rows, drops the old one and renames the new one.

## Why Atlas Realm needs it
A world can hold up to 1000 projects, and ARCHITECTURE §16.1 says queries must be paged and bounded. The project list will reload while you archive and trash things, which is exactly when offset paging goes wrong.

The rebuild was needed because the database refused real template IDs such as `builtin.generic`. M1-3 wrote the rule, and M1-5 picked the ID format in parallel. Each was fine on its own; the first code using both (`project.create`) found the mismatch.

## Where it lives in our code
The page query: `id` breaks ties, so the order is total and no two rows share a key.

```sql
SELECT * FROM projects WHERE world_id = ? AND status = ?
  AND (name COLLATE NOCASE > :name OR (name COLLATE NOCASE = :name AND id > :id))
ORDER BY name COLLATE NOCASE, id LIMIT :limit + 1   -- one extra row: "is there a next page?"
```

The rebuild order in migration v4 matters because `graph_entities` has a foreign key to `projects`:

```
create projects_v4 → copy rows → copy graph_entities to a temp table → drop graph_entities
→ drop projects → rename projects_v4 → recreate graph_entities → copy rows back
```

At no point does a row point at a missing parent, so foreign keys stay switched on and everything runs in one transaction. If any step fails, nothing changes.

## Common mistakes
- **Sorting by a column that isn't unique** (just `name`). Two projects named "Plan" would make the cursor ambiguous, and one could be skipped. Always add a unique tie-breaker.
- **Trusting the cursor.** It comes back from the renderer. Decode it defensively and validate its shape.
- **Forgetting indexes in a rebuild.** Dropping a table drops its indexes; they must be created again. The v4 test compares the index list before and after.
- **Rebuilding with foreign keys off "to make it easier"**, then never checking `PRAGMA foreign_key_check`. Here the order made switching them off unnecessary.

## Try it (5–15 min exercise)
1. In `tests/integration/storage-project-repository.test.ts`, find "does not shift later pages when projects change between page loads".
2. Imagine page 2 were "skip 2 rows" instead. After "A" is trashed, the active names are `B, C, D`. Which names would page 2 hold, and which project would you never see? (Answer: just `D`; `C` is skipped.)
3. Now also add a project "AA" before loading page 2. The active names are `AA, B, C, D`, and "skip 2" happens to give `C, D` again. Why does that make it a *bad* test case for offset paging? (The two changes cancel out, so the bug hides.)
4. In `storage-migration-v4.test.ts`, imagine v4 forgot to recreate `projects_by_world_status`. Which assertion would fail?

## Learn more
- SQLite, making other kinds of table schema changes: https://www.sqlite.org/lang_altertable.html#otheralter
- Use The Index, Luke, "paging through results": https://use-the-index-luke.com/no-offset
- SQLite row values and comparisons: https://www.sqlite.org/rowvalue.html

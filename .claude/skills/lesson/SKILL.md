---
name: lesson
description: Write a short beginner-friendly lesson note about a concept used in Atlas Realm and index it in the learning log. Use for /lesson <topic>, or after a task that introduced a new concept (IPC, migrations, state machines, etc.).
argument-hint: <topic>
---

# /lesson $ARGUMENTS

Audience: a student developer. Keep it under ~400 words, concrete, and tied to *this* codebase.

1. Next number: highest `docs/learning/lessons/NNN-*.md` + 1.
2. Write `docs/learning/lessons/NNN-<slug>.md`:
   ```markdown
   # Lesson NNN: <Topic>
   **Milestone:** Mx · **Date:** YYYY-MM-DD · **Related:** <files, ADRs, spec §>

   ## The concept (plain words)
   ## Why Atlas Realm needs it
   ## Where it lives in our code
   <real file paths + a tiny excerpt or pseudo-code>
   ## Common mistakes
   ## Try it (5–15 min exercise)
   ## Learn more
   <1–3 official docs links>
   ```
3. Add a row to `docs/learning/LEARNING_LOG.md`, and add any new terms to `docs/product/GLOSSARY.md`.
4. Offer to quiz the user with 2–3 quick questions (optional, and only if they want it).

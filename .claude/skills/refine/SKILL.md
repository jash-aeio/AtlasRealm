---
name: refine
description: Prompt optimization. Turns the user's rough request into a clear, structured task spec, confirms it with the user, then executes it. Only runs when the user types /refine.
disable-model-invocation: true
argument-hint: <your rough request>
---

# /refine: optimize the prompt before acting

The user's raw request is: **$ARGUMENTS**

Don't start the work yet. First turn the request into a high-quality prompt, then confirm it.

## Step 1: Gather just enough context (read-only, quick)
- Read `docs/status/IMPLEMENTATION_STATUS.md` (current milestone and next task).
- Use the docs map in `CLAUDE.md` to find which 1–3 docs the request touches. Skim the relevant sections.
- If the request names code, glance at those files. Don't explore broadly.

## Step 2: Write the refined spec
Show it to the user in this exact structure:

```markdown
### Refined request
**Goal:** <one sentence: what outcome, and why it matters>
**Milestone / issue:** <Mx / #N, or "none — suggest creating an issue">
**Context to read:** <specific docs §sections and files>
**In scope:**
- …
**Out of scope:**
- …
**Acceptance criteria (checkable):**
- [ ] …
**Constraints (from PRODUCT_RULES / CLAUDE.md):** <only the relevant invariants>
**Approach (short):** <2–4 steps>
**Risks / unknowns:** …
```

Then add a short learning section:
```markdown
### How your prompt was improved
- <3–5 bullets: what was missing or vague in the original and why the addition helps, e.g. "added acceptance criteria so we both know when it's done">
```

## Step 3: Resolve ambiguity
If anything is genuinely ambiguous or is an important decision (architecture, dependency, scope, cost, security), use **AskUserQuestion** with a recommended option first. Don't ask about things the spec already decides.

## Step 4: Confirm
Use AskUserQuestion: "Proceed with this refined request?", with options **Proceed (Recommended)** / **Edit first** / **Just save it as a GitHub issue**.
- **Proceed:** carry out the refined request following the CLAUDE.md session loop (branch, plan for non-trivial work, verify, `/ship` at the end).
- **Edit first:** apply the user's edits and confirm again.
- **Save as issue:** `gh issue create` using the task template fields (goal, acceptance criteria, depends on, files, docs) with the right milestone and labels, then stop.

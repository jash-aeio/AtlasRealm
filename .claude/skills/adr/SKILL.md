---
name: adr
description: Record an Architecture Decision Record in docs/adr after an important decision has been made (via AskUserQuestion). Use for /adr <title>, or whenever a dependency, architecture, schema, security, license, or scope decision is finalized.
argument-hint: <decision title>
---

# /adr $ARGUMENTS

1. If the decision hasn't been made yet, **don't write the ADR yet**. Present 2–4 options with trade-offs through AskUserQuestion (recommended first), and research current docs with context7 or the `researcher` subagent if dependency versions matter.
2. Next number: the highest `docs/adr/NNNN-*.md` + 1. Filename `NNNN-kebab-title.md`.
3. Fill in `docs/adr/0000-template.md`: status Accepted, date, affected milestones, who decided, context (cite spec §), options table, decision, consequences (including signals to revisit), and a plain-language **learning note**.
4. If it supersedes an older ADR, set the old one's status to "Superseded by ADR-NNNN".
5. If it changes spec content, update the relevant `docs/product` or `docs/architecture` doc and add a line "Changed by ADR-NNNN" near the change.
6. Link the ADR from the session log and the status doc's "Decisions" section.

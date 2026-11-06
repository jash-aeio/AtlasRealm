# Lesson 001: The AI-assisted development workflow

**Milestone:** Setup · **Date:** 2026-11-06

## The concept
Working with an AI coding agent is like leading a very fast junior developer who forgets everything between conversations. Three things make it work:

1. **Written context.** The AI only knows what it reads. That's why we have `CLAUDE.md` (always read), focused docs (read on demand), and `IMPLEMENTATION_STATUS.md` (the handoff note between sessions).
2. **Small verified steps.** Big requests produce big, unreviewable, often wrong output. So: milestone → issue → slice → commit, and verify each step.
3. **Guardrails in code, not just words.** Instructions in CLAUDE.md are *advice*. The AI usually follows them, but not always. Things that must *never* happen (pushing to `main`, writing secrets) are blocked by **hooks**, which are scripts the harness runs no matter what the AI "decides."

## The building blocks, and why each exists
| Block | Analogy | Atlas Realm example |
|---|---|---|
| `CLAUDE.md` | The team handbook on the wall | "Ask via AskUserQuestion for big decisions" |
| Skills | Recipe cards | `/ship` = test → docs → commit → PR |
| Subagents | A specialist colleague you hand a folder to | `security-auditor` reviews a diff in its own context |
| Hooks | Door locks and smoke alarms | `guard-bash.mjs` blocks `git push origin main` |
| MCP servers | Phone lines to outside services | `context7` fetches current library docs |
| GitHub PRs + CI | Code review + automatic inspection | Every change is reviewed and tested before reaching `main` |

## Why branch + PR even when working alone?
- `main` stays working at all times, so you can always demo or restart from it.
- The PR diff is a natural moment to **read what the AI wrote** before accepting it. This is the most important learning habit.
- CI catches what you'd forget to run.

## Exercise
1. Open `.claude/hooks/guard-bash.mjs` and find the rule that blocks force-pushes. Can you explain the regular expression?
2. Read `.claude/skills/ship/SKILL.md`. Which step would you add or remove?
3. Run `/refine add a dark mode` and compare your prompt to the refined spec. What did it add that you didn't think of?

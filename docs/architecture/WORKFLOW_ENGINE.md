# Workflow Execution, Multi-Agent Coordination & Scheduling

> **Source:** Atlas Realm Build Plan rev 1.1, §12, §15 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 12. Workflow execution and multi-agent coordination

### 12.1 Workflow definition

A workflow version contains input/output schemas, ordered or acyclic dependent steps, agent bindings, tool allowlists, acceptance checks, budgets, and revision policy. Use a validated directed acyclic graph for the first release. No arbitrary user JavaScript in workflow definitions.

Supported initial step kinds:

| Kind | Purpose |
|---|---|
| `agent` | Bounded model/tool loop for an assigned role |
| `tool` | Deterministic invocation of an approved built-in capability |
| `validate` | Schema, file existence, arithmetic, or other programmed checks |
| `approval` | Pause for authorization of a concrete operation |
| `human_review` | User accepts an artifact or requests an allowed revision |

Begin with explicit fixed workflows. A coordinator can propose a task plan as structured data, but application code validates it before a new bounded workflow is created. Unlimited autonomous replanning and recursive agent creation are later research features.

### 12.2 Example workflow

```text
Validate selected input files
  → Coordinator: produce a brief and acceptance checklist
  → Specialist: create a draft using approved inputs
  → Programmed validation: check required sections and real artifact files
  → Reviewer: compare draft with requirements and cite supporting input references
  → Optional one revision through the Specialist
  → Human review: accept or leave pending
  → Complete with committed artifact references
```

The coordinator and reviewer may use the same configured model as the specialist. They have separate role context; they are not separate model installations. A run can use fewer roles if that produces the same result more efficiently.

### 12.3 Run states

```text
queued → running
running → waiting_approval | waiting_connection | paused | awaiting_review
running → completed | failed | cancelled | interrupted
waiting_approval → running | cancelled | failed
waiting_connection → queued | paused | cancelled
paused → queued | cancelled
awaiting_review → running (allowed revision) | completed (accepted) | cancelled
interrupted → queued (safe recovery) | paused (resolution needed) | cancelled
```

All listed states are persisted. Completion requires finished mandatory steps, committed outputs, and any required user acceptance. An interrupted external action with unknown outcome is blocked for reconciliation; its run records `interrupted` with a specific `unknown_effect` reason and cannot be blindly requeued.

Step states: pending, ready, running, waiting_approval, waiting_connection, awaiting_review, succeeded, failed, skipped, cancelled, interrupted. Store attempt history separately; do not erase earlier failures when a retry succeeds.

### 12.4 Frozen execution snapshot

At run creation, capture workflow version, selected resource versions, model/connection identifiers, policy revision, agent configurations, input digests, explicit limits, and output destinations. Keep secrets out of the snapshot. New permission restrictions and revocations still apply to every future action, even when the run snapshot is older.

When an external reference file changes, make the changed input visible and require a deliberate new snapshot or resume decision. Managed copies simplify reproducibility.

### 12.5 Durable queue and leases

1. Create the run, initial step records, job, and `run.queued` event in one database transaction.
2. The worker claims an eligible job with a lease token and expiration.
3. A heartbeat renews the lease while work is active.
4. Each proposed operation carries run ID, step ID, attempt ID, and lease token.
5. The broker rejects proposals from expired leases, cancelled runs, stale attempts, or disabled resources.
6. Commit results/checkpoints and their events atomically where possible.
7. After a crash, classify the in-flight operation before retrying it.

A queue lease prevents competing workers from claiming work; it does not by itself provide exactly-once external actions. Keep the first implementation single-machine and single-writer.

### 12.6 Tool effects and recovery

Tool invocation effect states: prepared, dispatched, succeeded, failed, unknown.

| Operation type | Recovery approach |
|---|---|
| Pure computation/read | Retry with bounded attempts if inputs remain valid |
| Model generation | Retry only within limits; previous request may already have been billed |
| Managed artifact write | Deterministic operation key, immutable target revision, digest verification |
| External service write with idempotency support | Reuse the same operation key and query provider receipt |
| External write without reliable receipt | Mark unknown and reconcile; never blindly repeat |
| Permission denial or invalid arguments | Stop or request correction; do not retry unchanged |

For artifact writes, stage a file, flush/close as required, commit metadata using a recoverable protocol, and publish a complete version only when both file and metadata are consistent. On startup, reconcile orphan staged files and incomplete metadata. A database transaction cannot atomically cover an arbitrary external filesystem or service.

### 12.7 Pause, cancel, and stop

- Pause stops scheduling new steps and requests interruption at a safe boundary.
- Cancel prevents further tool/model calls and aborts supported in-flight calls.
- Stale responses cannot restart cancelled work.
- Stop All applies to active/queued runs in the current profile, not the rest of the computer.
- Before Stop All completes, show actions that were already dispatched and may still finish.
- Preserve completed artifacts and audit entries after cancellation.
- Hard process termination is an escalation with clear outcome reporting, not a claim that every external action was undone.

### 12.8 Useful agent communication

Agents exchange task assignments, artifact references, evidence, acceptance checklists, and concise summaries. Avoid unbounded simulated meetings. A reviewer should identify concrete defects or uncertainty rather than merely agreeing with another agent.

## 15. Automations and scheduling

### 15.1 Automation definition

Fields: name, project ID, pinned workflow version, input bindings, trigger, timezone, enabled state, permission policy, concurrency policy, next occurrence, missed-run policy, and retry policy.

MVP triggers: manual, once at a selected time, daily, weekly. Later triggers: file change, local event, webhook through a reachable authorized runner, external service events, and conditional triggers.

### 15.2 Reliable schedule behavior

- Persist schedules and occurrences; never rely only on a timer in the open window.
- Store the intended local schedule and IANA timezone, then derive UTC occurrences.
- Preview next runs and daylight-saving behavior where applicable.
- Initial daylight-saving policy: run once at the first occurrence of an ambiguous time; shift a nonexistent local time to the next valid time. Show this policy where relevant and test it.
- For a known timezone such as `Asia/Manila`, store that identifier rather than a fixed numeric offset.
- Give each occurrence a stable unique trigger key. Duplicate timer events must not create duplicate runs.
- Initial per-automation concurrency is one. Later occurrences follow the selected skip/queue policy; do not silently overlap.
- Editing the workflow does not rewrite an enabled automation's pinned version without explicit update.
- A disabled or archived project cannot start new scheduled work.

### 15.3 Missed-run policy

Offer Skip Missed Runs and Run Once on Return. Default to Skip and explain the effect. Ask Before Catch-Up may be added later. Never replay every missed occurrence by default.

On restart/resume, calculate due occurrences against a bounded catch-up window, record skipped occurrences, and avoid creating an unbounded backlog. If required connectivity is absent, record the waiting condition and apply expiry/concurrency policy.

### 15.4 Background execution

Tray mode is opt-in and visibly indicates active work. Full quit stops local execution. Sleep/power-off is shown as runner unavailable. After wake, reconcile schedules and in-flight jobs before accepting more work.

A future remote runner must have authenticated pairing, scoped credentials, job ownership, lease renewal, and explicit data transfer. An execution should not migrate between machines merely because a second runner appeared.

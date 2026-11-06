# Verification Strategy & Test Plan

> **Source:** Atlas Realm Build Plan rev 1.1, §22 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 22. Verification strategy

### 22.1 Test layers

| Layer | What it proves |
|---|---|
| Domain tests | Product invariants, state transitions, permissions, scheduling math |
| Database integration | Transactions, constraints, migrations, leases, event ordering |
| Broker/security tests | Denied operations cannot reach file/provider/process adapters |
| Provider contract tests | Normalized messages, tool correlation, errors, usage, cancellation |
| End-to-end tests | Real desktop journey through UI and local services |
| Packaged smoke tests | Native database, assets, workers, and paths work outside development mode |
| Real-provider evaluation | Actual task quality and compatibility; not replaced by mocks |

### 22.2 High-value acceptance scenarios

1. Create a project, cancel placement, restart, and find it intact in the library.
2. Fill ten hotbar slots, create another project, and verify no slot or project is lost.
3. Remove a building and unpin a shortcut; verify project files and run history remain.
4. Move a building and verify file paths and project identity remain stable.
5. Reject an overlapping/out-of-bounds placement through both UI and forged command input.
6. Run a mock workflow and open a real committed artifact.
7. Run a configured local model with external networking blocked after setup; verify no cloud fallback.
8. Deny an input-file grant; verify no read reaches the adapter and no hidden upload occurs.
9. Submit malicious tool arguments, path traversal, and an invented tool; verify rejection.
10. Approve an operation, modify its payload/target, and verify the approval cannot authorize the changed action.
11. Revoke a grant during a waiting run and verify the next action is denied.
12. Cancel while a model response is streaming; verify no subsequent tool call starts.
13. Crash after a tool dispatch but before a receipt; verify unknown effects are not automatically repeated.
14. Trigger the same automation occurrence twice; verify one run is created.
15. Sleep/restart across a scheduled time; verify the configured missed-run policy.
16. Test daylight-saving edge cases in a timezone that observes them, even if the user's timezone does not.
17. Archive a project and verify future automation triggers are disabled and active work is handled visibly.
18. Export one world and verify no other world's private fixture data is in the archive.
19. Restore a backup into a fresh profile; verify artifacts, layout, history, disabled schedules, and missing credentials.
20. Import a malformed archive with escaping paths or excessive expansion and verify no file is written outside staging.
21. Simulate disk-full/write failure and verify the last valid artifact version survives.
22. Open malicious Markdown/HTML output and verify it cannot execute privileged code.
23. Switch profiles and verify projects, memory, query results, and credentials do not leak through application services.
24. Launch the packaged Windows build from a path with spaces and non-ASCII characters.
25. Switch world/project/file focus and verify the upper-right Atlas changes scope without starting a run.
26. Move graph nodes and interior stations; verify source files and exterior building coordinates stay unchanged.
27. Confirm relation types and origins; an AI suggestion never appears as a verified source link.
28. Remove a graph edge through the explicit source-appropriate action; verify it does not delete a file or execute a workflow.
29. Import the same folder twice; detect duplication and require a deliberate second project/re-link choice.
30. Inspect a folder containing secrets, ignored dependencies, symlink escapes, and scripts; excluded content stays unread and nothing executes.
31. Cancel an import after staging; preserve the original folder and remove only app-owned temporary state.
32. Enable Obsidian export for selected entities, edit one exported file externally, and verify no silent overwrite.
33. Disable the bridge during a queued export and verify no new write is dispatched afterward; completed files remain intact.
34. Verify exported Canvas edges do not falsely become Markdown backlinks or executable workflow grants.
35. Launch a clean packaged build offline with no PixelLab credentials and verify all shipped art renders.
36. Verify fantasy assets share pixel scale, pivots, and seams; reduced motion still communicates working/blocked status.

Use focused tests for meaningful risks. Do not spend time on trivial tests that only mirror implementation or claim safety from snapshot coverage.

### 22.3 Real-project evaluation

Create a small evaluation set with clear expected deliverables and human scoring rubrics. Include generic planning, a content campaign, an event, and source-based school support.

Compare one agent against the three-role workflow on completion, missing requirements, unsupported claims, necessary user edits, elapsed time, model usage, and cost where known. Multiple agents should remain optional when the simpler baseline is better.

Live tests require configured credentials and an explicit small usage limit. Never put credentials in fixtures or require paid calls in the default test suite. Document any adapter not live-tested.

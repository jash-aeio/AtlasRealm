# Product Vocabulary, World Rules & Invariants

> **Source:** Atlas Realm Build Plan rev 1.1, §3 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 3. Product vocabulary and world rules

| Concept | User-facing representation | Operational meaning |
|---|---|---|
| Local profile | User identity and avatar | Local preferences and a separate application data set |
| World | Village, city, or kingdom | Workspace containing projects and shared resource availability |
| District | Neighborhood or map region | Optional project grouping; later expansion |
| Project | House or other structure | Goal, inputs, team, tasks, workflows, files, and history |
| Agent template | Recruitable Guild character | Versioned role, instructions, capabilities, and defaults |
| Agent instance | A recruited team member | Project-scoped assignment with its own configuration and memory |
| Skill | Library resource | Instructions and supporting assets; sometimes declared code dependencies |
| Tool | Shop resource | A callable, permission-controlled capability |
| Integration | Connected application/service | Installed adapter plus configuration and optional credentials |
| Model connection | AI engine selection | Provider, model, authentication method, and capability profile |
| Workflow | Reusable project procedure | Versioned steps, dependencies, conditions, and checks |
| Run | Work currently or previously attempted | A persisted execution of a workflow snapshot |
| Automation | Scheduled or event-based procedure | Trigger configuration that creates a workflow run |
| Artifact | File or deliverable | Versioned user-usable output with provenance |
| Building blueprint | Placeable representation | A reference to an existing project or service structure |
| Realm Atlas | Upper-right Map/Connections panel | Context-aware navigation and relationship inspection |
| Project interior | Enterable cutaway building | Functional stations connected to project controls |
| Blueprint mode | Interior structural overlay | Simplified room/station layout and highlighted functional connections |
| Relationship graph | Connected nodes and labeled lines | Typed references between authorized project entities |
| Obsidian bridge | Optional knowledge connection | Selected note/Canvas export and explicit note opening |
| Project import session | Existing-project setup wizard | Bounded inspection, reviewed setup proposal, and committed import |

### 3.1 Invariants

- A project exists independently of its building, hotbar slot, or avatar location.
- A project has at most one building placement in its world in the first release.
- Moving a building changes placement metadata, not file paths or project identity.
- Removing a building returns its project to an unplaced state. It does not delete files or stop a run.
- Unplaced projects can be opened, run, searched, pinned, and archived.
- Removing a hotbar shortcut never deletes its target.
- All project operations resolve by stable project ID, not name or map coordinates.
- A project belongs to one world initially. Cross-world transfer is a later explicit operation.
- Hiding, archiving, and deleting are separate operations with different effects.
- Cosmetic themes do not change capabilities, permissions, or execution speed.
- Service structures open the same panels as sidebar buttons. Placement is optional.
- Agents work regardless of the user's camera position, avatar distance, or project interior visibility.
- Recruiting a template does not copy another project's memory or credentials.
- A model response is a proposal until application code validates and executes any requested action.
- Moving a graph node changes graph layout only; it never moves an original file or building.
- A visual project dependency is descriptive unless explicitly mapped into an executable workflow through validation.
- Entering a building, opening a file, and selecting a graph node share context without starting work.
- A graph link never grants cross-project data access, network access, or provider upload permission.
- The Atlas graph works without Obsidian. Disabling the bridge leaves both applications' existing files intact.
- Importing a project never runs its scripts or activates its existing automations.
- Fantasy progression is cosmetic and never locks productive controls or fabricates agent capability.

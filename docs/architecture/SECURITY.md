# Security, Permissions & Integrations (Threat Model)

> **Source:** Atlas Realm Build Plan rev 1.1, §13, §14, §21 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 13. Permission and approval model

### 13.1 Capability examples

```text
project.files.list
project.files.read
project.artifacts.write
external.files.read
external.files.write
external.files.delete
provider.request
network.fetch
application.document.create
application.document.edit
application.ui.control
external.message.send
external.content.publish
process.execute
graph.source.index
project.import.inspect
project.import.copy
obsidian.notes.export
obsidian.notes.index
obsidian.note.open
asset.generation.request
```

These identifiers are internal implementation details; display plain explanations in the interface.

### 13.2 Authorization evaluation

Before an operation, evaluate:

`actor + project + run/step + tool capability + canonical target + input scope + network destination + limits + grant validity`

Default deny when a required grant is absent. A skill or model cannot create grants. Installing a tool never grants access by itself.

Initial user modes:

- **Draft:** work within explicitly granted inputs and project output storage; external changes unavailable.
- **Assisted:** allow proposed external changes through concrete operation approval.
- **Delegated:** allow an explicitly defined workflow within narrowly scoped continuing grants; later expansion for consequential external actions.

### 13.3 Approval binding

An approval request records exact tool/operation, normalized arguments, target, account, payload digest, run/step/attempt identifiers when applicable, constraints, expiry, and any prerequisite revision. Interactive imports/exports bind approval to their session ID, selected roots, and inventory/proposal revision rather than requiring a workflow run. The user's decision authorizes that payload only. Material changes require a new decision. Recheck revocation and target resolution at execution time.

The approval view shows what will be read or changed, where data will go, whether an external action can be undone, and a preview when available. Provide Allow Once, an appropriately narrow continuing grant if supported, and Deny. Do not offer broad permanent access by default.

### 13.4 Filesystem enforcement

- Resolve and validate actual paths; string-prefix checks are insufficient.
- Handle case-insensitive Windows paths, `..`, drive changes, UNC paths, junctions, symlinks, and links changed between validation and use.
- Reject device paths and unsupported alternate data streams in the managed storage/import path.
- Prefer app-managed copies for imported inputs. External file references are explicitly marked and separately authorized.
- Use OS-enforced isolation for third-party processes; cooperative path settings do not constrain malicious code.
- Avoid a general shell capability in the MVP.
- Do not auto-grant Documents, the home directory, browser profiles, credentials directories, or the entire disk.
- Project import inspection, graph indexing, and Obsidian export each require their own bounded source/destination scope.
- Graph responses must filter unauthorized titles, paths, edge counts, previews, search results, and exported metadata, not merely hide node bodies.

### 13.5 Credential handling

Use a vault interface with create, rotate, delete, and provider-internal resolve operations. Existing secrets must never be returned through renderer queries, logs, events, manifests, backups, or ordinary error messages.

A password-style credential entry field may temporarily hold a newly supplied key while sending it through a dedicated write-only IPC route; clear it immediately afterward and exclude it from persisted UI state and analytics. Prefer supported system/browser authorization flows when available.

Validate secure-storage availability and platform behavior. If protected persistence is unavailable, offer session-only credentials or disable persistence; never silently fall back to plaintext. OS-backed encryption does not protect against all software running as the same OS user. [Electron safeStorage documentation](https://www.electronjs.org/docs/latest/api/safe-storage).

## 14. Tool Shops and application integrations

### 14.1 Four distinct actions

The interface must distinguish acquiring a connector, installing a required application, connecting an account, and granting project access. Purchasing or installing a connector does not supply a third-party application license.

### 14.2 Capability-specific adapters

Prefer a supported document/service API or direct artifact creation when it meets the goal. Desktop UI control is a separate integration requiring focus management, interruption handling, and app-specific testing.

Examples of tool cards:

| Card | Intended capabilities | Readiness explanation |
|---|---|---|
| Project Files | List/read approved input files; create project artifacts | Bundled and available offline |
| Document Export | Generate a supported file format | Available if exporter is installed; no promise of controlling Word |
| Word Connector | Supported document operations in installed Word | Requires compatible Word installation and adapter |
| Canva Connector | Supported design operations | Requires network, account, and an actual supported integration |
| Local MCP Package | Declared third-party tool capabilities | Requires reviewed package and restricted runner |
| Obsidian Bridge | Selected Markdown/Canvas export and note opening | Optional local vault/path authorization; does not require an MCP server |
| PixelLab Asset Studio (future in-app option) | Online asset generation through official service | Requires a supported account, reviewed service-use scope, and generation budget; not needed to display bundled assets |

Never show a product logo as "connected" merely because an app name or executable was detected. Distinguish detected, installed, authenticated, authorized, and functional.

### 14.3 MCP implementation stages

1. Catalog metadata and compatibility inspection.
2. A controlled integration against a test server with explicit capabilities.
3. One curated real connection with brokered permissions and constrained credentials.
4. Broader install support after process/network isolation and update controls work.

MCP is an integration protocol, not an automatic permission system or sandbox. A local server is an ordinary process with the privileges it is given; the host must supply containment. [MCP local server security](https://modelcontextprotocol.io/docs/tutorials/security/local-server-security).

Do not ship general one-click execution of arbitrary community MCP servers as an MVP shortcut. If an integration requires unrestricted UI control that cannot fit a strict container, label its broader host access and design a separate, tightly scoped controller. Do not claim identical isolation guarantees for both modes.

## 21. Security and privacy requirements for implementation

This section defines concrete controls for features that can read files or take actions; it is not a claim that software can eliminate all risk.

### 21.1 Electron boundary

- Keep Node integration disabled in renderers and context isolation enabled.
- Use the framework's supported sandboxing settings and a restrictive content security policy.
- Validate every privileged IPC sender and payload.
- The packaged app refuses to start with Chromium switches that bypass this boundary: debuggers (`remote-debugging-port`/`-pipe`, `inspect*`, `js-flags`), sandbox/isolation (`no-sandbox`, `disable-web-security`, `disable-site-isolation-trials`, `single-process`), child-process injection (`renderer-cmd-prefix`, `gpu-launcher`, `utility-cmd-prefix`, `browser-subprocess-path`) and traffic interception (`proxy-server`, `proxy-pac-url`, `ignore-certificate-errors`, `host-rules`, `host-resolver-rules`). The check runs first in main, before the lock, database or windows. Only a test-only package variant, marked inside `app.asar` at build time (never via the environment), may use `remote-debugging-port` ([ADR-0015](../adr/0015-chromium-switch-guard-and-test-variant.md), `src/main/bootstrap/switch-guard.ts`).
- Load trusted application UI locally; prevent unexpected navigation and window creation.
- Open approved external links in the system browser through a validated scheme policy.
- Do not render remote websites with desktop privileges.
- Keep dependencies maintained and review security-relevant framework updates.

### 21.2 Model and imported-content boundary

- No model response can invoke a shell, import arbitrary code, change permissions, or select a new paying account directly.
- Treat document instructions and community resource instructions as potentially untrusted.
- Tool names must resolve to registered capabilities; reject invented tools and extra arguments.
- Limit input/output size, recursion, request counts, and execution time.
- Preview sensitive data destinations before provider dispatch.
- Keep network policy separate from file policy. Read permission is not permission to upload.

### 21.3 Logs and diagnostics

Record action metadata, request identifiers, safe error codes, durations, and outcome summaries. Redact secrets and sensitive payload fields. Do not log entire provider requests by default. Diagnostics export has a preview and excludes credentials and project content unless explicitly included.

The activity history is useful for accountability; it is not a tamper-proof audit trail against the computer's owner or an attacker with equivalent OS access. Business-grade tamper resistance requires additional architecture.

### 21.4 Updates

Before distributing an updater, establish a trusted signed package/update path and rollback/recovery behavior. Application updates and community resource updates are distinct. Do not run arbitrary scripts from an update feed.

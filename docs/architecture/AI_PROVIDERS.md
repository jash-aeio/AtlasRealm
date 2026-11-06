# AI Model Connections & Provider Adapters

> **Source:** Atlas Realm Build Plan rev 1.1, §11 — copied verbatim from [the archived original](../archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 11. AI model connections and provider adapters

### 11.1 Separate model support from access methods

Connection fields should include provider kind, auth method, account label, vault reference, permitted endpoint, selected model, capability profile, availability, and usage reporting capabilities.

Initial access methods:

- Mock: no network or credentials; deterministic test fixtures.
- Local runtime: a user-approved loopback endpoint and selected downloaded model.
- Cloud API key: a user-owned key handled by the trusted credential/provider service.
- Future supported OAuth or subscription connection: implement only from current official provider documentation and applicable eligibility.

Do not scrape browser sessions, collect consumer account passwords, reuse another application's tokens, or silently substitute API billing when subscription usage fails. Cloud account sign-in, API credits, and subscription authorization are separate concepts.

The Anthropic adapter should use the supported official TypeScript client or documented HTTP API. Keep provider-specific request and response structures in that adapter. [Claude SDK documentation](https://platform.claude.com/docs/en/cli-sdks-libraries/overview).

OpenAI credentials must remain confidential and scoped to the user's chosen account/project. A commercial hosted deployment will need a different identity and credential-management design from a personal desktop connection. [Official OpenAI credential guidance](https://developers.openai.com/api/docs/guides/api-keys).

### 11.2 Adapter contract

The following is a design sketch; use runtime-validated schemas and precise internal message types in implementation:

```ts
interface ProviderAdapter {
  kind: string;
  checkConnection(connectionId: string, signal: AbortSignal): Promise<ConnectionHealth>;
  getCapabilities(connectionId: string, modelId: string): Promise<ModelCapabilities>;
  stream(request: NormalizedModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}

type ModelEvent =
  | { type: 'text.delta'; text: string }
  | { type: 'tool.proposal'; callId: string; name: string; arguments: unknown }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; estimatedCost?: string }
  | { type: 'completed'; finishReason: string; providerRequestId?: string };
```

Tool proposals are not actions. The broker validates the requested tool, arguments, permission, budgets, current lease, and cancellation state before execution. Accumulate streamed tool arguments before validating them; do not execute partial argument fragments.

Normalize tool-call IDs and tool-result correlation without losing provider-specific ordering requirements. Do not normalize away unsupported features and pretend they worked.

### 11.3 Capability gating

Model profile fields: text, tool calling, image input, structured output mode, context budget, maximum response budget, local/cloud location, and known restrictions. Distinguish provider claims from a locally verified compatibility check.

- A workflow requiring tools cannot silently run on a text-only adapter.
- Structured proposals need parsing and schema validation even if a provider offers structured output.
- Local model support for tool calling varies by selected model; test the configured combination. [Ollama tool-calling documentation](https://docs.ollama.com/capabilities/tool-calling).
- Do not automatically download a large model without showing size, destination, and expected resource needs.
- Do not present cloud execution as private local inference.
- Automatic fallback is off initially. Later fallback must preserve data policy, billing-account choice, and capability requirements.

### 11.4 Context construction

Build a bounded context from project requirements, selected input references, active step instructions, relevant skill instructions, and needed prior results. Do not attach an entire world, all files, every skill, or unlimited conversation history.

Preserve provenance on retrieved content. Treat file text, package instructions from community sources, web results, tool descriptions, and model responses according to their trust level. Delimiters help organization but are not a security boundary.

### 11.5 Budgets and concurrency

Recommended starting defaults, adjustable per run:

| Limit | Initial default |
|---|---|
| Concurrent model requests globally | 1 |
| Active runs globally | 2; model requests still serialize |
| Agent instances in a starter workflow | Up to 3 |
| Tool proposals per agent step | 8 |
| Model turns per agent step | 6 |
| Review/revision loops | 1 revision after the first review |
| Transient model retries | 2 retries after the initial attempt |
| Artifact/input text budget | Configured byte/token limits; reject oversized input before dispatch |
| Run duration | Finite user-visible limit with a configurable default |

Track input/output tokens, optional cached tokens, tool/media charges where known, provider request IDs, and estimates separately from settled usage.

Reserve estimated request cost before dispatch and reconcile it after completion. The reservation must account for the maximum permitted output and known tool charges. When pricing is unknown or stale, show that uncertainty and use request/token limits; do not claim an exact monetary ceiling. User budget exhaustion prevents new requests, but cannot reverse provider charges already incurred or guarantee provider invoice totals.

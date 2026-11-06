# Reference Notes

> **Source:** Atlas Realm Build Plan rev 1.1, §35 — copied verbatim from [the archived original](archive/Atlas_Realm_Build_Plan_v1.1.md). Section numbers are kept so cross-references like "see section 33" still work. Edit this file (not the archive) when the spec changes, and record why in an ADR.

## 35. Reference notes

The architecture, schema, limits, UI, and milestone choices in this plan are proposed engineering decisions. Linked official documentation supports specific underlying facts; it does not certify this design or guarantee future API availability.

Foundation documentation was consulted on November 5, 2026. Graph, Obsidian, fantasy asset, and PixelLab references were checked on November 6, 2026:

| Reference | Use in this plan |
|---|---|
| [Electron security](https://www.electronjs.org/docs/latest/tutorial/security) | Privileged desktop boundary and renderer hardening |
| [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage) | OS-backed secret protection and platform limitations |
| [PixiJS introduction](https://pixijs.com/8.x/guides/getting-started/intro) | 2D world rendering layer |
| [Ollama FAQ](https://docs.ollama.com/faq) | Local execution and local-only configuration |
| [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling) | Local-model tool-call adapter behavior |
| [Claude client tooling](https://platform.claude.com/docs/en/cli-sdks-libraries/overview) | Official API client integration |
| [Official OpenAI credential guidance](https://developers.openai.com/api/docs/guides/api-keys) | Credential identity, scope, and lifecycle |
| [MCP architecture](https://modelcontextprotocol.io/docs/learn/architecture) | Local/remote integration model |
| [MCP local server security](https://modelcontextprotocol.io/docs/tutorials/security/local-server-security) | Host responsibility for local process containment |
| [SQLite backup API](https://www.sqlite.org/backup.html) | Consistent database backup mechanism |
| [GitHub licensing guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository) | Source reuse and resource distribution |
| [Obsidian Graph view](https://help.obsidian.md/plugins/graph) | Global/local graph reference |
| [Obsidian Canvas](https://help.obsidian.md/plugins/canvas) | Spatial note/file board reference |
| [Obsidian URI](https://help.obsidian.md/uri) | Explicit local note opening |
| [JSON Canvas specification](https://jsoncanvas.org/spec/1.0/) | Portable board nodes/edges; not workflow semantics |
| [React Flow MiniMap](https://reactflow.dev/api-reference/components/minimap) | Graph navigation reference |
| [React Flow grouped nodes](https://reactflow.dev/examples/grouping/sub-flows) | Collapsible graph group reference |
| [PixelLab ways to use the service](https://www.pixellab.ai/docs/ways-to-use-pixellab) | Remote MCP, account requirements, supported production workflows |
| [PixelLab official MCP repository](https://github.com/pixellab-code/pixellab-mcp) | Setup reference and generation capability examples |
| [PixelLab service terms](https://www.pixellab.ai/termsofservice) | Output/service-use terms to review before generation and product integration |
| [BoostyBear ISO Fantasy](https://boostybear.itch.io/iso-fantasy) | Optional licensed fantasy art fallback/reference |
| [Gustavo Vituri Isometric TRPG](https://gvituri.itch.io/isometric-trpg) | Optional low-resolution fantasy prototype/reference |
| [Kenney Isometric Buildings](https://kenney.nl/assets/isometric-tiles-buildings) | CC0 prototype asset reference |
| [Aseprite sprite sheets](https://www.aseprite.org/docs/sprite-sheet/) | Pixel cleanup and export workflow |
| [Recraft game assets](https://www.recraft.ai/generate/game-assets) | Optional alternative concept-generation route |
| [VS Code Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust) | Reference for inspection before execution trust |

The exact DevLabs repository from the original discussion was not identified. No DevLabs-specific implementation or license assumption is made here. OpenClaw is an inspiration; this plan does not depend on forking it or inheriting its runtime architecture.

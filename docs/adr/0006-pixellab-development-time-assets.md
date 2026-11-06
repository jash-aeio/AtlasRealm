# ADR-0006: PixelLab is a development-time asset tool, not a runtime dependency

- **Status:** Accepted (spec §34)
- **Date:** 2026-11-06
- **Milestone(s) affected:** M0-8 (placeholders), M5 (first batch), M7 (offline verification)

## Decision
Assets are generated during development (with your PixelLab account, through a user-scoped MCP server), reviewed, and committed as local files. The shipped app never contacts PixelLab. Placeholders keep the build working without an account.

## Consequences
- The PixelLab token is never committed. The MCP server is configured at **user scope**, not in `.mcp.json`.
- Check plan/quota/terms before every batch. Provenance is recorded in `docs/art/ASSET_PROVENANCE.md`.

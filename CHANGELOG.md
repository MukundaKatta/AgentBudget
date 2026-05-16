# Changelog

All notable changes to `agentbudget` are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows [SemVer](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

Production-polish branch (this PR): adds Dependabot, CODEOWNERS, security + contributing docs, issue + PR templates, CI matrix, release workflow with npm provenance, README badges. No runtime behavior changes.

See also: PR #1 (`add-retry-and-adversarial-loop-detection`) for the upcoming v0.2 work that adds the `withBudget` retry decorator + adversarial-loop detection. That PR is intentionally independent of this one.

## [0.1.0] — 2026-05-09

Initial release. Token + dollar budget caps for AI agents — zero runtime dependencies, drop into any provider SDK.

### Added

- **`Budget` class** — track input + output token usage across an agent run, throw `BudgetExceededError` when either the token cap or the dollar cap would be exceeded. `add(modelId, { inputTokens, outputTokens })`, `snapshot()`, `remaining()`.
- **`computeCost(rate, usage)`** — utility for dollars-per-call given a pricing rate and token usage. Pure function; no I/O.
- **`DEFAULT_PRICING`** — starter rate table for Claude (Sonnet, Haiku, Opus) and GPT (4o, 4o-mini, 4.1) families. `Object.freeze`'d. Override per-`Budget`-instance for additional or repriced models.
- **`BudgetExceededError`** — thrown with the exact field that breached (`inputTokens` / `outputTokens` / `costUsd`), the cap, and the value that would have exceeded it.
- **`UnknownPricingError`** — thrown when `costUsd` is set on a `Budget` but a model id is not present in the pricing table.
- TypeScript declarations in `src/index.d.ts`.

### Notes

- 23 unit tests via `node --test`.
- Zero runtime dependencies.
- Node 18+ (uses `node:test`).
- The pricing table is data, not API: new models added in patch releases.

# Contributing to agentbudget

agentbudget is a small, zero-dependency JavaScript library: it enforces a token + dollar ceiling on AI agent calls and throws `BudgetExceededError` when a call would push past the cap.

This file describes what kinds of changes belong here, and what belong in a sibling library instead.

## In scope

- Bug fixes in `Budget`, `BudgetExceededError`, `UnknownPricingError`, `computeCost`, `DEFAULT_PRICING`.
- New entries in `DEFAULT_PRICING` when a new Claude / GPT / Gemini / open-weights model is broadly available with a stable public per-token price.
- Better numerical robustness (catching floating-point edge cases that let a cap be silently overshot).
- Test coverage improvements and additional adversarial cases.
- Documentation: clearer README, JSDoc on the type definitions, more usage examples in `examples/`.

## Out of scope

- **Retry / backoff loops.** That work lives on the `add-retry-and-adversarial-loop-detection` branch (open as PR #1) and ships as agentbudget v0.2 once landed. Adding a parallel retry surface here would split the API.
- **HTTP transport / interception.** agentbudget never makes a network call. If you want a wrapper that auto-feeds usage to `Budget` after an SDK response, that's a sibling library (e.g. `agentbudget-anthropic`, `agentbudget-openai`), not this package.
- **Pricing freshness as a service.** Provider prices drift. We ship `DEFAULT_PRICING` as a starter table that you can override per-`Budget`-instance. We will not run a cron job against vendor pricing pages.
- **Telemetry / logging.** `Budget` exposes `.snapshot()` so the caller can log; the library will not call into any logger itself.
- **Runtime dependencies.** Zero by design. A PR that adds a runtime dependency will be closed in favor of a discussion issue.

## Sibling libraries

agentbudget has ports / wrappers in adjacent repos:

- Python: [`AgentBudgetPy`](https://github.com/MukundaKatta/AgentBudgetPy) and [`agent-budget`](https://github.com/MukundaKatta/agent-budget)
- Go: [`agentbudget-go`](https://github.com/MukundaKatta/agentbudget-go)
- MCP server: [`AgentBudgetMcp`](https://github.com/MukundaKatta/AgentBudgetMcp)

When `DEFAULT_PRICING` is updated here, please mirror the change into the Python + Go siblings within the same week.

## Development setup

```bash
git clone https://github.com/MukundaKatta/AgentBudget.git
cd AgentBudget
# No `npm install` needed — zero dependencies.
npm test              # node --test on test/**/*.test.js
npm run test:examples # runnable example doubles as a smoke test
npm run test:all      # both
```

Node 18+ required (uses `node:test`).

## Workflow

1. Open an issue first for anything bigger than a one-file change.
2. Branch from `main`.
3. Write tests for the change. Every new public-API behavior needs a test in `test/`.
4. Run `npm run test:all` and confirm it passes.
5. Open a PR against `main`. Fill in the template.
6. CI must be green before review.

## Coding conventions

- ES modules, native JS (no TypeScript source; types live in `src/index.d.ts`).
- No runtime dependencies. Test-only helpers may go in `test/` but should not require external packages.
- `BudgetExceededError` and `UnknownPricingError` are stable shapes. Adding a new field is fine; renaming or removing one is a breaking change.
- JSDoc on exported functions. The `src/index.d.ts` declarations are authoritative for the public API.

## Release cadence

Releases follow semver. Patches: bug fixes only. Minor versions: new pricing entries or additive API. Major versions: breaking changes to `Budget` / error shapes (unlikely in v0.x).

Releases are cut by the maintainer via tag push. See `.github/workflows/release.yml`. npm publish uses provenance OIDC; no `NPM_TOKEN` secret needed.

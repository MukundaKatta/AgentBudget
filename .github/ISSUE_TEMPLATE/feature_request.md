---
name: Feature request
about: Propose a new pricing entry, API addition, or behavior change.
title: "[feat] "
labels: enhancement
assignees: ''
---

## Scope check

Before opening, please confirm this proposal fits the project scope (see `CONTRIBUTING.md`):

- [ ] It does **not** add a runtime dependency. (Zero deps is a hard line; PRs that add one will be closed in favor of an issue discussion first.)
- [ ] It does **not** perform network I/O. (This library never makes HTTP calls. Provider SDK adapters belong in sibling packages.)
- [ ] It is **not** a retry / backoff feature. (Those land in v0.2 via PR #1: `withBudget` decorator + adversarial-loop detection.)

If any of those are unchecked, the right home is likely:

- A retry-adjacent feature: comment on PR #1 (`add-retry-and-adversarial-loop-detection`).
- A provider-SDK integration: a sibling package like `agentbudget-anthropic`.
- A Python or Go feature: [`AgentBudgetPy`](https://github.com/MukundaKatta/AgentBudgetPy) / [`agentbudget-go`](https://github.com/MukundaKatta/agentbudget-go).

## What you want

A clear description of the proposed feature.

## Why

What real-world budget-cap bug or workflow gap does this address? Concrete example of the call pattern that would benefit.

## Proposed API shape

```jsonc
// new method:
// signature:
// returns:
// throws:
```

## Pricing entry

If this is "add model X to `DEFAULT_PRICING`", please also:

- [ ] Link to the provider's public pricing page (Anthropic / OpenAI / Google / Bedrock).
- [ ] State the per-million input rate and per-million output rate.
- [ ] Confirm whether the Python (`AgentBudgetPy`) and Go (`agentbudget-go`) siblings already have this model.

## Alternatives considered

What workarounds exist today (per-instance pricing override, custom error subclass, wrapping `Budget` externally) and why aren't they good enough?

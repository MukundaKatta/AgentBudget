<!--
Thanks for sending a PR to agentbudget.

Quick reminders before you submit:
  - Zero runtime dependencies. A PR that adds one will be sent back to an issue discussion first.
  - This library performs no network I/O. Provider SDK adapters belong in sibling packages.
  - Retry / adversarial-loop work belongs in v0.2 (PR #1), not here.
  - Tests live in test/ and run via `npm test`. Add one for any new behavior.
-->

## What this changes

A one-line summary, then a short paragraph if needed.

## Why

The user-visible bug or capability gap this addresses.

## Type of change

- [ ] Bug fix in `Budget` / `BudgetExceededError` / `UnknownPricingError`
- [ ] New entry in `DEFAULT_PRICING`
- [ ] Numerical robustness (overflow / underflow / rounding edge case)
- [ ] Test coverage
- [ ] Documentation
- [ ] CI / build / release plumbing

## Scope check

- [ ] No new runtime dependencies added (zero-deps is enforced by CI).
- [ ] No network I/O introduced.
- [ ] Not a retry / backoff feature (those go in v0.2 / PR #1).

## Validation

- [ ] `npm run test:all` passes locally (unit + examples)
- [ ] If a pricing entry was added, sibling repos (`AgentBudgetPy`, `agentbudget-go`) have a queued change or an existing matching entry
- [ ] Public API changes are reflected in `src/index.d.ts`

## Linked issue

Closes #

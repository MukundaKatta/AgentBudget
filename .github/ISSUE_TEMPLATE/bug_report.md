---
name: Bug report
about: A ceiling was overshot, an error was thrown when it shouldn't have been, or a pricing entry is wrong.
title: "[bug] "
labels: bug
assignees: ''
---

## What happened

A clear, concise description of the actual behavior.

## What you expected

A clear, concise description of what should have happened.

## Reproduction

Minimal repro using only this library:

```js
import { Budget } from '@mukundakatta/agentbudget';

const b = new Budget({
  // your config here — the smallest one that reproduces
});

// the calls you made
b.add('claude-sonnet-4-20250514', { inputTokens: 1000, outputTokens: 500 });
// ...

console.log(b.snapshot());
// observed: ...
// expected: ...
```

If the bug is in pricing, please also include:

- The model id involved.
- The price source (link to the provider's pricing page).
- Whether the issue is "model missing from `DEFAULT_PRICING`" or "rate is wrong".

## Environment

- agentbudget version: (`npm ls @mukundakatta/agentbudget`)
- Node version: (`node --version`)
- OS: (macOS 14 / Ubuntu 22.04 / Windows 11)
- Provider SDK (if relevant): (Anthropic SDK, OpenAI SDK, etc.) + version

## Notes

Anything else — whether usage values came straight from a provider response or were computed by the caller, whether `Budget` was newly constructed or shared across many requests, anything that looks suspicious.

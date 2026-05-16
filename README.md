# agentbudget

Token + dollar budget caps for AI agents. Throws `BudgetExceededError` when an LLM call would push past the ceiling. Zero deps, drop into any provider SDK.

```bash
npm install @mukundakatta/agentbudget
```

## Why

You ship an agent. A bug in the planner makes it loop. Your `claude-opus-4-5` bill is $300 before you notice.

`agentbudget` is one class. Set caps once, record usage after each call, throw the moment any cap is breached. CI catches loops; production catches runaways.

## Quickstart

```js
import { Budget, BudgetExceededError } from '@mukundakatta/agentbudget';

const budget = new Budget({
  maxTotalTokens: 200_000,   // hard token ceiling
  maxCostUsd: 5.00,          // hard dollar ceiling
});

try {
  for (const turn of turns) {
    const resp = await client.messages.create({ ... });
    budget.recordUsage({
      model: resp.model,
      inputTokens: resp.usage.input_tokens,
      outputTokens: resp.usage.output_tokens,
    });
  }
} catch (err) {
  if (err instanceof BudgetExceededError) {
    console.error(`stopped — ${err.cap} cap of ${err.limit} hit`);
  }
  throw err;
}
```

The thrown `BudgetExceededError` carries `{ cap, limit, attempted, overshoot, model }` so you can build human messages without re-reading the budget.

## Caps

All optional, all checked after each `recordUsage`. The first violation wins, in this order:

| Option            | Caps                                          |
| ----------------- | --------------------------------------------- |
| `maxInputTokens`  | total input tokens across all calls           |
| `maxOutputTokens` | total output tokens across all calls          |
| `maxTotalTokens`  | input + output combined                       |
| `maxCostUsd`      | dollars (requires pricing — see below)        |

## Auto-record with `wrap`

`Budget#wrap` adapts the Anthropic and OpenAI response shapes out of the box:

```js
import Anthropic from '@anthropic-ai/sdk';
import { Budget } from '@mukundakatta/agentbudget';

const client = new Anthropic();
const budget = new Budget({ maxCostUsd: 1 });

const create = budget.wrap(client.messages.create.bind(client.messages));

await create({ model: 'claude-sonnet-4-7', max_tokens: 1024, messages: [...] });
// budget.totals is updated automatically; throws if the cap is hit
```

For other providers, pass `extractUsage`:

```js
const wrapped = budget.wrap(myCustomCall, {
  extractUsage: (r) => ({
    model: r.model_id,
    inputTokens: r.tokens.in,
    outputTokens: r.tokens.out,
  }),
});
```

## Pre-flight checks

Don't want to make the call when you're already near the cap? Use `wouldExceed` (returns the cap name or `null`) or `assertCanSpend` (throws):

```js
if (budget.wouldExceed({ inputTokens: 8000, outputTokens: 2000 })) {
  // skip the call entirely
  return await fallback();
}

// or, in batch flows where you can split work:
budget.assertCanSpend({ inputTokens: estimatedTokens });  // throws if not
```

## Pricing

`maxCostUsd` needs per-model rates. `agentbudget` ships a starter `DEFAULT_PRICING` table (Claude + GPT, early-2026 rates) and lets you override:

```js
import { Budget, DEFAULT_PRICING } from '@mukundakatta/agentbudget';

const budget = new Budget({
  maxCostUsd: 10,
  pricing: {
    // override one model
    'claude-sonnet-4-7': { inputPer1k: 0.0015, outputPer1k: 0.0075 }, // your cached rate
    // or add a model the default doesn't know
    'my-finetune-v2': { inputPer1k: 0.001, outputPer1k: 0.001 },
  },
});
```

Always verify the default rates against the provider's current pricing page before relying on them for billing-critical work.

If you call a model not in either table:

```js
new Budget({ maxCostUsd: 1 });                    // throws UnknownPricingError
new Budget({ maxCostUsd: 1, allowUnknownPricing: true });  // unknown models cost $0
new Budget({ maxTotalTokens: 1_000_000 });        // no cap, no error — pricing is irrelevant
```

## Introspection

```js
budget.totals;
// { inputTokens: 12_400, outputTokens: 3_100, totalTokens: 15_500, costUsd: 0.084, calls: 7 }

budget.remaining();
// {
//   totalTokens: { used: 15500, limit: 200000, remaining: 184500 },
//   costUsd:     { used: 0.084,  limit: 5,      remaining: 4.916 },
//   calls: 7,
// }
```

`budget.reset()` zeroes the totals but keeps caps + pricing — useful for re-using one Budget across runs.

## Sibling libraries

Part of the [`@mukundakatta/agent*`](https://github.com/MukundaKatta?tab=repositories&q=agent) reliability stack:

- [agentsnap](https://www.npmjs.com/package/@mukundakatta/agentsnap) — snapshot tests for tool-call traces
- [agentguard](https://www.npmjs.com/package/@mukundakatta/agentguard) — network egress allowlist
- [agentcast](https://www.npmjs.com/package/@mukundakatta/agentcast) — JSON output enforcer
- [agentfit](https://www.npmjs.com/package/@mukundakatta/agentfit) — fit messages to context window
- [agentvet](https://www.npmjs.com/package/@mukundakatta/agentvet) — validate tool args before execution
- **agentbudget** — this lib

## License

[MIT](LICENSE) © Mukunda Katta

## Repository Health

This repository includes a dependency-free health check for core documentation, metadata, and CI wiring. Run it locally before publishing changes:

```sh
python3 scripts/check_repository_health.py
```

The same check runs in GitHub Actions on pushes and pull requests.

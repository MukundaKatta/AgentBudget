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

## `withBudget` — retry-aware decoration (v0.2+)

`Budget` is a post-call accumulator. `withBudget` is the dual: a pre-call decorator that wraps an async function with retry + budget + adversarial-loop detection. Use one or both — they don't interact.

Why exist when `p-retry` / `async-retry` are everywhere on npm:
- They're generic. No LLM cost cap, no adversarial-loop detection, no per-attempt event taxonomy.
- The OpenAI / Anthropic SDK `maxRetries` is just an integer.
- Instructor's retry hook ([jxnl/instructor#2222](https://github.com/jxnl/instructor/issues/2222)) doesn't expose `attemptNumber` / cumulative state — can't distinguish a retryable mid-flight failure from a final one.
- Instructor security audit ([#2056](https://github.com/jxnl/instructor/issues/2056)) flagged retry-amplification: a prompt-injected response that always fails validation can drive unbounded retries and cost. `withBudget` detects this.

```js
import {
  withBudget,
  AdversarialLoopDetectedError,
  WithBudgetExceededError,
} from '@mukundakatta/agentbudget';

class RateLimitError extends Error {}
class ContentPolicyError extends Error {}

const wrapped = withBudget(
  async (prompt) => callLLM(prompt),
  {
    maxAttempts: 5,
    maxCostUsd: 0.10,
    maxWallClockMs: 30_000,
    retryOn: [RateLimitError],
    fatalOn: [ContentPolicyError],
    costExtractor: (r) => r.usage.cost_usd,
    onAttempt: (evt) => log.info(evt),  // see "Hooks" below
  },
);

try {
  const result = await wrapped(prompt);
} catch (err) {
  if (err instanceof AdversarialLoopDetectedError) {
    log.error(`validation always failing — fingerprint=${err.fingerprint}`);
  } else if (err instanceof WithBudgetExceededError) {
    log.error(`${err.kind} budget exhausted after ${err.attempts} attempts`);
  } else {
    throw err;  // unknown / fatal exceptions re-thrown as-is
  }
}
```

### Behavior

On exception:
- **`fatalOn`** beats `retryOn` — re-thrown immediately without retry.
- **`retryOn`** — retried with exponential backoff (clamped to `backoffMaxMs` and to remaining `maxWallClockMs`) until `maxAttempts` exhausts.
- **Unknown** (in neither set) — re-thrown immediately. `withBudget` never blindly retries an exception class you didn't opt into.

On success: if `costExtractor` is set, its return value is added to cumulative cost; if cumulative > `maxCostUsd`, throws `WithBudgetExceededError({ kind: 'costUsd' })`.

Adversarial loop: if the same `fingerprintException(err)` repeats `adversarialThreshold` times in a row (default 3), throws `AdversarialLoopDetectedError`. Set `detectAdversarialLoop: false` to disable.

### Hooks

`onAttempt` fires at lifecycle moments (`'start' | 'retry' | 'success' | 'failure'`) and receives an `AttemptEvent`:

```ts
interface AttemptEvent {
  kind: 'start' | 'retry' | 'success' | 'failure';
  attempt: number;            // 1-indexed; 0 only for "start"
  cumulativeCostUsd: number;
  cumulativeLatencyMs: number;
  lastError?: unknown;
  errorClassification: 'retryable' | 'fatal' | 'unknown' | 'none';
}
```

Hooks that throw are swallowed — instrumentation bugs never break the wrapped call.

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

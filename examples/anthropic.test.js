/**
 * End-to-end example: a fake Anthropic-shaped response, recorded via wrap.
 * Lives in examples/ so it runs as part of ``npm run test:examples`` and
 * doubles as a smoke test that the README quickstart actually compiles.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Budget, BudgetExceededError } from '../src/index.js';

test('quickstart: caps a runaway loop after the budget is hit', async () => {
  const budget = new Budget({ maxCostUsd: 0.05 });

  // Pretend Anthropic client. Real one returns the same shape.
  let calls = 0;
  const fakeCreate = async () => {
    calls += 1;
    return {
      model: 'claude-sonnet-4-7',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 2000, output_tokens: 1000 },
    };
  };
  const create = budget.wrap(fakeCreate);

  // 0.003*2 + 0.015*1 = 0.021 per call → 3rd call lands us at 0.063 > 0.05.
  let thrown;
  try {
    for (let i = 0; i < 10; i++) await create();
  } catch (e) {
    thrown = e;
  }

  assert.ok(thrown instanceof BudgetExceededError);
  assert.equal(thrown.cap, 'costUsd');
  // 3rd call trips the cap (third call = calls === 3 inside fakeCreate).
  assert.equal(calls, 3);
});

test('pre-flight wouldExceed lets you skip without making the call', () => {
  const budget = new Budget({ maxInputTokens: 1000 });
  // Already at 900.
  budget.recordUsage({ inputTokens: 900, outputTokens: 0 });

  // The next call would cost 200 → over the 1000 cap.
  const violated = budget.wouldExceed({ inputTokens: 200, outputTokens: 0 });
  assert.equal(violated, 'inputTokens');
  // Totals untouched — the call never ran.
  assert.equal(budget.totals.inputTokens, 900);
});

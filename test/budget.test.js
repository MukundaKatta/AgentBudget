import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  Budget,
  BudgetExceededError,
  UnknownPricingError,
  DEFAULT_PRICING,
  computeCost,
  VERSION,
} from '../src/index.js';

test('VERSION is a semver-ish string', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
});

// --- recordUsage --------------------------------------------------------

test('recordUsage tallies tokens and increments calls', () => {
  const b = new Budget();
  b.recordUsage({ inputTokens: 100, outputTokens: 50 });
  b.recordUsage({ inputTokens: 30, outputTokens: 20 });
  assert.equal(b.totals.inputTokens, 130);
  assert.equal(b.totals.outputTokens, 70);
  assert.equal(b.totals.totalTokens, 200);
  assert.equal(b.totals.calls, 2);
});

test('recordUsage throws when inputTokens cap exceeded', () => {
  const b = new Budget({ maxInputTokens: 100 });
  b.recordUsage({ inputTokens: 80, outputTokens: 0 });
  assert.throws(
    () => b.recordUsage({ inputTokens: 30, outputTokens: 0 }),
    (err) =>
      err instanceof BudgetExceededError &&
      err.cap === 'inputTokens' &&
      err.attempted === 110 &&
      err.limit === 100,
  );
});

test('recordUsage throws when totalTokens cap exceeded', () => {
  const b = new Budget({ maxTotalTokens: 100 });
  assert.throws(
    () => b.recordUsage({ inputTokens: 60, outputTokens: 50 }),
    (err) => err instanceof BudgetExceededError && err.cap === 'totalTokens',
  );
});

test('cost cap throws using DEFAULT_PRICING', () => {
  const b = new Budget({ maxCostUsd: 0.01 });
  // claude-sonnet-4-7: 0.003/1k input, 0.015/1k output.
  // 1000 input + 500 output = 0.003 + 0.0075 = 0.0105 → over $0.01.
  assert.throws(
    () =>
      b.recordUsage({
        model: 'claude-sonnet-4-7',
        inputTokens: 1000,
        outputTokens: 500,
      }),
    (err) => err instanceof BudgetExceededError && err.cap === 'costUsd',
  );
});

test('totals are still updated even when the call trips the cap', () => {
  // Documents the contract: by the time you have token counts, the call
  // already cost money. We tally + throw, not skip.
  const b = new Budget({ maxInputTokens: 100 });
  try {
    b.recordUsage({ inputTokens: 200, outputTokens: 0 });
    assert.fail('expected BudgetExceededError');
  } catch (err) {
    assert.ok(err instanceof BudgetExceededError);
  }
  assert.equal(b.totals.inputTokens, 200);
  assert.equal(b.totals.calls, 1);
});

test('first violation wins when multiple caps are tripped at once', () => {
  // Cap order: inputTokens → outputTokens → totalTokens → costUsd.
  // A single call that overruns both inputTokens and totalTokens reports
  // inputTokens (the more specific cap).
  const b = new Budget({ maxInputTokens: 50, maxTotalTokens: 50 });
  try {
    b.recordUsage({ inputTokens: 100, outputTokens: 100 });
    assert.fail();
  } catch (err) {
    assert.ok(err instanceof BudgetExceededError);
    assert.equal(err.cap, 'inputTokens');
  }
});

// --- pricing edge cases ------------------------------------------------

test('UnknownPricingError thrown when costUsd cap + unknown model', () => {
  const b = new Budget({ maxCostUsd: 1 });
  assert.throws(
    () => b.recordUsage({ model: 'nope-3', inputTokens: 1, outputTokens: 1 }),
    (err) => err instanceof UnknownPricingError && err.model === 'nope-3',
  );
});

test('allowUnknownPricing makes unknown models cost $0', () => {
  const b = new Budget({ maxCostUsd: 1, allowUnknownPricing: true });
  b.recordUsage({ model: 'preview-x', inputTokens: 1000, outputTokens: 1000 });
  assert.equal(b.totals.costUsd, 0);
});

test('no costUsd cap → no pricing needed', () => {
  const b = new Budget({ maxTotalTokens: 1_000_000 });
  // Unknown model is fine when there's nothing to charge against.
  b.recordUsage({ model: 'nope-3', inputTokens: 1, outputTokens: 1 });
  assert.equal(b.totals.calls, 1);
});

test('user-supplied pricing wins over DEFAULT_PRICING', () => {
  const b = new Budget({
    maxCostUsd: 1,
    pricing: { 'claude-sonnet-4-7': { inputPer1k: 100, outputPer1k: 100 } },
  });
  // 100/1k input × 10 input = 1.0 → exactly at cap, just under.
  b.recordUsage({ model: 'claude-sonnet-4-7', inputTokens: 5, outputTokens: 5 });
  assert.equal(b.totals.costUsd, 1.0);
  // Next 1¢ pushes over.
  assert.throws(
    () =>
      b.recordUsage({
        model: 'claude-sonnet-4-7',
        inputTokens: 1,
        outputTokens: 0,
      }),
    BudgetExceededError,
  );
});

// --- pre-flight checks --------------------------------------------------

test('wouldExceed returns the cap name without mutating', () => {
  const b = new Budget({ maxInputTokens: 100 });
  assert.equal(b.wouldExceed({ inputTokens: 50, outputTokens: 0 }), null);
  assert.equal(b.wouldExceed({ inputTokens: 200, outputTokens: 0 }), 'inputTokens');
  assert.equal(b.totals.inputTokens, 0); // unchanged
});

test('assertCanSpend throws but does not mutate', () => {
  const b = new Budget({ maxInputTokens: 100 });
  b.recordUsage({ inputTokens: 50, outputTokens: 0 });
  assert.throws(
    () => b.assertCanSpend({ inputTokens: 80 }),
    BudgetExceededError,
  );
  // Totals should still reflect only the one real call.
  assert.equal(b.totals.inputTokens, 50);
});

// --- wrap ---------------------------------------------------------------

test('wrap auto-records Anthropic-shaped usage', async () => {
  const b = new Budget({ maxTotalTokens: 1000 });
  const fakeCreate = async () => ({
    model: 'claude-sonnet-4-7',
    content: [{ type: 'text', text: 'hi' }],
    usage: { input_tokens: 10, output_tokens: 5 },
  });
  const wrapped = b.wrap(fakeCreate);
  await wrapped();
  assert.equal(b.totals.totalTokens, 15);
  assert.equal(b.totals.calls, 1);
});

test('wrap auto-records OpenAI-shaped usage', async () => {
  const b = new Budget();
  const fakeCreate = async () => ({
    model: 'gpt-4o',
    choices: [],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
  await b.wrap(fakeCreate)();
  assert.equal(b.totals.inputTokens, 100);
  assert.equal(b.totals.outputTokens, 50);
});

test('wrap with custom extractUsage', async () => {
  const b = new Budget();
  const fakeCreate = async () => ({ tokens: { in: 7, out: 3 } });
  const wrapped = b.wrap(fakeCreate, {
    extractUsage: (r) => ({ inputTokens: r.tokens.in, outputTokens: r.tokens.out }),
  });
  await wrapped();
  assert.equal(b.totals.totalTokens, 10);
});

test('wrap silently no-ops when result has no usage', async () => {
  const b = new Budget();
  const fake = async () => ({ content: 'cached' });
  await b.wrap(fake)();
  assert.equal(b.totals.calls, 0);
});

test('wrap throws BudgetExceededError on the call that trips the cap', async () => {
  const b = new Budget({ maxTotalTokens: 100 });
  const fake = async () => ({
    usage: { input_tokens: 60, output_tokens: 50 },
  });
  await assert.rejects(b.wrap(fake)(), BudgetExceededError);
});

// --- input validation ---------------------------------------------------

test('recordUsage rejects bad input', () => {
  const b = new Budget();
  assert.throws(() => b.recordUsage(null), TypeError);
  assert.throws(() => b.recordUsage({ inputTokens: -1, outputTokens: 0 }), TypeError);
  assert.throws(() => b.recordUsage({ inputTokens: NaN, outputTokens: 0 }), TypeError);
  assert.throws(() => b.recordUsage({ inputTokens: 'lots', outputTokens: 0 }), TypeError);
});

// --- introspection ------------------------------------------------------

test('remaining() reports per-cap usage with skipping for unset caps', () => {
  const b = new Budget({ maxInputTokens: 1000, maxCostUsd: 1 });
  b.recordUsage({
    model: 'claude-sonnet-4-7',
    inputTokens: 200,
    outputTokens: 100,
  });
  const r = b.remaining();
  assert.deepEqual(r.inputTokens, { used: 200, limit: 1000, remaining: 800 });
  assert.equal(r.calls, 1);
  // outputTokens has no cap → not surfaced.
  assert.equal(r.outputTokens, undefined);
  assert.ok(r.costUsd && r.costUsd.used > 0);
});

test('reset zeroes totals but preserves caps', () => {
  const b = new Budget({ maxInputTokens: 100 });
  b.recordUsage({ inputTokens: 50, outputTokens: 0 });
  b.reset();
  assert.equal(b.totals.inputTokens, 0);
  assert.equal(b.totals.calls, 0);
  // Caps still enforced after reset.
  assert.throws(
    () => b.recordUsage({ inputTokens: 200, outputTokens: 0 }),
    BudgetExceededError,
  );
});

// --- pricing helpers ----------------------------------------------------

test('computeCost matches simple math', () => {
  const cost = computeCost(
    { inputPer1k: 0.003, outputPer1k: 0.015 },
    { inputTokens: 1000, outputTokens: 500 },
  );
  // 1000 × 0.003/1k + 500 × 0.015/1k = 0.003 + 0.0075
  assert.equal(cost.toFixed(6), '0.010500');
});

test('DEFAULT_PRICING is frozen', () => {
  assert.throws(() => {
    DEFAULT_PRICING['claude-sonnet-4-7'] = { inputPer1k: 0, outputPer1k: 0 };
  });
});

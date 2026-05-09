import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AdversarialLoopDetectedError,
  WithBudgetExceededError,
  withBudget,
} from '../src/index.js';

class Throttled extends Error {}
class FatalErr extends Error {}

/** Capture sleep durations instead of actually waiting. */
function makeFakeSleep() {
  /** @type {number[]} */
  const calls = [];
  return {
    calls,
    sleep: async (ms) => {
      calls.push(ms);
    },
  };
}

// --- success path -------------------------------------------------------

test('returns result on first attempt', async () => {
  const wrapped = withBudget(async () => 'ok');
  assert.equal(await wrapped(), 'ok');
});

test('retries retryable errors then succeeds', async () => {
  let calls = 0;
  const fake = makeFakeSleep();
  const wrapped = withBudget(
    async () => {
      calls += 1;
      if (calls < 3) throw new Throttled('rate limited');
      return 'ok';
    },
    { retryOn: [Throttled], sleep: fake.sleep, backoffInitialMs: 1 },
  );
  assert.equal(await wrapped(), 'ok');
  assert.equal(calls, 3);
});

test('does not retry unknown exceptions', async () => {
  let calls = 0;
  const wrapped = withBudget(
    async () => {
      calls += 1;
      throw new TypeError('unknown');
    },
    { retryOn: [Throttled], detectAdversarialLoop: false },
  );
  await assert.rejects(wrapped(), TypeError);
  assert.equal(calls, 1);
});

test('fatal exceptions re-throw immediately', async () => {
  let calls = 0;
  const fake = makeFakeSleep();
  const wrapped = withBudget(
    async () => {
      calls += 1;
      throw new FatalErr('nope');
    },
    {
      retryOn: [Throttled, FatalErr],
      fatalOn: [FatalErr],
      sleep: fake.sleep,
      detectAdversarialLoop: false,
    },
  );
  await assert.rejects(wrapped(), FatalErr);
  assert.equal(calls, 1);
});

// --- attempts budget ----------------------------------------------------

test('attempts budget exhaustion throws WithBudgetExceededError', async () => {
  const fake = makeFakeSleep();
  const wrapped = withBudget(
    async () => {
      throw new Throttled('always');
    },
    {
      maxAttempts: 3,
      retryOn: [Throttled],
      detectAdversarialLoop: false,
      sleep: fake.sleep,
      backoffInitialMs: 1,
    },
  );
  await assert.rejects(wrapped(), (err) => {
    return (
      err instanceof WithBudgetExceededError &&
      err.kind === 'attempts' &&
      err.attempts === 3 &&
      err.lastError instanceof Throttled
    );
  });
});

// --- wall-clock budget --------------------------------------------------

test('wall-clock budget short-circuits retries', async () => {
  // Use a fake sleep that advances a virtual clock so we don't wait real time.
  let virtualMs = 0;
  const sleep = async (ms) => {
    virtualMs += ms;
  };

  // Patch performance.now so withBudget reads our virtual clock.
  const origNow = performance.now;
  performance.now = () => virtualMs;

  try {
    const wrapped = withBudget(
      async () => {
        virtualMs += 30;
        throw new Throttled('slow');
      },
      {
        maxAttempts: 100,
        maxWallClockMs: 100,
        retryOn: [Throttled],
        detectAdversarialLoop: false,
        backoffInitialMs: 5,
        sleep,
      },
    );
    await assert.rejects(wrapped(), (err) => {
      return err instanceof WithBudgetExceededError && err.kind === 'wallClockMs';
    });
  } finally {
    performance.now = origNow;
  }
});

// --- cost budget --------------------------------------------------------

test('cost budget enforced after successful call', async () => {
  const wrapped = withBudget(
    async () => ({ cost: 0.1 }),
    {
      maxAttempts: 3,
      maxCostUsd: 0.05,
      costExtractor: (r) => r.cost,
    },
  );
  await assert.rejects(wrapped(), (err) => {
    return (
      err instanceof WithBudgetExceededError &&
      err.kind === 'costUsd' &&
      err.observed === 0.1
    );
  });
});

test('cost budget passes when under limit', async () => {
  const wrapped = withBudget(
    async () => ({ cost: 0.01, data: 'ok' }),
    { maxCostUsd: 1, costExtractor: (r) => r.cost },
  );
  const r = await wrapped();
  assert.deepEqual(r, { cost: 0.01, data: 'ok' });
});

test('cost extractor that throws is treated as zero', async () => {
  const wrapped = withBudget(
    async () => 'r',
    {
      maxCostUsd: 1,
      costExtractor: () => {
        throw new Error('extractor crashed');
      },
    },
  );
  // Should not throw — extractor errors are swallowed and cost stays 0.
  assert.equal(await wrapped(), 'r');
});

// --- adversarial loop detection ----------------------------------------

test('adversarial loop detected after threshold consecutive identical errors', async () => {
  const fake = makeFakeSleep();
  const wrapped = withBudget(
    async () => {
      throw new Throttled('always identical');
    },
    {
      maxAttempts: 10,
      retryOn: [Throttled],
      adversarialThreshold: 3,
      sleep: fake.sleep,
      backoffInitialMs: 1,
    },
  );
  await assert.rejects(wrapped(), (err) => {
    return (
      err instanceof AdversarialLoopDetectedError &&
      err.repetitions === 3 &&
      err.fingerprint.includes('Throttled')
    );
  });
});

test('adversarial detection can be disabled', async () => {
  const fake = makeFakeSleep();
  const wrapped = withBudget(
    async () => {
      throw new Throttled('identical');
    },
    {
      maxAttempts: 4,
      retryOn: [Throttled],
      detectAdversarialLoop: false,
      sleep: fake.sleep,
      backoffInitialMs: 1,
    },
  );
  // Without adversarial detection, hits attempts budget (not the loop detector)
  await assert.rejects(wrapped(), (err) => {
    return err instanceof WithBudgetExceededError && err.kind === 'attempts';
  });
});

test('adversarial counter resets when error message changes', async () => {
  let i = 0;
  const fake = makeFakeSleep();
  const wrapped = withBudget(
    async () => {
      i += 1;
      throw new Throttled(`variant ${i % 2}`);
    },
    {
      maxAttempts: 6,
      retryOn: [Throttled],
      adversarialThreshold: 3,
      sleep: fake.sleep,
      backoffInitialMs: 1,
    },
  );
  // Alternating fingerprints → never 3 in a row → attempts budget instead
  await assert.rejects(wrapped(), (err) => {
    return err instanceof WithBudgetExceededError && err.kind === 'attempts';
  });
});

// --- onAttempt hooks ---------------------------------------------------

test('onAttempt receives lifecycle events', async () => {
  /** @type {any[]} */
  const events = [];
  let calls = 0;
  const fake = makeFakeSleep();
  const wrapped = withBudget(
    async () => {
      calls += 1;
      if (calls < 2) throw new Throttled('retry me');
      return 'ok';
    },
    {
      maxAttempts: 3,
      retryOn: [Throttled],
      onAttempt: (evt) => events.push(evt),
      sleep: fake.sleep,
      backoffInitialMs: 1,
    },
  );
  assert.equal(await wrapped(), 'ok');
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes('start'));
  assert.ok(kinds.includes('retry'));
  assert.ok(kinds.includes('success'));
});

test('onAttempt cumulative metadata is correct on failure', async () => {
  /** @type {any[]} */
  const events = [];
  const fake = makeFakeSleep();
  const wrapped = withBudget(
    async () => {
      throw new Throttled('x');
    },
    {
      maxAttempts: 2,
      retryOn: [Throttled],
      detectAdversarialLoop: false,
      onAttempt: (evt) => events.push(evt),
      sleep: fake.sleep,
      backoffInitialMs: 1,
    },
  );
  await assert.rejects(wrapped());
  const failure = events.find((e) => e.kind === 'failure');
  assert.ok(failure);
  assert.equal(failure.attempt, 2);
  assert.ok(failure.lastError instanceof Throttled);
  assert.ok(failure.cumulativeLatencyMs >= 0);
});

test('onAttempt callback exceptions do not break the wrapped call', async () => {
  const wrapped = withBudget(
    async () => 'ok',
    {
      onAttempt: () => {
        throw new Error('hook crashed');
      },
    },
  );
  assert.equal(await wrapped(), 'ok');
});

// --- backoff -----------------------------------------------------------

test('backoff scales geometrically', async () => {
  const fake = makeFakeSleep();
  const wrapped = withBudget(
    async () => {
      throw new Throttled('x');
    },
    {
      maxAttempts: 4,
      retryOn: [Throttled],
      backoffInitialMs: 100,
      backoffMaxMs: 10_000,
      backoffFactor: 2,
      detectAdversarialLoop: false,
      sleep: fake.sleep,
    },
  );
  await assert.rejects(wrapped());
  // 3 retries → 3 sleeps
  assert.equal(fake.calls.length, 3);
  assert.equal(fake.calls[0], 100);
  assert.equal(fake.calls[1], 200);
  assert.equal(fake.calls[2], 400);
});

test('backoff is clamped to backoffMaxMs', async () => {
  const fake = makeFakeSleep();
  const wrapped = withBudget(
    async () => {
      throw new Throttled('x');
    },
    {
      maxAttempts: 5,
      retryOn: [Throttled],
      backoffInitialMs: 1000,
      backoffMaxMs: 1500,
      backoffFactor: 10,
      detectAdversarialLoop: false,
      sleep: fake.sleep,
    },
  );
  await assert.rejects(wrapped());
  for (const ms of fake.calls) {
    assert.ok(ms <= 1500);
  }
});

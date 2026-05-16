/**
 * withBudget — retry-aware decorator for budget-bounded async work.
 *
 * Where ``Budget`` is a post-call accumulator (record usage, throw on cap),
 * ``withBudget`` wraps a callable with retry + classification + adversarial
 * loop detection. Together they cover the two common LLM failure modes:
 *
 *   1. Steady-state cost drift — `Budget` catches it post-hoc.
 *   2. A single call retrying forever — `withBudget` catches it before the
 *      provider bills you to oblivion.
 *
 * Why exist when `tenacity`-shaped libs are everywhere on npm:
 *   - ``p-retry`` / ``async-retry`` are generic. No LLM cost cap, no
 *     adversarial-loop detection, no structured per-attempt event taxonomy.
 *   - The OpenAI / Anthropic SDK ``maxRetries`` is just an integer.
 *   - Instructor's retry hook (jxnl/instructor#2222) doesn't expose
 *     ``attemptNumber`` / cumulative state — can't distinguish a retryable
 *     mid-flight failure from a final one.
 *
 * @example
 *   const wrapped = withBudget(callLlm, {
 *     maxAttempts: 5,
 *     maxCostUsd: 0.10,
 *     maxWallClockMs: 30_000,
 *     retryOn: [RateLimitError, ApiTimeoutError],
 *     fatalOn: [ContentPolicyError],
 *     costExtractor: (r) => r.usage.cost_usd,
 *     onAttempt: (evt) => log.info(evt),
 *   });
 *   const result = await wrapped(prompt);
 */

import { AdversarialLoopDetectedError } from './errors.js';
import { classifyException, fingerprintException } from './classify.js';

/**
 * Thrown when ``withBudget`` exhausts a non-cost budget (attempts or
 * wall-clock). Distinct from ``BudgetExceededError`` (which is owned by
 * the ``Budget`` class) so callers can tell "post-call dollars exceeded"
 * apart from "we ran out of retries".
 */
export class WithBudgetExceededError extends Error {
  /**
   * @param {object} info
   * @param {'attempts' | 'wallClockMs' | 'costUsd'} info.kind
   * @param {number} info.limit
   * @param {number} info.observed
   * @param {number} info.attempts
   * @param {unknown} [info.lastError]
   */
  constructor(info) {
    super(
      `agentbudget: withBudget ${info.kind} budget exceeded — observed ${info.observed} > limit ${info.limit} ` +
        `after ${info.attempts} attempt(s)`,
    );
    this.name = 'WithBudgetExceededError';
    this.kind = info.kind;
    this.limit = info.limit;
    this.observed = info.observed;
    this.attempts = info.attempts;
    this.lastError = info.lastError;
  }
}

/**
 * Wrap an async function with retry + budget + adversarial detection.
 *
 * On exception:
 *   - If in ``fatalOn``: re-throw immediately.
 *   - If in ``retryOn``: retry with exponential backoff (clamped to
 *     remaining wall-clock budget) until ``maxAttempts`` /
 *     ``maxWallClockMs`` exhausts — then ``WithBudgetExceededError``.
 *   - Anything else (``unknown``): re-throw. Unknown exceptions are never
 *     blindly retried.
 *
 * On success: ``costExtractor(result)`` (if provided) is added to the
 * cumulative cost; if cumulative > ``maxCostUsd``, throws
 * ``WithBudgetExceededError``.
 *
 * Adversarial detection: if the same ``fingerprintException`` repeats
 * ``adversarialThreshold`` times in a row (default 3), throws
 * ``AdversarialLoopDetectedError`` instead of continuing.
 *
 * @template {(...args: any[]) => Promise<any>} F
 * @param {F} fn
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts=5]
 * @param {number} [opts.maxCostUsd]
 * @param {number} [opts.maxWallClockMs]
 * @param {ReadonlyArray<Function>} [opts.retryOn=[]]
 * @param {ReadonlyArray<Function>} [opts.fatalOn=[]]
 * @param {(result: Awaited<ReturnType<F>>) => number} [opts.costExtractor]
 * @param {boolean} [opts.detectAdversarialLoop=true]
 * @param {number} [opts.adversarialThreshold=3]
 * @param {number} [opts.backoffInitialMs=500]
 * @param {number} [opts.backoffMaxMs=30000]
 * @param {number} [opts.backoffFactor=2]
 * @param {(evt: AttemptEvent) => void} [opts.onAttempt]
 * @param {(ms: number) => Promise<void>} [opts.sleep]
 *   Override sleep for testing. Defaults to a Promise-wrapped setTimeout.
 * @returns {F}
 */
export function withBudget(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 5;
  const maxCostUsd = opts.maxCostUsd;
  const maxWallClockMs = opts.maxWallClockMs;
  const retryOn = opts.retryOn ?? [];
  const fatalOn = opts.fatalOn ?? [];
  const costExtractor = opts.costExtractor;
  const detectAdversarial = opts.detectAdversarialLoop !== false;
  const adversarialThreshold = opts.adversarialThreshold ?? 3;
  const backoffInitialMs = opts.backoffInitialMs ?? 500;
  const backoffMaxMs = opts.backoffMaxMs ?? 30_000;
  const backoffFactor = opts.backoffFactor ?? 2;
  const onAttempt = opts.onAttempt;
  const sleep = opts.sleep ?? defaultSleep;

  return /** @type {F} */ (
    async (/** @type {any[]} */ ...args) => {
      const started = monotonicMs();
      let cumulativeCostUsd = 0;
      let attempt = 0;
      let lastFingerprint = null;
      let consecutiveIdentical = 0;
      let backoffMs = backoffInitialMs;

      emit({
        kind: 'start',
        attempt: 0,
        cumulativeCostUsd: 0,
        cumulativeLatencyMs: 0,
        lastError: undefined,
        errorClassification: 'none',
      });

      // eslint-disable-next-line no-constant-condition
      while (true) {
        attempt += 1;
        const elapsedMs = monotonicMs() - started;
        if (maxWallClockMs != null && elapsedMs >= maxWallClockMs) {
          throw new WithBudgetExceededError({
            kind: 'wallClockMs',
            limit: maxWallClockMs,
            observed: elapsedMs,
            attempts: attempt - 1,
          });
        }

        try {
          const result = await fn(...args);

          if (costExtractor != null) {
            let delta = 0;
            try {
              delta = Number(costExtractor(result)) || 0;
            } catch {
              delta = 0;
            }
            cumulativeCostUsd += delta;
            if (maxCostUsd != null && cumulativeCostUsd > maxCostUsd) {
              throw new WithBudgetExceededError({
                kind: 'costUsd',
                limit: maxCostUsd,
                observed: cumulativeCostUsd,
                attempts: attempt,
              });
            }
          }

          emit({
            kind: 'success',
            attempt,
            cumulativeCostUsd,
            cumulativeLatencyMs: monotonicMs() - started,
            lastError: undefined,
            errorClassification: 'none',
          });
          return result;
        } catch (err) {
          // WithBudgetExceededError thrown above is final.
          if (err instanceof WithBudgetExceededError) {
            emit({
              kind: 'failure',
              attempt,
              cumulativeCostUsd,
              cumulativeLatencyMs: monotonicMs() - started,
              lastError: err,
              errorClassification: 'fatal',
            });
            throw err;
          }

          const classification = classifyException(err, { retryOn, fatalOn });
          const fingerprint = fingerprintException(err);

          if (detectAdversarial) {
            if (fingerprint === lastFingerprint) {
              consecutiveIdentical += 1;
            } else {
              consecutiveIdentical = 1;
            }
            lastFingerprint = fingerprint;
            if (consecutiveIdentical >= adversarialThreshold) {
              emit({
                kind: 'failure',
                attempt,
                cumulativeCostUsd,
                cumulativeLatencyMs: monotonicMs() - started,
                lastError: err,
                errorClassification: classification,
              });
              throw new AdversarialLoopDetectedError({
                repetitions: consecutiveIdentical,
                fingerprint,
              });
            }
          }

          if (classification === 'fatal' || classification === 'unknown') {
            emit({
              kind: 'failure',
              attempt,
              cumulativeCostUsd,
              cumulativeLatencyMs: monotonicMs() - started,
              lastError: err,
              errorClassification: classification,
            });
            throw err;
          }

          if (attempt >= maxAttempts) {
            emit({
              kind: 'failure',
              attempt,
              cumulativeCostUsd,
              cumulativeLatencyMs: monotonicMs() - started,
              lastError: err,
              errorClassification: classification,
            });
            throw new WithBudgetExceededError({
              kind: 'attempts',
              limit: maxAttempts,
              observed: attempt,
              attempts: attempt,
              lastError: err,
            });
          }

          emit({
            kind: 'retry',
            attempt,
            cumulativeCostUsd,
            cumulativeLatencyMs: monotonicMs() - started,
            lastError: err,
            errorClassification: classification,
          });

          let sleepMs = Math.min(backoffMs, backoffMaxMs);
          if (maxWallClockMs != null) {
            const remaining = maxWallClockMs - (monotonicMs() - started);
            sleepMs = Math.min(sleepMs, Math.max(0, remaining));
          }
          if (sleepMs > 0) await sleep(sleepMs);
          backoffMs *= backoffFactor;
        }
      }
    }
  );

  function emit(/** @type {AttemptEvent} */ evt) {
    if (onAttempt == null) return;
    try {
      onAttempt(evt);
    } catch {
      // Hooks must not crash the wrapped call.
    }
  }
}

function defaultSleep(/** @type {number} */ ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function monotonicMs() {
  // ``performance.now()`` is monotonic; ``Date.now()`` jumps with NTP.
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * @typedef {object} AttemptEvent
 * @property {'start' | 'retry' | 'success' | 'failure'} kind
 * @property {number} attempt
 *   1-indexed attempt number; 0 only for the ``start`` event.
 * @property {number} cumulativeCostUsd
 *   Sum of cost extracted from successful sub-calls so far.
 * @property {number} cumulativeLatencyMs
 *   Wall-clock ms since the wrapped call began.
 * @property {unknown} [lastError]
 * @property {'retryable' | 'fatal' | 'unknown' | 'none'} errorClassification
 */

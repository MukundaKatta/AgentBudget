import { BudgetExceededError, UnknownPricingError } from './errors.js';
import { DEFAULT_PRICING, computeCost } from './pricing.js';

/**
 * Token + dollar budget for an agent run. Caps are checked **after** each
 * usage is recorded, so the offending call still happens once and then the
 * budget refuses any further work — that matches the most common provider
 * SDK pattern (you only know token counts after the response).
 *
 * Construct one per agent run, share across the calls inside that run.
 *
 * @example
 *   const budget = new Budget({ maxCostUsd: 5, maxTotalTokens: 200_000 });
 *   const resp = await client.messages.create({ ... });
 *   budget.recordUsage({
 *     model: resp.model,
 *     inputTokens: resp.usage.input_tokens,
 *     outputTokens: resp.usage.output_tokens,
 *   });
 */
export class Budget {
  /**
   * @param {object} [opts]
   * @param {number} [opts.maxInputTokens]
   * @param {number} [opts.maxOutputTokens]
   * @param {number} [opts.maxTotalTokens]
   * @param {number} [opts.maxCostUsd]
   * @param {Record<string, {inputPer1k: number, outputPer1k: number}>} [opts.pricing]
   *   Per-model prices. Falls back to DEFAULT_PRICING for unknown models.
   *   Pass your own to override (e.g. when using prompt caching).
   * @param {boolean} [opts.allowUnknownPricing=false]
   *   If true, unknown models are charged $0 instead of throwing. Useful for
   *   preview / experimental models you don't yet have rates for. Only honored
   *   when ``maxCostUsd`` is set — without a cost cap there's nothing to throw on.
   */
  constructor(opts = {}) {
    this.caps = {
      inputTokens: opts.maxInputTokens,
      outputTokens: opts.maxOutputTokens,
      totalTokens: opts.maxTotalTokens,
      costUsd: opts.maxCostUsd,
    };
    // User-supplied pricing wins; we fall back to DEFAULT_PRICING per-lookup
    // so a partial map (just one custom model) still benefits from defaults.
    this.pricing = opts.pricing ?? {};
    this.allowUnknownPricing = Boolean(opts.allowUnknownPricing);

    /** @type {{inputTokens:number,outputTokens:number,totalTokens:number,costUsd:number,calls:number}} */
    this.totals = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      calls: 0,
    };
  }

  /**
   * Pre-flight check — would adding this usage trip a cap? Returns the cap
   * name on overshoot (without mutating totals) or ``null`` if the call is OK.
   * Useful when you want to short-circuit *before* making the LLM call.
   *
   * @param {object} usage
   * @param {string} [usage.model]
   * @param {number} usage.inputTokens
   * @param {number} usage.outputTokens
   * @returns {null | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'costUsd'}
   */
  wouldExceed(usage) {
    const next = this._project(usage);
    return this._firstViolation(next);
  }

  /**
   * Record an LLM call. Throws ``BudgetExceededError`` if any cap is now
   * breached *after* this charge. The call's contribution to totals is kept
   * either way — the throw means "you've overspent, stop scheduling more,"
   * not "this charge didn't happen." Mirrors how provider SDKs work: by the
   * time you have token counts the call already cost money.
   *
   * @param {object} usage
   * @param {string} [usage.model]
   * @param {number} usage.inputTokens
   * @param {number} usage.outputTokens
   * @returns {{inputTokens:number,outputTokens:number,totalTokens:number,costUsd:number,calls:number}}
   *   Snapshot of totals after this call (same shape as ``budget.totals``).
   */
  recordUsage(usage) {
    this._validateUsage(usage);
    const cost = this._costForUsage(usage);

    this.totals.inputTokens += usage.inputTokens;
    this.totals.outputTokens += usage.outputTokens;
    this.totals.totalTokens = this.totals.inputTokens + this.totals.outputTokens;
    this.totals.costUsd += cost;
    this.totals.calls += 1;

    const violated = this._firstViolation(this.totals);
    if (violated) {
      throw new BudgetExceededError({
        cap: violated,
        limit: this.caps[violated],
        attempted: this.totals[violated],
        model: usage.model,
      });
    }
    return { ...this.totals };
  }

  /**
   * Assert there's room for at least ``estimate`` more tokens *before*
   * making the call. Useful for batch-ish tasks where you can split work.
   *
   * @param {{inputTokens?: number, outputTokens?: number, model?: string}} estimate
   */
  assertCanSpend(estimate) {
    const usage = {
      model: estimate.model,
      inputTokens: estimate.inputTokens ?? 0,
      outputTokens: estimate.outputTokens ?? 0,
    };
    const next = this._project(usage);
    const violated = this._firstViolation(next);
    if (violated) {
      throw new BudgetExceededError({
        cap: violated,
        limit: this.caps[violated],
        attempted: next[violated],
        model: usage.model,
      });
    }
  }

  /**
   * Wrap an async function so its return value's ``.usage`` is auto-recorded
   * after every successful call. Mirrors the Anthropic + OpenAI response
   * shape — pass an ``extractUsage`` to adapt for other providers.
   *
   * @template {(...args: any[]) => Promise<any>} F
   * @param {F} fn
   * @param {object} [opts]
   * @param {(result: Awaited<ReturnType<F>>) => {model?: string, inputTokens: number, outputTokens: number}} [opts.extractUsage]
   * @returns {F}
   */
  wrap(fn, opts = {}) {
    const extract = opts.extractUsage ?? defaultExtractUsage;
    // ``any`` here is fine — the public type lives in index.d.ts and pins F.
    return /** @type {F} */ (async (...args) => {
      const result = await fn(...args);
      const usage = extract(result);
      if (usage) this.recordUsage(usage);
      return result;
    });
  }

  /**
   * Reset all totals to zero. Caps and pricing are preserved.
   */
  reset() {
    this.totals = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      calls: 0,
    };
  }

  /**
   * @returns {{
   *   inputTokens?: {used: number, limit: number, remaining: number},
   *   outputTokens?: {used: number, limit: number, remaining: number},
   *   totalTokens?: {used: number, limit: number, remaining: number},
   *   costUsd?: {used: number, limit: number, remaining: number},
   *   calls: number,
   * }}
   */
  remaining() {
    /** @type {any} */
    const out = { calls: this.totals.calls };
    for (const cap of /** @type {const} */ (
      ['inputTokens', 'outputTokens', 'totalTokens', 'costUsd']
    )) {
      const limit = this.caps[cap];
      if (limit === undefined) continue;
      const used = this.totals[cap];
      out[cap] = { used, limit, remaining: limit - used };
    }
    return out;
  }

  // --- internals -----------------------------------------------------------

  /** Hypothetical totals if ``usage`` were applied. Doesn't mutate. */
  _project(usage) {
    const cost = this._costForUsage(usage);
    const inputTokens = this.totals.inputTokens + usage.inputTokens;
    const outputTokens = this.totals.outputTokens + usage.outputTokens;
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costUsd: this.totals.costUsd + cost,
    };
  }

  _firstViolation(totals) {
    for (const cap of /** @type {const} */ (
      ['inputTokens', 'outputTokens', 'totalTokens', 'costUsd']
    )) {
      const limit = this.caps[cap];
      if (limit !== undefined && totals[cap] > limit) {
        return cap;
      }
    }
    return null;
  }

  _costForUsage(usage) {
    if (this.caps.costUsd === undefined) {
      // No cost cap → no need to compute, no need to throw on missing rates.
      return 0;
    }
    const model = usage.model;
    const rate = this._lookupRate(model);
    if (!rate) {
      if (this.allowUnknownPricing) return 0;
      throw new UnknownPricingError(model ?? '<unknown>');
    }
    return computeCost(rate, usage);
  }

  _lookupRate(model) {
    if (!model) return null;
    return this.pricing[model] ?? DEFAULT_PRICING[model] ?? null;
  }

  _validateUsage(usage) {
    if (!usage || typeof usage !== 'object') {
      throw new TypeError('agentbudget: usage must be an object');
    }
    for (const key of /** @type {const} */ (['inputTokens', 'outputTokens'])) {
      const v = usage[key];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        throw new TypeError(`agentbudget: usage.${key} must be a non-negative finite number`);
      }
    }
  }
}

/**
 * Default extractor for ``Budget#wrap`` — knows the Anthropic + OpenAI shapes
 * (``result.usage.{input,output}_tokens`` for Anthropic;
 * ``result.usage.{prompt,completion}_tokens`` for OpenAI). Returns ``null`` if
 * neither matches, so wrapped functions whose responses don't carry usage
 * (mocks, cached results) silently no-op rather than throwing.
 */
function defaultExtractUsage(result) {
  if (!result || typeof result !== 'object') return null;
  const u = /** @type {any} */ (result).usage;
  if (!u) return null;
  // Anthropic
  if (typeof u.input_tokens === 'number' && typeof u.output_tokens === 'number') {
    return {
      model: result.model,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
    };
  }
  // OpenAI
  if (typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number') {
    return {
      model: result.model,
      inputTokens: u.prompt_tokens,
      outputTokens: u.completion_tokens,
    };
  }
  return null;
}

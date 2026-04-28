/**
 * Thrown by Budget#recordUsage / Budget#assertCanSpend when a cap is hit.
 *
 * Carries the offending cap (so callers can build human messages without
 * re-checking the budget) plus the totals as of *after* the rejected charge
 * was theoretically applied — that's the most useful debug output.
 */
export class BudgetExceededError extends Error {
  /**
   * @param {object} info
   * @param {'inputTokens'|'outputTokens'|'totalTokens'|'costUsd'} info.cap
   * @param {number} info.limit
   * @param {number} info.attempted   total *after* the charge that triggered the throw
   * @param {string=} info.model
   */
  constructor(info) {
    const overshoot = info.attempted - info.limit;
    super(
      `agentbudget: ${info.cap} cap exceeded — limit ${info.limit}, attempted ${info.attempted} ` +
        `(over by ${overshoot.toFixed(info.cap === 'costUsd' ? 4 : 0)})` +
        (info.model ? ` on model "${info.model}"` : ''),
    );
    this.name = 'BudgetExceededError';
    this.cap = info.cap;
    this.limit = info.limit;
    this.attempted = info.attempted;
    this.overshoot = overshoot;
    this.model = info.model;
  }
}

/**
 * Thrown when Budget#recordUsage gets a model that has no pricing entry and
 * the budget has a costUsd cap (so we'd otherwise silently drift past the
 * dollar ceiling). Never thrown if costUsd is undefined.
 */
export class UnknownPricingError extends Error {
  /** @param {string} model */
  constructor(model) {
    super(
      `agentbudget: no pricing entry for model "${model}" but a costUsd cap is set. ` +
        'Add it to the budget\'s `pricing` map, or remove the costUsd cap.',
    );
    this.name = 'UnknownPricingError';
    this.model = model;
  }
}

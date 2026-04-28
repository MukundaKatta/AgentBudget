/**
 * agentbudget — token + dollar caps for AI agents.
 *
 * Public surface:
 *   - Budget                  the main class — track usage, throw on overage
 *   - BudgetExceededError     thrown when a cap is breached
 *   - UnknownPricingError     thrown when costUsd is set but a model has no rate
 *   - DEFAULT_PRICING         starter rate table (Claude + GPT)
 *   - computeCost             utility: dollars for a single (rate, usage) pair
 */

export { Budget } from './budget.js';
export { BudgetExceededError, UnknownPricingError } from './errors.js';
export { DEFAULT_PRICING, computeCost } from './pricing.js';
export { VERSION } from './version.js';

/**
 * agentbudget — token + dollar caps for AI agents.
 *
 * Public surface:
 *
 *   Post-call accounting (the original Budget class):
 *     - Budget                       the main class — track usage, throw on overage
 *     - BudgetExceededError          thrown when a Budget cap is breached
 *     - UnknownPricingError          thrown when costUsd is set but a model has no rate
 *     - DEFAULT_PRICING              starter rate table (Claude + GPT)
 *     - computeCost                  utility: dollars for a single (rate, usage) pair
 *
 *   Retry-aware decoration (added in v0.2):
 *     - withBudget                   wrap an async fn with retry + budget + adversarial detection
 *     - WithBudgetExceededError      thrown when withBudget exhausts attempts/wall-clock/cost
 *     - AdversarialLoopDetectedError thrown when the same exception fingerprint repeats N times
 *     - classifyException            classify an error against retryOn/fatalOn sets
 *     - fingerprintException         stable per-error fingerprint for loop detection
 */

export { Budget } from './budget.js';
export {
  AdversarialLoopDetectedError,
  BudgetExceededError,
  UnknownPricingError,
} from './errors.js';
export { DEFAULT_PRICING, computeCost } from './pricing.js';
export { classifyException, fingerprintException } from './classify.js';
export { withBudget, WithBudgetExceededError } from './withBudget.js';
export { VERSION } from './version.js';

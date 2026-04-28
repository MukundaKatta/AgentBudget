/**
 * agentbudget — token + dollar caps for AI agents.
 *
 * Hand-maintained declarations. Source is JS (with JSDoc) so this file is the
 * single source of truth for TypeScript consumers. Keep in sync with src/*.js.
 */

export const VERSION: string;

export type CapName = 'inputTokens' | 'outputTokens' | 'totalTokens' | 'costUsd';

export interface ModelRate {
  inputPer1k: number;
  outputPer1k: number;
}

export interface UsageInput {
  model?: string;
  inputTokens: number;
  outputTokens: number;
}

export interface BudgetOptions {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTotalTokens?: number;
  maxCostUsd?: number;
  pricing?: Record<string, ModelRate>;
  /**
   * If true, calls against unknown models are charged $0 instead of throwing
   * UnknownPricingError. Only honored when ``maxCostUsd`` is set.
   */
  allowUnknownPricing?: boolean;
}

export interface Totals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  calls: number;
}

export interface RemainingForCap {
  used: number;
  limit: number;
  remaining: number;
}

export interface RemainingSnapshot {
  inputTokens?: RemainingForCap;
  outputTokens?: RemainingForCap;
  totalTokens?: RemainingForCap;
  costUsd?: RemainingForCap;
  calls: number;
}

export interface WrapOptions<R> {
  /**
   * Adapt a custom provider response into a UsageInput. Default knows the
   * Anthropic (``input_tokens``/``output_tokens``) and OpenAI
   * (``prompt_tokens``/``completion_tokens``) shapes.
   */
  extractUsage?: (result: R) => UsageInput | null;
}

export class Budget {
  constructor(opts?: BudgetOptions);
  readonly totals: Totals;
  readonly caps: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUsd?: number;
  };

  /** Throws BudgetExceededError if any cap would be breached after this charge. */
  recordUsage(usage: UsageInput): Totals;

  /** Pre-flight check — returns the violated cap name or null. Doesn't mutate. */
  wouldExceed(usage: UsageInput): CapName | null;

  /** Pre-flight assert — throws BudgetExceededError if the projection trips a cap. */
  assertCanSpend(estimate: Partial<UsageInput>): void;

  /** Wrap an async LLM call so its usage is recorded automatically. */
  wrap<F extends (...args: any[]) => Promise<any>>(
    fn: F,
    opts?: WrapOptions<Awaited<ReturnType<F>>>,
  ): F;

  /** Reset totals to zero. Caps and pricing are preserved. */
  reset(): void;

  /** Per-cap snapshot of {used, limit, remaining}. Skips caps that aren't set. */
  remaining(): RemainingSnapshot;
}

export class BudgetExceededError extends Error {
  readonly name: 'BudgetExceededError';
  readonly cap: CapName;
  readonly limit: number;
  readonly attempted: number;
  readonly overshoot: number;
  readonly model?: string;
}

export class UnknownPricingError extends Error {
  readonly name: 'UnknownPricingError';
  readonly model: string;
}

/** Built-in starter rates (verify with the provider before billing-critical use). */
export const DEFAULT_PRICING: Readonly<Record<string, ModelRate>>;

/** USD cost for a single (rate, usage) pair. */
export function computeCost(
  rate: ModelRate,
  usage: { inputTokens: number; outputTokens: number },
): number;

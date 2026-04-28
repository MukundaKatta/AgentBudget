/**
 * A small starter pricing table — covers the most common Anthropic / OpenAI
 * production models as of early 2026. **Always verify with the provider's
 * current pricing page before relying on this for billing-critical work.**
 *
 * Format: dollars per 1,000 tokens.
 *
 * Cache + batch tiers are *not* modeled here on purpose — that's a per-account
 * configuration choice. If you use prompt caching, pass your own pricing map
 * with the cached input rate baked in.
 */
export const DEFAULT_PRICING = Object.freeze({
  // --- Anthropic (Claude) ---
  'claude-opus-4-5': { inputPer1k: 0.015, outputPer1k: 0.075 },
  'claude-sonnet-4-7': { inputPer1k: 0.003, outputPer1k: 0.015 },
  'claude-haiku-4-5': { inputPer1k: 0.0008, outputPer1k: 0.004 },

  // --- OpenAI ---
  'gpt-4o': { inputPer1k: 0.0025, outputPer1k: 0.01 },
  'gpt-4o-mini': { inputPer1k: 0.00015, outputPer1k: 0.0006 },
  'o1': { inputPer1k: 0.015, outputPer1k: 0.06 },
  'o1-mini': { inputPer1k: 0.003, outputPer1k: 0.012 },
});

/**
 * Compute USD cost for a single LLM call.
 *
 * @param {{inputPer1k: number, outputPer1k: number}} rate
 * @param {{inputTokens: number, outputTokens: number}} usage
 * @returns {number}
 */
export function computeCost(rate, usage) {
  return (
    (rate.inputPer1k * usage.inputTokens) / 1000 +
    (rate.outputPer1k * usage.outputTokens) / 1000
  );
}

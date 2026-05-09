/**
 * Exception classification helpers for ``withBudget``.
 *
 * Splitting these out so callers can reuse the same logic outside the
 * retry decorator (e.g. on a synchronous bare ``try/catch``).
 */

/**
 * Classify an error against caller-supplied retryable / fatal sets.
 *
 * Precedence: ``fatalOn`` beats ``retryOn``. An error in neither set is
 * classified ``"unknown"`` and ``withBudget`` re-raises it — never blindly
 * retrying. Always passing classification through here lands a
 * human-readable category in the AttemptEvent emitted to ``onAttempt``.
 *
 * @param {unknown} err
 * @param {object} [opts]
 * @param {ReadonlyArray<Function>} [opts.retryOn]
 * @param {ReadonlyArray<Function>} [opts.fatalOn]
 * @returns {'retryable' | 'fatal' | 'unknown'}
 */
export function classifyException(err, opts = {}) {
  const fatalOn = opts.fatalOn ?? [];
  const retryOn = opts.retryOn ?? [];
  for (const C of fatalOn) {
    if (err instanceof C) return 'fatal';
  }
  for (const C of retryOn) {
    if (err instanceof C) return 'retryable';
  }
  return 'unknown';
}

/**
 * Produce a short stable fingerprint for adversarial-loop detection.
 *
 * Combines ``err.constructor.name`` with the first 200 chars of
 * ``err.message``. Two retries with the same fingerprint indicate the LLM
 * is producing the same failure repeatedly — Instructor #2056's
 * retry-amplification pattern.
 *
 * @param {unknown} err
 * @returns {string}
 */
export function fingerprintException(err) {
  const ctor = err && /** @type {any} */ (err).constructor;
  const name = ctor?.name ?? typeof err;
  const msg = err && /** @type {any} */ (err).message != null
    ? String(/** @type {any} */ (err).message)
    : String(err);
  return `${name}:${msg.slice(0, 200)}`;
}

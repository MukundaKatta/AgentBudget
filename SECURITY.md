# Security Policy

## Supported Versions

agentbudget is at v0.1.x. Security fixes will be issued for the current minor (0.1.x). Older minors will not receive backports.

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅        |

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately by emailing `mukunda.vjcs6@gmail.com` with the subject `[agentbudget security]`. Include:

- A description of the vulnerability and its impact.
- The version of agentbudget affected (`npm ls @mukundakatta/agentbudget`).
- Reproduction steps or a minimal proof-of-concept.
- Any suggested mitigation, if you have one.

You can expect:

- An acknowledgment within 5 business days.
- A status update within 14 days.
- A coordinated disclosure window of at most 90 days from the acknowledgment.

## Specific Risk Surfaces

agentbudget is a small, pure-JavaScript library with zero runtime dependencies. Its single job is to throw `BudgetExceededError` when an LLM call would push past a configured token or dollar ceiling. Areas worth special attention:

- **Budget bypass.** The whole library is the gate. If you find an input or sequence of `add(...)` calls where a ceiling can be exceeded without throwing, that's a high-severity report.
- **Pricing-table tampering.** `DEFAULT_PRICING` is `Object.freeze`'d. If you can mutate it (prototype pollution, structured-clone tricks, etc.) and influence cost calculation in a long-lived process, please report.
- **Floating-point gaming.** Cost is `(usage × rate) / 1_000_000`. Inputs designed to underflow / round-to-zero (e.g. `Number.MIN_VALUE` tokens, `Number.EPSILON` rates) shouldn't let a caller drive the running total backward. Report if they do.
- **Numeric overflow.** Very large token counts can move into the IEEE-754 imprecision range. If you find a value where the running cap silently stops being enforced (the cap is finite, the running sum is not), that's worth reporting.
- **Custom pricing injection.** Users can pass their own pricing table to `Budget`. If a maliciously crafted pricing entry (`__proto__`, getter functions, etc.) can execute attacker-controlled code at compute time, please report.

## Out of scope

- **Provider API key handling.** This library never sees an API key. It accepts usage numbers the caller provides after a request returns. If your secrets are leaking, that's a host or transport issue, not an agentbudget issue.
- **Rate-limit advisory.** agentbudget does not throttle, queue, or retry. It enforces a ceiling and throws. (For retry + adversarial-loop detection on top of this, see the v0.2 work on the `add-retry-and-adversarial-loop-detection` branch.)
- **Network traffic.** The library performs no I/O. There is nothing to MITM.

## Dependencies

agentbudget has **zero** runtime dependencies, by design. Any future addition is reviewed for security impact and dependency confusion risk; the policy is "do not add a runtime dependency without an open-issue discussion first."

We will not pay bug bounties at this time.

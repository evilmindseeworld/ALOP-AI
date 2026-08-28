'use strict';

/**
 * A GENERAL TRADE-OFF CONTRACT for writers that answer from one or more
 * independent drafts.
 *
 * This is intentionally a writing instruction, not a detector for a question
 * or a vocabulary list. The writer decides whether it applies from the
 * question and the drafts in front of it; the server does not classify the
 * answer after the fact.
 */
const TRADEOFF_GUIDANCE = `

TRADE-OFF DISCIPLINE:
When a question weighs adding models, steps, options, or other effort, give a balanced analysis. Explain the marginal benefit — what new independent evidence, error detection, or coverage the extra effort could add — and the marginal cost, including redundant or duplicate reasoning, diminishing returns, latency, cost, and operational complexity. Say when the extra effort is worthwhile and when it is not. Preserve material counterarguments from the responses; never turn a trade-off question into a one-sided recommendation.`;

module.exports = { TRADEOFF_GUIDANCE };

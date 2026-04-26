/**
 * Token Optimizer Plugin — Cost Estimator
 *
 * Estimates LLM API call costs based on token counts and a built-in
 * pricing table.  All prices are in USD per 1,000,000 tokens.
 *
 * Model identification uses:
 *  1. Exact match (case-insensitive).
 *  2. Longest-prefix substring match (most-specific-first).
 *  3. Fallback to 'default' pricing.
 *
 * Pricing sourced from official provider documentation (April 2026).
 * Values are kept intentionally conservative (list price, no discount tier).
 */

/**
 * Pricing table: cost in USD per 1 000 000 tokens.
 * Format: { input: <$/1M>, output: <$/1M> }
 *
 * @type {Record<string, {input: number, output: number}>}
 */
export const PRICING = {
    // ── Google Gemini ────────────────────────────────────────────────────────
    'gemini-1.5-flash':        { input: 0.075,   output: 0.30  },
    'gemini-1.5-flash-8b':     { input: 0.0375,  output: 0.15  },
    'gemini-1.5-pro':          { input: 1.25,    output: 5.00  },
    'gemini-2.0-flash':        { input: 0.10,    output: 0.40  },
    'gemini-2.0-flash-lite':   { input: 0.075,   output: 0.30  },
    'gemini-2.5-flash':        { input: 0.15,    output: 0.60  },
    'gemini-2.5-pro':          { input: 1.25,    output: 10.0  },
    'gemini-3.0-pro':          { input: 1.25,    output: 10.0  },
    'gemini-flash':            { input: 0.10,    output: 0.40  }, // alias
    'gemini-pro':              { input: 1.25,    output: 5.00  }, // alias

    // ── Anthropic Claude ─────────────────────────────────────────────────────
    'claude-3-haiku-20240307': { input: 0.25,    output: 1.25  },
    'claude-3-haiku':          { input: 0.25,    output: 1.25  },
    'claude-3-5-haiku':        { input: 0.80,    output: 4.00  },
    'claude-3-sonnet':         { input: 3.00,    output: 15.0  },
    'claude-3-5-sonnet':       { input: 3.00,    output: 15.0  },
    'claude-3-opus':           { input: 15.0,    output: 75.0  },
    'claude-sonnet-4':         { input: 3.00,    output: 15.0  },
    'claude-sonnet-4-5':       { input: 3.00,    output: 15.0  },
    'claude-opus-4':           { input: 15.0,    output: 75.0  },
    'claude-opus-4-5':         { input: 15.0,    output: 75.0  },
    'claude-haiku-4':          { input: 0.80,    output: 4.00  },
    'claude-haiku-4-5':        { input: 0.80,    output: 4.00  },

    // ── OpenAI ───────────────────────────────────────────────────────────────
    'gpt-4':                   { input: 30.0,    output: 60.0  },
    'gpt-4-turbo':             { input: 10.0,    output: 30.0  },
    'gpt-4o':                  { input: 2.50,    output: 10.0  },
    'gpt-4o-mini':             { input: 0.15,    output: 0.60  },
    'gpt-3.5-turbo':           { input: 0.50,    output: 1.50  },
    'gpt-3.5-turbo-16k':       { input: 1.00,    output: 2.00  },
    'gpt-5':                   { input: 10.0,    output: 30.0  },
    'gpt-5-mini':              { input: 2.00,    output: 8.00  },
    'o1':                      { input: 15.0,    output: 60.0  },
    'o1-mini':                 { input: 3.00,    output: 12.0  },
    'o3-mini':                 { input: 1.10,    output: 4.40  },
    'o4-mini':                 { input: 1.10,    output: 4.40  },
    'codex':                   { input: 3.00,    output: 12.0  },

    // ── Alibaba Qwen ─────────────────────────────────────────────────────────
    'qwen2.5-coder':           { input: 0.50,    output: 1.50  },
    'qwen-max':                { input: 2.40,    output: 9.60  },
    'qwen-plus':               { input: 0.40,    output: 1.20  },
    'qwen-turbo':              { input: 0.05,    output: 0.20  },
    'qwen3':                   { input: 0.38,    output: 1.10  },

    // ── xAI Grok ─────────────────────────────────────────────────────────────
    'grok-2':                  { input: 2.00,    output: 10.0  },
    'grok-3':                  { input: 3.00,    output: 15.0  },
    'grok-3-fast':             { input: 5.00,    output: 25.0  },
    'grok-3-mini':             { input: 0.30,    output: 0.50  },
    'grok-4':                  { input: 3.00,    output: 15.0  },

    // ── Moonshot / Kimi ───────────────────────────────────────────────────────
    'kimi-k2':                 { input: 2.00,    output: 8.00  },
    'moonshot-v1':             { input: 2.00,    output: 8.00  },

    // ── Default fallback ─────────────────────────────────────────────────────
    'default':                 { input: 1.00,    output: 3.00  },
};

// Pre-sort keys by length (longest first) for best-prefix matching
const _SORTED_KEYS = Object.keys(PRICING)
    .filter(k => k !== 'default')
    .sort((a, b) => b.length - a.length);

/**
 * Look up the pricing entry for a given model identifier.
 *
 * Resolution order:
 *  1. Exact match (lowercased)
 *  2. Substring match with longest key winning (e.g. "claude-3-5-sonnet-20241022" → "claude-3-5-sonnet")
 *  3. "default" fallback
 *
 * @param {string} model
 * @returns {{input: number, output: number}}
 */
export function getPricing(model) {
    if (!model) return PRICING.default;

    const lc = model.toLowerCase().trim();

    if (PRICING[lc]) return PRICING[lc];

    for (const key of _SORTED_KEYS) {
        if (lc.includes(key)) return PRICING[key];
    }

    return PRICING.default;
}

/**
 * Estimate the USD cost of a single API call.
 *
 * @param {string} model          - Model identifier
 * @param {number} inputTokens    - Prompt / input tokens
 * @param {number} outputTokens   - Completion / output tokens
 * @returns {{
 *   inputCost:  number,
 *   outputCost: number,
 *   totalCost:  number,
 *   currency:   string,
 *   model:      string,
 *   pricing:    {input: number, output: number}
 * }}
 */
export function estimateCost(model, inputTokens, outputTokens) {
    const pricing    = getPricing(model);
    const inputCost  = (Math.max(0, inputTokens)  / 1_000_000) * pricing.input;
    const outputCost = (Math.max(0, outputTokens) / 1_000_000) * pricing.output;

    return {
        inputCost,
        outputCost,
        totalCost: inputCost + outputCost,
        currency:  'USD',
        model,
        pricing,
    };
}

/**
 * Calculate the dollar savings from eliminating a number of input tokens.
 * Useful for reporting how much a single optimization run saved.
 *
 * @param {string} model
 * @param {number} tokensSaved  - Number of input tokens saved
 * @returns {{ costSaved: number, currency: string, tokensSaved: number }}
 */
export function estimateSavings(model, tokensSaved) {
    const pricing  = getPricing(model);
    const costSaved = (Math.max(0, tokensSaved) / 1_000_000) * pricing.input;

    return {
        costSaved,
        currency:    'USD',
        tokensSaved: Math.max(0, tokensSaved),
    };
}

/**
 * Response Quality Scorer — Ensemble Synthesizer
 *
 * Scores each model response on four heuristics to pick the "best" winner
 * in `best` synthesis mode.
 *
 * Inspired by:
 *   - Chatbot Arena (lm-sys/FastChat) — ELO-based quality ranking methodology
 *   - OpenAI Evals (openai/evals) — rubric-based response scoring patterns
 *   - RouteLLM (lm-sys/routellm) — quality evaluation for model dispatch
 */

/** Refusal phrases that indicate a low-quality answer */
const REFUSAL_PATTERNS = [
    /\bI (cannot|can't|am unable to|won't|do not|don't)\b/i,
    /\bAs an AI (language model|assistant)?\b/i,
    /\bI (don't|do not) have (access|information|the ability)\b/i,
    /\bI apologize,? but\b/i,
    /\bI'm sorry,? but\b/i,
    /\bI (must|need to) (decline|refuse)\b/i,
];

/**
 * Score a single response text on 0–1 scale.
 * @param {string} text - The response text to score
 * @param {string} [query] - Optional original user query for relevance scoring
 * @returns {{ total: number, breakdown: object }}
 */
export function scoreResponse(text, query = '') {
    if (!text || typeof text !== 'string') {
        return { total: 0, breakdown: { length: 0, refusal: 0, coherence: 0, relevance: 0 } };
    }

    const trimmed = text.trim();
    const len = trimmed.length;

    // ── 1. Length score (0–1) ──────────────────────────────────────────────────
    // Ideal range: 80–3000 chars. Too short or too long is penalised.
    let lengthScore;
    if (len < 20)        lengthScore = 0.0;
    else if (len < 80)   lengthScore = len / 80 * 0.6;
    else if (len <= 3000) lengthScore = 1.0;
    else                 lengthScore = Math.max(0.5, 1.0 - (len - 3000) / 10000);

    // ── 2. Refusal score (0 = refusal, 1 = no refusal) ────────────────────────
    const hasRefusal = REFUSAL_PATTERNS.some(p => p.test(trimmed));
    const refusalScore = hasRefusal ? 0.0 : 1.0;

    // ── 3. Coherence score (0–1) ───────────────────────────────────────────────
    // Penalise excessive repetition and broken sentences.
    const sentences = trimmed.split(/[.!?]+/).filter(s => s.trim().length > 5);
    let coherenceScore = 1.0;
    if (sentences.length > 2) {
        // Check for repeated consecutive sentences (copy-paste artifacts)
        let repeats = 0;
        for (let i = 1; i < sentences.length; i++) {
            if (sentences[i].trim().toLowerCase() === sentences[i - 1].trim().toLowerCase()) {
                repeats++;
            }
        }
        coherenceScore = Math.max(0, 1.0 - repeats / sentences.length);
    }
    // Penalise if response ends mid-word (truncated)
    if (!/[.!?'"\s)]$/.test(trimmed)) coherenceScore *= 0.85;

    // ── 4. Relevance score (0–1) ───────────────────────────────────────────────
    // Simple keyword overlap between user query and response.
    let relevanceScore = 0.5; // neutral default when no query provided
    if (query && query.length > 5) {
        const queryTokens = new Set(
            query.toLowerCase().split(/\W+/).filter(t => t.length > 3)
        );
        if (queryTokens.size > 0) {
            const responseText = trimmed.toLowerCase();
            let hits = 0;
            for (const token of queryTokens) {
                if (responseText.includes(token)) hits++;
            }
            relevanceScore = Math.min(1.0, hits / queryTokens.size);
        }
    }

    // ── Composite (weighted average) ──────────────────────────────────────────
    const total = (
        lengthScore   * 0.30 +
        refusalScore  * 0.35 +
        coherenceScore * 0.20 +
        relevanceScore * 0.15
    );

    return {
        total: Math.round(total * 1000) / 1000,
        breakdown: {
            length:    Math.round(lengthScore    * 1000) / 1000,
            refusal:   Math.round(refusalScore   * 1000) / 1000,
            coherence: Math.round(coherenceScore * 1000) / 1000,
            relevance: Math.round(relevanceScore * 1000) / 1000,
        },
    };
}

/**
 * Pick the best response from an array of results.
 * @param {Array<{model: string, text: string, latencyMs: number}>} results
 * @param {string} [query]
 * @returns {{ winner: object, scores: object[] }}
 */
export function pickBest(results, query = '') {
    if (!results || results.length === 0) return { winner: null, scores: [] };
    if (results.length === 1) {
        const s = scoreResponse(results[0].text, query);
        return { winner: { ...results[0], score: s.total }, scores: [{ model: results[0].model, ...s }] };
    }

    const scored = results.map(r => ({
        ...r,
        ...scoreResponse(r.text, query),
    }));

    scored.sort((a, b) => b.total - a.total);
    const winner = scored[0];

    return {
        winner: { model: winner.model, text: winner.text, latencyMs: winner.latencyMs, score: winner.total },
        scores: scored.map(s => ({ model: s.model, score: s.total, breakdown: s.breakdown })),
    };
}

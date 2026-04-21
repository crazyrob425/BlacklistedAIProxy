/**
 * Ensemble Synthesizer — Synthesis Engine
 *
 * Implements four synthesis modes that combine N parallel model responses
 * into a single high-confidence reply:
 *
 *  vote  — Majority consensus on the shortest/most common answer
 *  best  — Return the response with the highest quality score (see scorer.js)
 *  merge — Call a lightweight judge model to synthesise all N answers
 *  all   — Return all responses as a structured JSON object
 *
 * Inspired by:
 *  - RouteLLM (lm-sys/routellm) — quality evaluation, model dispatch patterns
 *  - LiteLLM (BerriAI/litellm) — parallel provider fan-out, response aggregation
 *  - Portkey AI Gateway (Portkey-AI/gateway) — multi-provider parallel routing
 */

import { pickBest } from './scorer.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalise a text answer to a canonical form for voting.
 * Strips punctuation, lowercases, trims.
 */
function normalise(text) {
    return text
        .replace(/[^\w\s]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 200); // only compare first 200 chars
}

/**
 * Build an OpenAI-compatible chat completion wrapper around a plain text answer.
 * Preserves the usage stats from the winning raw response when available.
 *
 * @param {string} text
 * @param {string} model
 * @param {object|null} rawResponse
 * @returns {object}
 */
function wrapResponse(text, model, rawResponse = null) {
    const usage = rawResponse?.usage ?? { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    return {
        id:      `ensemble-${Date.now()}`,
        object:  'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model,
        choices: [{
            index:         0,
            message:       { role: 'assistant', content: text },
            finish_reason: 'stop',
        }],
        usage,
        _ensemble: true,
    };
}

// ── Synthesis modes ───────────────────────────────────────────────────────────

/**
 * `best` mode — return the highest-scoring response.
 *
 * @param {Array<{model, text, latencyMs, raw}>} results
 * @param {string} query
 * @returns {{ response: object, meta: object }}
 */
export function synthesiseBest(results, query = '') {
    const successful = results.filter(r => !r.error && r.text);
    if (successful.length === 0) return null;

    const { winner, scores } = pickBest(successful, query);
    return {
        response: wrapResponse(winner.text, winner.model, winner.raw),
        meta: {
            mode:       'best',
            winner:     winner.model,
            score:      winner.score,
            scores,
            models:     results.map(r => r.model),
            latencies:  Object.fromEntries(results.map(r => [r.model, r.latencyMs])),
        },
    };
}

/**
 * `vote` mode — majority consensus by comparing normalised answers.
 * Falls back to `best` when there is no clear majority.
 *
 * @param {Array<{model, text, latencyMs, raw}>} results
 * @param {string} query
 * @returns {{ response: object, meta: object }}
 */
export function synthesiseVote(results, query = '') {
    const successful = results.filter(r => !r.error && r.text);
    if (successful.length === 0) return null;
    if (successful.length === 1) return synthesiseBest(successful, query);

    // Tally votes
    const votes = new Map(); // normalised → { count, result }
    for (const r of successful) {
        const key = normalise(r.text);
        if (votes.has(key)) {
            votes.get(key).count++;
        } else {
            votes.set(key, { count: 1, result: r });
        }
    }

    // Sort by vote count desc
    const sorted = [...votes.values()].sort((a, b) => b.count - a.count);
    const top = sorted[0];

    // No majority (all different) → fall back to best
    if (top.count === 1) return synthesiseBest(successful, query);

    const winner = top.result;
    return {
        response: wrapResponse(winner.text, winner.model, winner.raw),
        meta: {
            mode:       'vote',
            winner:     winner.model,
            votes:      sorted.map(v => ({ count: v.count, model: v.result.model })),
            models:     results.map(r => r.model),
            latencies:  Object.fromEntries(results.map(r => [r.model, r.latencyMs])),
        },
    };
}

/**
 * `all` mode — return every response as a structured object.
 * The client receives a JSON object (not a chat completion) with all N answers.
 *
 * @param {Array<{model, text, latencyMs, raw, error}>} results
 * @returns {{ response: object, meta: object }}
 */
export function synthesiseAll(results) {
    return {
        response: {
            id:      `ensemble-all-${Date.now()}`,
            object:  'ensemble.all',
            created: Math.floor(Date.now() / 1000),
            responses: results.map(r => ({
                model:     r.model,
                text:      r.text,
                latencyMs: r.latencyMs,
                error:     r.error ?? null,
            })),
            _ensemble: true,
        },
        meta: {
            mode:    'all',
            models:  results.map(r => r.model),
            latencies: Object.fromEntries(results.map(r => [r.model, r.latencyMs])),
        },
    };
}

/**
 * `merge` mode — call a judge model to synthesise all answers.
 * Falls back to `best` if the judge call fails.
 *
 * @param {Array<{model, text, latencyMs, raw}>} results
 * @param {string}  query
 * @param {string}  judgeModel
 * @param {Function} callModelFn  — (model, messages) => Promise<string>
 * @returns {Promise<{ response: object, meta: object }>}
 */
export async function synthesiseMerge(results, query, judgeModel, callModelFn) {
    const successful = results.filter(r => !r.error && r.text);
    if (successful.length === 0) return null;
    if (successful.length === 1) return synthesiseBest(successful, query);

    try {
        const answersList = successful
            .map((r, i) => `Answer ${i + 1} (from ${r.model}):\n${r.text}`)
            .join('\n\n---\n\n');

        const mergePrompt = `You are a synthesis assistant. Multiple AI models answered the same question. Your task is to produce one single best answer by combining the most accurate and useful information from all responses. Do NOT mention the models or say things like "Answer 1 says...". Just give the best combined answer directly.\n\nOriginal question: ${query}\n\n${answersList}`;

        const judgeText = await callModelFn(judgeModel, [
            { role: 'user', content: mergePrompt },
        ]);

        return {
            response: wrapResponse(judgeText, judgeModel, null),
            meta: {
                mode:      'merge',
                judge:     judgeModel,
                sources:   successful.map(r => r.model),
                models:    results.map(r => r.model),
                latencies: Object.fromEntries(results.map(r => [r.model, r.latencyMs])),
            },
        };
    } catch {
        // Judge failed → fall back to best
        return synthesiseBest(successful, query);
    }
}

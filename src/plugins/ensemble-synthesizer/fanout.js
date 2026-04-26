/**
 * Ensemble Fan-out Module
 *
 * Dispatches a single AI request to N models in parallel by calling the proxy's
 * own /v1/chat/completions endpoint for each model.  Uses a custom header
 * (X-Ensemble-Internal) to prevent recursive fan-out.
 *
 * Inspired by:
 *   - LiteLLM (BerriAI/litellm) — parallel provider fan-out, response aggregation
 *   - Portkey AI Gateway (Portkey-AI/gateway) — multi-provider parallel routing
 *   - RouteLLM (lm-sys/routellm) — multi-model dispatch patterns
 */

import { request as httpRequest } from 'http';
import logger from '../../utils/logger.js';

/** Header that marks an internal ensemble call — prevents infinite recursion */
export const ENSEMBLE_INTERNAL_HEADER = 'x-ensemble-internal';

/**
 * Extract plain text from an OpenAI-compatible chat completion response body.
 * @param {object} body - Parsed JSON response
 * @returns {string}
 */
function extractText(body) {
    try {
        return body?.choices?.[0]?.message?.content ?? '';
    } catch {
        return '';
    }
}

/**
 * Make a single non-streaming request to the local proxy for a specific model.
 *
 * @param {object} opts
 * @param {number}  opts.port        - Local server port
 * @param {string}  opts.host        - Local server host (default 127.0.0.1)
 * @param {string}  opts.authHeader  - Authorization header value to forward
 * @param {object}  opts.body        - Original request body (will be cloned)
 * @param {string}  opts.model       - Model name to use for this call
 * @param {number}  opts.timeoutMs   - Per-model timeout in milliseconds
 * @returns {Promise<{model: string, text: string, latencyMs: number, raw: object, error: string|null}>}
 */
export function callModel({ port, host = '127.0.0.1', authHeader, body, model, timeoutMs = 15000 }) {
    return new Promise((resolve) => {
        const start = Date.now();
        const payload = JSON.stringify({ ...body, model, stream: false });

        const options = {
            hostname: host,
            port,
            path:     '/v1/chat/completions',
            method:   'POST',
            headers: {
                'Content-Type':         'application/json',
                'Content-Length':       Buffer.byteLength(payload),
                [ENSEMBLE_INTERNAL_HEADER]: '1',
                ...(authHeader ? { 'Authorization': authHeader } : {}),
            },
        };

        const req = httpRequest(options, (res) => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const latencyMs = Date.now() - start;
                try {
                    const raw = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    const text = extractText(raw);
                    resolve({ model, text, latencyMs, raw, error: null });
                } catch (err) {
                    resolve({ model, text: '', latencyMs, raw: null, error: `JSON parse error: ${err.message}` });
                }
            });
            res.on('error', (err) => {
                resolve({ model, text: '', latencyMs: Date.now() - start, raw: null, error: err.message });
            });
        });

        req.on('error', (err) => {
            resolve({ model, text: '', latencyMs: Date.now() - start, raw: null, error: err.message });
        });

        // Hard timeout per model
        const timer = setTimeout(() => {
            req.destroy();
            resolve({ model, text: '', latencyMs: timeoutMs, raw: null, error: 'timeout' });
        }, timeoutMs);

        req.on('close', () => clearTimeout(timer));

        req.write(payload);
        req.end();
    });
}

/**
 * Fan a single request out to multiple models in parallel.
 *
 * @param {object} opts
 * @param {number}   opts.port
 * @param {string}   [opts.host]
 * @param {string}   [opts.authHeader]
 * @param {object}   opts.body          - Original parsed request body
 * @param {string[]} opts.models        - Array of model IDs to fan out to
 * @param {number}   [opts.timeoutMs]
 * @param {number}   [opts.minResponses] - Minimum successful responses required
 * @returns {Promise<Array<{model, text, latencyMs, raw, error}>>}
 */
export async function fanOut({ port, host, authHeader, body, models, timeoutMs = 15000, minResponses = 1 }) {
    if (!models || models.length === 0) return [];

    const results = await Promise.allSettled(
        models.map(model => callModel({ port, host, authHeader, body, model, timeoutMs }))
    );

    const resolved = results.map(r => r.status === 'fulfilled' ? r.value : {
        model: 'unknown', text: '', latencyMs: 0, raw: null, error: r.reason?.message ?? 'unknown error',
    });

    const successful = resolved.filter(r => !r.error && r.text.length > 0);

    if (successful.length < minResponses) {
        logger.warn(`[Ensemble] Only ${successful.length}/${models.length} models responded (min: ${minResponses})`);
    }

    return resolved;
}

/**
 * Langfuse observability bridge (Epic A – optional Langfuse integration)
 *
 * Forwards LLM calls to Langfuse when the required env vars are set.
 * Exports no-op stubs otherwise – call-sites never need null-guards.
 *
 * Required env vars (to enable):
 *   LANGFUSE_SECRET_KEY  – Langfuse secret key
 *   LANGFUSE_PUBLIC_KEY  – Langfuse public key
 *
 * Optional:
 *   LANGFUSE_HOST        – self-hosted URL (default: https://cloud.langfuse.com)
 */

import logger from '../utils/logger.js';

const ENABLED =
    Boolean(process.env.LANGFUSE_SECRET_KEY) &&
    Boolean(process.env.LANGFUSE_PUBLIC_KEY);

let _client = null;

async function getClient() {
    if (!ENABLED) return null;
    if (_client) return _client;
    try {
        const { Langfuse } = await import('langfuse');
        _client = new Langfuse({
            secretKey:  process.env.LANGFUSE_SECRET_KEY,
            publicKey:  process.env.LANGFUSE_PUBLIC_KEY,
            baseUrl:    process.env.LANGFUSE_HOST ?? 'https://cloud.langfuse.com',
            flushAt:    20,
            flushInterval: 10_000,
        });
        logger.info('[Langfuse] Client initialized');
    } catch (err) {
        logger.warn('[Langfuse] Failed to initialize client:', err.message);
    }
    return _client;
}

/**
 * Create a Langfuse trace context for one inbound proxy request.
 * Returns an object with a `generation()` method to record an LLM call
 * and a `flush()` method for graceful shutdown.
 *
 * @param {{ traceId: string, name: string, provider: string, model: string }} opts
 * @returns {Promise<{ generation: Function, flush: Function }>}
 */
export async function langfuseTrace({ traceId, name, provider, model }) {
    const client = await getClient();
    if (!client) return { generation: () => {}, flush: async () => {} };

    const lfTrace = client.trace({
        id:       traceId,
        name,
        metadata: { provider, model },
    });

    return {
        /**
         * Record a single LLM generation within this trace.
         *
         * @param {{ input: any, output: any, model?: string,
         *           usage?: { inputTokens: number, outputTokens: number },
         *           startTime?: Date, endTime?: Date, error?: Error }} g
         */
        generation(g) {
            try {
                lfTrace.generation({
                    name:      `${provider}/${g.model ?? model}`,
                    model:     g.model ?? model,
                    input:     g.input,
                    output:    g.output,
                    startTime: g.startTime,
                    endTime:   g.endTime,
                    usage: g.usage ? {
                        input:  g.usage.inputTokens  ?? 0,
                        output: g.usage.outputTokens ?? 0,
                    } : undefined,
                    level:         g.error ? 'ERROR' : 'DEFAULT',
                    statusMessage: g.error?.message,
                });
            } catch (err) {
                logger.warn('[Langfuse] generation() error:', err.message);
            }
        },
        async flush() {
            try { await client.flushAsync(); } catch { /* best-effort */ }
        },
    };
}

/** Flush all pending Langfuse events.  Call on graceful shutdown. */
export async function langfuseFlush() {
    if (_client) { try { await _client.flushAsync(); } catch { /* best-effort */ } }
}

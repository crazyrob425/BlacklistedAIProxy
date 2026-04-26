/**
 * Token Optimizer Plugin
 *
 * A production-grade plugin for BlacklistedAIProxy that delivers two
 * complementary token-cost reduction strategies:
 *
 *  1. Prompt Cache
 *     Exact-match LRU cache keyed by SHA-256(model + messages).
 *     Identical requests are returned from cache in < 1 ms, completely
 *     bypassing the upstream provider and eliminating all token costs.
 *     Inspired by NadirClaw's PromptCache implementation.
 *
 *  2. Context Optimizer
 *     Transforms message arrays to reduce token count before each API call:
 *       - safe       (lossless): whitespace collapse, JSON minify, dedup-system,
 *                                remove-empty, strip null fields
 *       - aggressive (lossy):    safe + truncate old assistant turns,
 *                                collapse tool results, trim history to 20 turns
 *     Inspired by NadirClaw's context-optimization modes and LangChain's
 *     ConversationTokenBufferMemory trimming strategy.
 *
 * Safety guarantees:
 *  - All exceptions are caught; plugin failures NEVER crash the main server.
 *  - Cache only stores non-streaming (unary) responses.
 *  - Streaming responses are optimized (tokens reduced) but not cached.
 *  - Config updates are validated before being applied.
 *  - Periodic cache TTL sweep prevents stale memory growth.
 *  - All state is scoped to the plugin instance; no global mutations.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

import logger from '../../utils/logger.js';
import { PromptCache }                             from './cache.js';
import { optimizeMessages }                        from './optimizer.js';
import { estimateSavings }                         from './cost-estimator.js';
import { handleTokenOptimizerRoutes, setPluginRef } from './api-routes.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(process.cwd(), 'configs', 'token-optimizer.json');

/** AI generation paths that should be intercepted */
const AI_PATHS = [
    '/v1/chat/completions',
    '/v1/responses',
    '/v1/messages',
];

/** Default plugin configuration */
const DEFAULT_CONFIG = {
    cache: {
        enabled: true,
        maxSize:  500,    // max cached responses
        ttl:      3600,   // seconds (1 hour)
    },
    optimization: {
        mode:    'safe',  // 'off' | 'safe' | 'aggressive'
        enabled: true,
    },
};

// ── Body-reading helper ───────────────────────────────────────────────────────

/**
 * Consume the request stream and return the raw bytes as a Buffer.
 * If the stream is already consumed and `req._rawBody` is set (from a
 * previous middleware), return that directly.
 *
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readRawBody(req) {
    if (req._rawBody) return Promise.resolve(req._rawBody);

    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

// ── Plugin definition ─────────────────────────────────────────────────────────

const tokenOptimizerPlugin = {
    name:        'token-optimizer',
    version:     '1.0.0',
    description: 'Reduces token costs 20–70 % via LRU prompt caching and context optimization (safe / aggressive modes). Dashboard: <a href="token-optimizer.html" target="_blank">token-optimizer.html</a>',
    type:        '_builtin',
    _builtin:    true,
    _priority:   50, // runs after auth (9999) but before most middleware

    /** @type {PromptCache} */
    cache: null,

    /** @private Plugin config merged with defaults */
    _cfg: null,

    /** @private Pending cache entries: requestId → { model, messages } */
    _pending: new Map(),

    /** @private Optimization aggregate stats */
    _stats: {
        totalOptimizations: 0,
        totalTokensSaved:   0,
        totalCostSavedUSD:  0,
        cacheHits:          0,
        cacheMisses:        0,
        streamRequests:     0, // cannot be cached
    },

    /** @private Sweep interval handle */
    _sweepTimer: null,

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async init(config) {
        this._cfg   = this._loadConfig();
        this.cache  = new PromptCache({
            maxSize: this._cfg.cache.maxSize,
            ttl:     this._cfg.cache.ttl,
        });

        // Register this instance with api-routes so REST handlers can reach it
        setPluginRef(this);

        // Periodic TTL sweep (every 10 min) to reclaim stale memory
        this._sweepTimer = setInterval(() => {
            try { this.cache.sweepExpired(); } catch { /* silent */ }
        }, 10 * 60 * 1000);
        if (this._sweepTimer.unref) this._sweepTimer.unref();

        logger.info(`[Token Optimizer] Initialized — cache: ${this._cfg.cache.enabled ? 'ON' : 'OFF'}, ` +
                    `optimization: ${this._cfg.optimization.mode}, ` +
                    `maxSize: ${this._cfg.cache.maxSize}, ttl: ${this._cfg.cache.ttl}s`);
    },

    // ── Middleware (intercept AI requests) ────────────────────────────────────

    /**
     * Middleware hook — runs on every request before the provider is called.
     *
     * For AI generation paths it:
     *   1. Reads the request body from the stream (and caches it in req._rawBody
     *      for downstream getRequestBody() to re-use via the patched common.js).
     *   2. Checks the prompt cache; if HIT, responds immediately and marks handled.
     *   3. If MISS, runs the message optimizer and writes the reduced body back
     *      to req._rawBody so the provider receives the lighter payload.
     */
    async middleware(req, res, requestUrl, config) {
        try {
            // Only intercept POST to AI generation paths
            if (req.method !== 'POST') return { handled: false };
            const isAiPath = AI_PATHS.some(p => requestUrl.pathname.includes(p));
            if (!isAiPath)             return { handled: false };

            // ── Read body ──────────────────────────────────────────────────────
            let rawBuf;
            try {
                rawBuf = await readRawBody(req);
            } catch {
                return { handled: false }; // let downstream handle the error
            }

            // Always cache so downstream getRequestBody() can re-read it
            req._rawBody = rawBuf;

            let body;
            try {
                body = JSON.parse(rawBuf.toString('utf8'));
            } catch {
                return { handled: false }; // bad JSON — let downstream error
            }

            const { model, messages } = body;
            if (!model || !Array.isArray(messages)) return { handled: false };

            const reqId = config._pluginRequestId;

            // ── 1. Cache check ─────────────────────────────────────────────────
            if (this._cfg.cache.enabled && !body.stream) {
                const cached = this.cache.get(model, messages);
                if (cached) {
                    logger.info(`[Token Optimizer] Cache HIT: model=${model} msgs=${messages.length}`);
                    this._stats.cacheHits++;
                    res.writeHead(200, {
                        'Content-Type':                'application/json; charset=utf-8',
                        'X-Token-Optimizer-Cache':     'HIT',
                        'Access-Control-Allow-Origin': '*',
                    });
                    res.end(JSON.stringify(cached));
                    return { handled: true };
                }
                this._stats.cacheMisses++;
                // Store model+messages for later response caching
                if (reqId) {
                    this._pending.set(reqId, { model, messages });
                }
            }

            if (body.stream) {
                this._stats.streamRequests++;
                // Streaming: we can still optimize but cannot cache
            }

            // ── 2. Context optimization ────────────────────────────────────────
            if (this._cfg.optimization.enabled && this._cfg.optimization.mode !== 'off') {
                try {
                    const result = optimizeMessages(messages, this._cfg.optimization.mode);
                    if (result.tokensSaved > 0) {
                        body.messages = result.messages;
                        req._rawBody  = Buffer.from(JSON.stringify(body), 'utf8');

                        // Accumulate stats
                        this._stats.totalTokensSaved   += result.tokensSaved;
                        this._stats.totalOptimizations += 1;

                        const savings = estimateSavings(model, result.tokensSaved);
                        this._stats.totalCostSavedUSD  += savings.costSaved;

                        // Store summary in config for onContentGenerated hook
                        config._tokenOptimizerSavings = {
                            tokensSaved:  result.tokensSaved,
                            savingsPct:   result.savingsPct,
                            costSavedUSD: savings.costSaved,
                            transforms:   result.optimizationsApplied,
                        };

                        logger.info(
                            `[Token Optimizer] Optimized (${this._cfg.optimization.mode}): ` +
                            `−${result.tokensSaved} tokens (${result.savingsPct}%) ` +
                            `[${result.optimizationsApplied.join(', ')}]`
                        );
                    }
                } catch (optErr) {
                    logger.warn('[Token Optimizer] Optimization error (non-fatal):', optErr.message);
                }
            }

            return { handled: false };

        } catch (err) {
            logger.error('[Token Optimizer] Middleware error (non-fatal):', err.message);
            return { handled: false };
        }
    },

    // ── Plugin routes ─────────────────────────────────────────────────────────

    routes: [
        {
            method:  '*',
            path:    '/api/token-optimizer',
            handler: handleTokenOptimizerRoutes,
        },
    ],

    // ── Static assets ─────────────────────────────────────────────────────────

    staticPaths: ['token-optimizer.html'],

    // ── Hooks ─────────────────────────────────────────────────────────────────

    hooks: {
        /**
         * onUnaryResponse — called after a non-streaming response is received.
         * Stores the response in the prompt cache keyed by the original
         * (model + messages) from the middleware phase.
         */
        async onUnaryResponse({ requestId, model, nativeResponse, clientResponse }) {
            try {
                const reqId   = requestId;
                const pending = tokenOptimizerPlugin._pending.get(reqId);
                if (!pending) return;
                tokenOptimizerPlugin._pending.delete(reqId);

                if (!tokenOptimizerPlugin._cfg.cache.enabled) return;

                const toCache = clientResponse ?? nativeResponse;
                if (!toCache) return;

                tokenOptimizerPlugin.cache.put(pending.model, pending.messages, toCache);
                logger.info(`[Token Optimizer] Cached response: model=${pending.model}`);
            } catch { /* silent — never crash the response path */ }
        },

        /**
         * onStreamChunk — streaming responses cannot be cached.
         * Clean up any pending cache entry so we don't leak memory.
         */
        async onStreamChunk({ requestId }) {
            try {
                tokenOptimizerPlugin._pending.delete(requestId);
            } catch { /* silent */ }
        },

        /**
         * onContentGenerated — log aggregate savings after each request.
         */
        async onContentGenerated(ctx) {
            try {
                // Clean up any orphaned pending entry
                tokenOptimizerPlugin._pending.delete(ctx._pluginRequestId);
            } catch { /* silent */ }
        },
    },

    // ── Public helpers (called from api-routes.js) ────────────────────────────

    getConfig() {
        return JSON.parse(JSON.stringify(this._cfg));
    },

    getOptimizationStats() {
        return { ...this._stats };
    },

    async updateConfig(patch) {
        const next = JSON.parse(JSON.stringify(this._cfg));

        if (patch.cache) {
            if (typeof patch.cache.enabled !== 'undefined') {
                next.cache.enabled = Boolean(patch.cache.enabled);
            }
            if (typeof patch.cache.maxSize !== 'undefined') {
                next.cache.maxSize = Math.max(1, Math.min(100_000, Number(patch.cache.maxSize) || 500));
                this.cache.resize(next.cache.maxSize);
            }
            if (typeof patch.cache.ttl !== 'undefined') {
                next.cache.ttl = Math.max(0, Number(patch.cache.ttl) || 3600);
                this.cache.ttlMs = next.cache.ttl * 1000;
            }
        }

        if (patch.optimization) {
            if (typeof patch.optimization.enabled !== 'undefined') {
                next.optimization.enabled = Boolean(patch.optimization.enabled);
            }
            if (['off', 'safe', 'aggressive'].includes(patch.optimization?.mode)) {
                next.optimization.mode = patch.optimization.mode;
            }
        }

        this._cfg = next;
        this._saveConfig(next);
        logger.info('[Token Optimizer] Config updated:', JSON.stringify(next));
    },

    // ── Private config helpers ────────────────────────────────────────────────

    _loadConfig() {
        try {
            if (existsSync(CONFIG_FILE)) {
                const raw  = readFileSync(CONFIG_FILE, 'utf8');
                const disk = JSON.parse(raw);
                return {
                    cache:        { ...DEFAULT_CONFIG.cache,        ...(disk.cache        ?? {}) },
                    optimization: { ...DEFAULT_CONFIG.optimization, ...(disk.optimization ?? {}) },
                };
            }
        } catch (err) {
            logger.warn('[Token Optimizer] Could not load config, using defaults:', err.message);
        }
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    },

    _saveConfig(cfg) {
        try {
            const dir = path.dirname(CONFIG_FILE);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
        } catch (err) {
            logger.warn('[Token Optimizer] Could not save config:', err.message);
        }
    },
};

export default tokenOptimizerPlugin;

/**
 * Multi-Model Ensemble Synthesizer Plugin
 *
 * Fans a single AI request out to N models in parallel using Promise.allSettled,
 * then synthesises the responses into one high-confidence answer.
 *
 * Four synthesis modes:
 *   vote  — Majority consensus (plurality voting on normalised answers)
 *   best  — Highest quality-score winner (length + refusal + coherence + relevance)
 *   merge — A lightweight "judge" model synthesises all N answers into one
 *   all   — Returns every response as a structured JSON object for the client
 *
 * Recursion prevention: adds X-Ensemble-Internal header to outbound fan-out
 * calls; skips processing when that header is present on incoming requests.
 *
 * Inspired by:
 *   - RouteLLM (lm-sys/routellm)            — quality evaluation, model dispatch
 *   - LiteLLM (BerriAI/litellm)             — parallel provider fan-out
 *   - Portkey AI Gateway (Portkey-AI/gateway) — multi-provider parallel routing
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { request as nodeRequest } from 'http';
import path from 'path';
import logger from '../../utils/logger.js';
import { ENSEMBLE_INTERNAL_HEADER, fanOut } from './fanout.js';
import {
    synthesiseBest,
    synthesiseVote,
    synthesiseMerge,
    synthesiseAll,
} from './synthesizer.js';
import { handleEnsembleRoutes, setPluginRef } from './api-routes.js';

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(process.cwd(), 'configs', 'ensemble-synthesizer.json');

const DEFAULT_CONFIG = {
    enabled:           false,
    models:            ['gpt-4o', 'claude-3-5-sonnet-20241022', 'gemini-1.5-pro'],
    synthesisMode:     'best',     // 'vote' | 'best' | 'merge' | 'all'
    timeoutMs:         15000,
    minResponses:      1,
    judgeModel:        'gemini-2.0-flash',
    allowClientOverride: true,
    logRequests:       true,
};

// Only process standard chat completion paths
const AI_PATHS = ['/v1/chat/completions', '/v1/messages'];

// ── Stats ─────────────────────────────────────────────────────────────────────

function makeStats() {
    return {
        totalEnsembled:  0,
        totalErrors:     0,
        totalModelsUsed: 0,
        totalLatencyMs:  0,
        perModel:        {},   // model → { requests, wins, totalLatencyMs }
        recentRequests:  [],   // last 50 entries
    };
}

// ── Plugin ────────────────────────────────────────────────────────────────────

const ensemblePlugin = {
    name:        'ensemble-synthesizer',
    version:     '1.0.0',
    description: 'Fan-out to N models in parallel and synthesise the best response using vote, best-score, merge, or all modes.',
    type:        '_builtin',
    _builtin:    true,
    _priority:   300,  // runs early — intercepts before core dispatch

    _cfg:    null,
    _stats:  null,
    _serverPort: 3000,

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async init(config) {
        this._cfg        = this._loadConfig();
        this._stats      = makeStats();
        this._serverPort = config?.SERVER_PORT ?? 3000;
        setPluginRef(this);
        logger.info(
            `[Ensemble Synthesizer] Initialized — models: [${this._cfg.models.join(', ')}]` +
            ` | mode: ${this._cfg.synthesisMode}` +
            ` | enabled: ${this._cfg.enabled}`
        );
    },

    // ── Middleware ─────────────────────────────────────────────────────────────

    async middleware(req, res, requestUrl, config) {
        try {
            // Skip if disabled
            if (!this._cfg.enabled) return { handled: false };

            // Skip internal fan-out calls to prevent recursion
            if (req.headers[ENSEMBLE_INTERNAL_HEADER]) return { handled: false };

            // Only intercept AI inference paths
            if (req.method !== 'POST') return { handled: false };
            const isAiPath = AI_PATHS.some(p => requestUrl.pathname.startsWith(p));
            if (!isAiPath) return { handled: false };

            // Read the body
            let body = null;
            if (req._rawBody) {
                try { body = JSON.parse(req._rawBody.toString('utf8')); } catch { return { handled: false }; }
            } else {
                body = await this._readBody(req);
                if (!body) return { handled: false };
                req._rawBody = Buffer.from(JSON.stringify(body), 'utf8');
            }

            if (!body?.messages || !Array.isArray(body.messages)) return { handled: false };

            // Determine which models to use (client can override if allowed)
            let models = [...this._cfg.models];
            if (this._cfg.allowClientOverride && Array.isArray(body._ensemble_models)) {
                models = body._ensemble_models.filter(m => typeof m === 'string' && m.trim());
            }
            if (models.length === 0) return { handled: false };

            // If only one model, skip ensemble overhead and fall through
            if (models.length === 1) {
                body.model = models[0];
                delete body._ensemble_models;
                req._rawBody = Buffer.from(JSON.stringify(body), 'utf8');
                return { handled: false };
            }

            // Determine synthesis mode
            const mode = (this._cfg.allowClientOverride && body._ensemble_mode)
                ? body._ensemble_mode
                : this._cfg.synthesisMode;

            // Extract the user query for scoring/merging
            const userMsgs = body.messages.filter(m => m.role === 'user');
            const query    = typeof userMsgs[userMsgs.length - 1]?.content === 'string'
                ? userMsgs[userMsgs.length - 1].content
                : '';

            const authHeader = req.headers['authorization'] ?? '';
            const startTime  = Date.now();

            // Strip ensemble-only fields before forwarding
            const forwardBody = { ...body };
            delete forwardBody._ensemble_models;
            delete forwardBody._ensemble_mode;

            // ── Fan-out ───────────────────────────────────────────────────────
            const results = await fanOut({
                port:        this._serverPort,
                authHeader,
                body:        forwardBody,
                models,
                timeoutMs:   this._cfg.timeoutMs,
                minResponses: this._cfg.minResponses,
            });

            const wallMs = Date.now() - startTime;

            // ── Synthesise ────────────────────────────────────────────────────
            let synthesis = null;

            if (mode === 'vote')  synthesis = synthesiseVote(results, query);
            else if (mode === 'merge') {
                synthesis = await synthesiseMerge(
                    results, query, this._cfg.judgeModel,
                    (model, messages) => this._singleCall(model, messages, authHeader),
                );
            } else if (mode === 'all') {
                synthesis = synthesiseAll(results);
            } else {
                synthesis = synthesiseBest(results, query);
            }

            if (!synthesis) {
                // All models failed — fall through to normal dispatch
                logger.warn('[Ensemble Synthesizer] All models failed, falling through');
                this._stats.totalErrors++;
                return { handled: false };
            }

            // ── Update stats ──────────────────────────────────────────────────
            this._updateStats(results, synthesis.meta, wallMs);
            if (this._cfg.logRequests) {
                logger.info(
                    `[Ensemble Synthesizer] mode=${mode} models=[${models.join(',')}]` +
                    ` winner=${synthesis.meta.winner ?? 'n/a'} latency=${wallMs}ms`
                );
            }

            // ── Write response ────────────────────────────────────────────────
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(synthesis.response));
            return { handled: true };

        } catch (err) {
            logger.error('[Ensemble Synthesizer] Middleware error:', err.message);
            this._stats.totalErrors++;
            return { handled: false };
        }
    },

    // ── Routes ─────────────────────────────────────────────────────────────────

    routes: [{
        method:  '*',
        path:    '/api/ensemble-synthesizer',
        handler: handleEnsembleRoutes,
    }],

    staticPaths: ['ensemble-synthesizer.html'],

    // ── Public helpers ────────────────────────────────────────────────────────

    getConfig()  { return JSON.parse(JSON.stringify(this._cfg)); },
    getStats()   { return JSON.parse(JSON.stringify(this._stats)); },

    async updateConfig(patch) {
        const next = { ...this._cfg };
        for (const [k, v] of Object.entries(patch)) {
            if (k in DEFAULT_CONFIG) next[k] = v;
        }
        this._cfg = next;
        this._saveConfig(next);
        logger.info('[Ensemble Synthesizer] Config updated');
    },

    resetStats() {
        this._stats = makeStats();
    },

    // ── Internals ─────────────────────────────────────────────────────────────

    _updateStats(results, meta, wallMs) {
        const s = this._stats;
        s.totalEnsembled++;
        s.totalModelsUsed += results.filter(r => !r.error).length;
        s.totalLatencyMs  += wallMs;

        for (const r of results) {
            if (!s.perModel[r.model]) {
                s.perModel[r.model] = { requests: 0, wins: 0, totalLatencyMs: 0, errors: 0 };
            }
            const pm = s.perModel[r.model];
            pm.requests++;
            pm.totalLatencyMs += r.latencyMs;
            if (r.error) pm.errors++;
            if (meta.winner === r.model) pm.wins++;
        }

        // Keep only last 50 recent entries
        s.recentRequests.unshift({
            ts:        new Date().toISOString(),
            models:    meta.models ?? [],
            mode:      meta.mode,
            winner:    meta.winner ?? null,
            latencyMs: wallMs,
        });
        if (s.recentRequests.length > 50) s.recentRequests.length = 50;
    },

    /** Read and buffer the request body */
    _readBody(req) {
        return new Promise((resolve) => {
            const chunks = [];
            req.on('data', c => chunks.push(c));
            req.on('end', () => {
                try {
                    const raw = Buffer.concat(chunks);
                    resolve(raw.length > 0 ? JSON.parse(raw.toString('utf8')) : null);
                } catch { resolve(null); }
            });
            req.on('error', () => resolve(null));
        });
    },

    /** Make a single non-streaming call to the local proxy (used by merge judge). */
    _singleCall(model, messages, authHeader) {
        return new Promise((resolve, reject) => {
            const payload = JSON.stringify({ model, messages, stream: false });
            const opts = {
                hostname: '127.0.0.1',
                port:     this._serverPort,
                path:     '/v1/chat/completions',
                method:   'POST',
                headers:  {
                    'Content-Type':              'application/json',
                    'Content-Length':            Buffer.byteLength(payload),
                    [ENSEMBLE_INTERNAL_HEADER]:  '1',
                    ...(authHeader ? { 'Authorization': authHeader } : {}),
                },
            };

            const req = nodeRequest(opts, (res2) => {
                const chunks = [];
                res2.on('data', c => chunks.push(c));
                res2.on('end', () => {
                    try {
                        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                        resolve(body?.choices?.[0]?.message?.content ?? '');
                    } catch (e) { reject(e); }
                });
                res2.on('error', reject);
            });

            const timer = setTimeout(() => { req.destroy(); reject(new Error('judge timeout')); }, this._cfg.timeoutMs);
            req.on('close', () => clearTimeout(timer));
            req.on('error', reject);
            req.write(payload);
            req.end();
        });
    },

    // ── Config persistence ────────────────────────────────────────────────────

    _loadConfig() {
        try {
            if (existsSync(CONFIG_FILE)) {
                const disk = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
                return { ...DEFAULT_CONFIG, ...disk };
            }
        } catch (err) {
            logger.warn('[Ensemble Synthesizer] Could not load config, using defaults:', err.message);
        }
        return { ...DEFAULT_CONFIG };
    },

    _saveConfig(cfg) {
        try {
            const dir = path.dirname(CONFIG_FILE);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
        } catch (err) {
            logger.warn('[Ensemble Synthesizer] Could not save config:', err.message);
        }
    },
};

export default ensemblePlugin;

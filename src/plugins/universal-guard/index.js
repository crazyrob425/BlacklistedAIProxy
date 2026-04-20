/**
 * Universal Guard Plugin
 *
 * A multi-capability security and governance plugin for BlacklistedAIProxy that
 * combines five protection layers into a single, modular, zero-overhead plugin:
 *
 *  1. Rate Limiter     — Sliding-window per-IP and per-API-key request limits.
 *  2. Budget Guard     — Daily/monthly USD spend limits with configurable
 *                        warn/block thresholds.
 *  3. PII Scrubber     — Regex-based redaction of emails, credit-card numbers,
 *                        SSNs, API keys, GitHub tokens, JWTs, and more.
 *  4. Prompt Policy    — Jailbreak attempt detection + custom keyword blocklist.
 *  5. Incident Alerter — Webhook/Slack notifications on any guard event.
 *
 * Each capability is independently enabled/disabled via configuration.
 * A single plugin config file (configs/universal-guard.json) controls all modules.
 *
 * Safety guarantees:
 *  - All guard failures are caught and logged; they NEVER crash the server.
 *  - Rate limiter uses in-memory state only (no I/O in the hot path).
 *  - PII scrubbing and policy scanning complete in < 2 ms for typical messages.
 *  - Budget guard I/O is debounced (written every 5 s, not per request).
 *  - Webhook alerts are fire-and-forget; send failures are silent.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

import logger from '../../utils/logger.js';
import { RateLimiter }     from './rate-limiter.js';
import { BudgetGuard }     from './budget-guard.js';
import { PiiScrubber }     from './pii-scrubber.js';
import { PromptPolicy }    from './prompt-policy.js';
import { Alerting }        from './alerting.js';
import {
    handleUniversalGuardRoutes,
    setPluginRef,
} from './api-routes.js';
import { estimateTokens } from '../token-optimizer/optimizer.js';

// ── Config ────────────────────────────────────────────────────────────────────

const CONFIG_FILE = path.join(process.cwd(), 'configs', 'universal-guard.json');

const DEFAULT_CONFIG = {
    rateLimiter: {
        enabled:      true,
        perIp:        { reqPerMinute: 60,  reqPerHour: 600  },
        perKey:       { reqPerMinute: 120, reqPerHour: 1200 },
    },
    budgetGuard: {
        enabled:        false,
        dailyLimitUSD:  0,
        monthlyLimitUSD: 0,
        warnAtPercent:  80,
        blockAtPercent: 100,
    },
    piiScrubber: {
        enabled:       false,
        action:        'redact',           // 'redact' | 'flag'
        patterns:      [
            'email', 'credit_card', 'ssn', 'openai_key', 'anthropic_key',
            'google_api_key', 'aws_access_key', 'github_token', 'stripe_key', 'jwt',
        ],
        logDetections: true,
    },
    promptPolicy: {
        enabled:                 false,
        action:                  'block',  // 'block' | 'flag' | 'sanitize'
        maxTokens:               0,        // 0 = disabled
        blockKeywords:           [],
        enableJailbreakDetection: true,
    },
    alerting: {
        enabled:    false,
        webhookUrl: '',
        events:     ['rate_limit_exceeded', 'budget_exceeded', 'policy_violation', 'pii_detected'],
    },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function readBody(req) {
    if (req._rawBody) {
        try { return Promise.resolve(JSON.parse(req._rawBody.toString('utf8'))); }
        catch { return Promise.resolve(null); }
    }
    return new Promise((resolve) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks);
                req._rawBody = raw;
                resolve(raw.length > 0 ? JSON.parse(raw.toString('utf8')) : null);
            } catch { resolve(null); }
        });
        req.on('error', () => resolve(null));
    });
}

function extractClientIp(req) {
    return (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
        || req.socket?.remoteAddress
        || '0.0.0.0';
}

function extractApiKey(req) {
    const auth = req.headers['authorization'] ?? '';
    const m    = auth.match(/^Bearer\s+(.+)$/i);
    return m ? m[1].slice(0, 32) : ''; // truncate to avoid huge Map keys
}

function sendJson(res, status, data) {
    res.writeHead(status, {
        'Content-Type':                'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
}

const AI_PATHS = ['/v1/chat/completions', '/v1/responses', '/v1/messages'];

// ── Plugin ────────────────────────────────────────────────────────────────────

const universalGuardPlugin = {
    name:        'universal-guard',
    version:     '1.0.0',
    description: 'Five-in-one security + governance: rate limiting, budget control, PII scrubbing, prompt policy enforcement, and webhook alerting. Dashboard: <a href="universal-guard.html" target="_blank">universal-guard.html</a>',
    type:        '_builtin',
    _builtin:    true,
    _priority:   9000, // runs very early, before most middleware (after auth at 9999)

    // Sub-module instances set in init()
    rateLimiter:  null,
    budgetGuard:  null,
    piiScrubber:  null,
    promptPolicy: null,
    alerting:     null,

    _cfg: null,

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async init(config) {
        this._cfg = this._loadConfig();

        this.rateLimiter  = new RateLimiter(this._cfg.rateLimiter);
        this.budgetGuard  = new BudgetGuard(this._cfg.budgetGuard);
        this.piiScrubber  = new PiiScrubber(this._cfg.piiScrubber);
        this.promptPolicy = new PromptPolicy(this._cfg.promptPolicy);
        this.alerting     = new Alerting(this._cfg.alerting);

        setPluginRef(this);

        const modules = [
            this._cfg.rateLimiter.enabled  ? 'rate-limiter' : null,
            this._cfg.budgetGuard.enabled  ? 'budget-guard' : null,
            this._cfg.piiScrubber.enabled  ? 'pii-scrubber' : null,
            this._cfg.promptPolicy.enabled ? 'prompt-policy' : null,
            this._cfg.alerting.enabled     ? 'alerting' : null,
        ].filter(Boolean);

        logger.info(`[Universal Guard] Initialized — active modules: [${modules.join(', ')}]`);
    },

    // ── Middleware ─────────────────────────────────────────────────────────────

    async middleware(req, res, requestUrl, config) {
        try {
            if (req.method !== 'POST') return { handled: false };
            const isAiPath = AI_PATHS.some(p => requestUrl.pathname.includes(p));
            if (!isAiPath)             return { handled: false };

            const ip     = extractClientIp(req);
            const apiKey = extractApiKey(req);

            // ── 1. Rate limiter ────────────────────────────────────────────────
            const rateResult = this.rateLimiter.check(ip, apiKey);
            if (!rateResult.allowed) {
                this.alerting.alert('rate_limit_exceeded', { ip, reason: rateResult.reason });
                sendJson(res, 429, {
                    error: {
                        message: 'Rate limit exceeded. Please slow down.',
                        type:    'rate_limit_error',
                        code:    rateResult.reason,
                        retryAfterMs: Math.ceil(rateResult.resetInMs ?? 60000),
                    },
                });
                logger.warn(`[Universal Guard] Rate limit hit: ip=${ip}, reason=${rateResult.reason}`);
                return { handled: true };
            }

            // ── 2. Budget guard ────────────────────────────────────────────────
            // Body needed for budget + PII + policy checks; read lazily
            let body = null;

            if (this._cfg.budgetGuard.enabled || this._cfg.piiScrubber.enabled || this._cfg.promptPolicy.enabled) {
                body = await readBody(req);
            }

            if (this._cfg.budgetGuard.enabled && body) {
                const budgetResult = this.budgetGuard.check(body?.model, body, apiKey);
                if (!budgetResult.allowed) {
                    this.alerting.alert('budget_exceeded', {
                        reason: budgetResult.reason,
                        spend:  budgetResult.spend,
                    });
                    sendJson(res, 429, {
                        error: {
                            message: 'Budget limit reached. Request blocked to prevent overspend.',
                            type:    'budget_exceeded',
                            code:    budgetResult.reason,
                        },
                    });
                    logger.warn(`[Universal Guard] Budget limit hit: ${budgetResult.reason}`);
                    return { handled: true };
                }
            }

            if (body?.messages) {
                // ── 3. PII scrubber ────────────────────────────────────────────
                if (this._cfg.piiScrubber.enabled) {
                    const { messages: scrubbed, detections } = this.piiScrubber.scrub(body.messages);
                    if (detections.length > 0) {
                        this.alerting.alert('pii_detected', { types: detections.map(d => d.type) });
                        body.messages = scrubbed;
                        req._rawBody  = Buffer.from(JSON.stringify(body), 'utf8');
                    }
                }

                // ── 4. Prompt policy ───────────────────────────────────────────
                if (this._cfg.promptPolicy.enabled) {
                    const totalTokens = body.messages.reduce(
                        (s, m) => s + estimateTokens(m?.content ?? ''), 0);
                    const { violations, blocked } = this.promptPolicy.scan(body.messages, totalTokens);

                    if (violations.length > 0) {
                        this.alerting.alert('policy_violation', {
                            violations: violations.map(v => ({ type: v.type, message: v.message })),
                        });
                    }

                    if (blocked) {
                        sendJson(res, 400, {
                            error: {
                                message: 'Request blocked by content policy.',
                                type:    'policy_violation',
                                details: violations.map(v => v.message),
                            },
                        });
                        logger.warn(`[Universal Guard] Policy violation(s): ${violations.map(v => v.type).join(', ')}`);
                        return { handled: true };
                    }
                }
            }

            return { handled: false };

        } catch (err) {
            logger.error('[Universal Guard] Middleware error (non-fatal):', err.message);
            return { handled: false };
        }
    },

    // ── Plugin routes ─────────────────────────────────────────────────────────

    routes: [
        {
            method:  '*',
            path:    '/api/universal-guard',
            handler: handleUniversalGuardRoutes,
        },
    ],

    staticPaths: ['universal-guard.html'],

    // ── Hooks ─────────────────────────────────────────────────────────────────

    hooks: {
        async onContentGenerated(ctx) {
            try {
                const { originalRequestBody, model, processedRequestBody } = ctx;
                // Record actual spend using real token counts from the response
                const usage = ctx.usage;
                if (usage?.promptTokens && universalGuardPlugin._cfg.budgetGuard.enabled) {
                    universalGuardPlugin.budgetGuard.recordSpend(
                        model,
                        usage.promptTokens   ?? 0,
                        usage.completionTokens ?? 0,
                    );
                }
            } catch { /* silent */ }
        },
    },

    // ── Public helpers ────────────────────────────────────────────────────────

    getAllStats() {
        return {
            rateLimiter:  this.rateLimiter?.getStats()  ?? {},
            budgetGuard:  this.budgetGuard?.getStats()  ?? {},
            piiScrubber:  this.piiScrubber?.getStats()  ?? {},
            promptPolicy: this.promptPolicy?.getStats() ?? {},
            alerting:     this.alerting?.getStats()     ?? {},
        };
    },

    getConfig() {
        return JSON.parse(JSON.stringify(this._cfg));
    },

    async updateConfig(patch) {
        const next = JSON.parse(JSON.stringify(this._cfg));

        // Merge top-level module configs shallowly
        for (const key of ['rateLimiter', 'budgetGuard', 'piiScrubber', 'promptPolicy', 'alerting']) {
            if (patch[key] && typeof patch[key] === 'object') {
                next[key] = { ...next[key], ...patch[key] };
            }
        }

        this._cfg = next;

        // Push updated configs to sub-modules
        this.rateLimiter?.updateConfig(next.rateLimiter);
        this.budgetGuard?.updateConfig(next.budgetGuard);
        this.piiScrubber?.updateConfig(next.piiScrubber);
        this.promptPolicy?.updateConfig(next.promptPolicy);
        this.alerting?.updateConfig(next.alerting);

        this._saveConfig(next);
        logger.info('[Universal Guard] Config updated');
    },

    // ── Config persistence ────────────────────────────────────────────────────

    _loadConfig() {
        try {
            if (existsSync(CONFIG_FILE)) {
                const disk = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
                // Deep merge each module separately so new default keys are included
                const merged = {};
                for (const key of Object.keys(DEFAULT_CONFIG)) {
                    merged[key] = { ...DEFAULT_CONFIG[key], ...(disk[key] ?? {}) };
                }
                return merged;
            }
        } catch (err) {
            logger.warn('[Universal Guard] Could not load config, using defaults:', err.message);
        }
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    },

    _saveConfig(cfg) {
        try {
            const dir = path.dirname(CONFIG_FILE);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
        } catch (err) {
            logger.warn('[Universal Guard] Could not save config:', err.message);
        }
    },
};

export default universalGuardPlugin;

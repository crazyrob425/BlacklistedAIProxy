/**
 * Universal Guard Plugin — Budget Guard
 *
 * Tracks per-key and global daily/monthly AI API spend and blocks requests
 * that would exceed configured budget limits.
 *
 * Cost estimation uses the same pricing table as the Token Optimizer plugin
 * (cost-estimator.js), falling back to a conservative $1/1M input default
 * when the model is unrecognized.
 *
 * Persistence: spend counters are written to configs/universal-guard-budget.json
 * every 5 seconds (debounced) and on process exit so they survive restarts.
 *
 * Window reset: daily counters reset at UTC midnight; monthly counters on the
 * 1st of each month at UTC midnight.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import logger from '../../utils/logger.js';
import { estimateCost }  from '../token-optimizer/cost-estimator.js';
import { estimateTokens } from '../token-optimizer/optimizer.js';

const BUDGET_FILE = path.join(process.cwd(), 'configs', 'universal-guard-budget.json');

// ── Helpers ───────────────────────────────────────────────────────────────────

function todayKey()   { return new Date().toISOString().slice(0, 10); }      // YYYY-MM-DD
function monthKey()   { return new Date().toISOString().slice(0, 7);  }      // YYYY-MM

function estimateRequestCost(model, body) {
    try {
        const msgs    = Array.isArray(body?.messages) ? body.messages : [];
        const inToks  = msgs.reduce((s, m) => s + estimateTokens(m?.content ?? ''), 0);
        const outToks = Math.ceil(inToks * 0.4); // rough 40% output-to-input ratio
        return estimateCost(model ?? 'default', inToks, outToks).totalCost;
    } catch {
        return 0;
    }
}

// ── Budget Guard ──────────────────────────────────────────────────────────────

export class BudgetGuard {
    /**
     * @param {Object} cfg
     * @param {boolean} cfg.enabled
     * @param {number}  cfg.dailyLimitUSD
     * @param {number}  cfg.monthlyLimitUSD
     * @param {number}  cfg.warnAtPercent   (0–100)
     * @param {number}  cfg.blockAtPercent  (0–100)
     */
    constructor(cfg) {
        this._cfg    = cfg;
        this._store  = this._load();
        this._dirty  = false;
        this._saving = false;

        // Persist every 5 s
        this._timer = setInterval(() => this._persist(), 5000);
        if (this._timer.unref) this._timer.unref();

        // Save on exit
        const saveOnExit = () => this._persistSync();
        process.on('beforeExit', saveOnExit);
        process.on('SIGINT',  () => { saveOnExit(); });
        process.on('SIGTERM', () => { saveOnExit(); });
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Evaluate whether a request should be allowed given current spend.
     *
     * @param {string} model   - AI model for cost estimation
     * @param {Object} body    - Parsed request body (used for token estimation)
     * @param {string} [keyId] - Optional per-key identifier
     * @returns {{ allowed: boolean, reason?: string, spend?: Object }}
     */
    check(model, body, keyId) {
        if (!this._cfg.enabled) return { allowed: true };

        this._rolloverIfNeeded();
        const cost = estimateRequestCost(model, body);

        const today  = todayKey();
        const month  = monthKey();

        const daySpend   = (this._store.daily[today]   ?? 0) + cost;
        const monthSpend = (this._store.monthly[month] ?? 0) + cost;

        // Check global daily budget
        if (this._cfg.dailyLimitUSD > 0) {
            const pct = (daySpend / this._cfg.dailyLimitUSD) * 100;
            if (pct >= this._cfg.blockAtPercent) {
                return {
                    allowed: false,
                    reason:  'daily_budget_exceeded',
                    spend:   { daily: daySpend, monthly: monthSpend, estimatedCost: cost },
                };
            }
        }

        // Check global monthly budget
        if (this._cfg.monthlyLimitUSD > 0) {
            const pct = (monthSpend / this._cfg.monthlyLimitUSD) * 100;
            if (pct >= this._cfg.blockAtPercent) {
                return {
                    allowed: false,
                    reason:  'monthly_budget_exceeded',
                    spend:   { daily: daySpend, monthly: monthSpend, estimatedCost: cost },
                };
            }
        }

        return {
            allowed: true,
            spend: { daily: daySpend, monthly: monthSpend, estimatedCost: cost },
        };
    }

    /**
     * Record actual spend after a successful API call.
     * Called from the onContentGenerated hook with real token counts.
     *
     * @param {string} model
     * @param {number} inputTokens
     * @param {number} outputTokens
     */
    recordSpend(model, inputTokens, outputTokens) {
        if (!this._cfg.enabled) return;
        try {
            const cost  = estimateCost(model ?? 'default', inputTokens, outputTokens).totalCost;
            const today = todayKey();
            const month = monthKey();

            this._store.daily[today]    = (this._store.daily[today]   ?? 0) + cost;
            this._store.monthly[month]  = (this._store.monthly[month] ?? 0) + cost;
            this._store.lifetimeUSD    += cost;
            this._dirty = true;

            logger.info(`[Budget Guard] Recorded $${cost.toFixed(6)} — daily: $${this._store.daily[today].toFixed(4)}`);
        } catch { /* silent */ }
    }

    getStats() {
        this._rolloverIfNeeded();
        const today = todayKey();
        const month = monthKey();
        const daySpend   = this._store.daily[today]   ?? 0;
        const monthSpend = this._store.monthly[month] ?? 0;

        return {
            enabled:          this._cfg.enabled,
            dailySpendUSD:    daySpend,
            monthlySpendUSD:  monthSpend,
            lifetimeSpendUSD: this._store.lifetimeUSD,
            dailyLimitUSD:    this._cfg.dailyLimitUSD,
            monthlyLimitUSD:  this._cfg.monthlyLimitUSD,
            dailyPct:  this._cfg.dailyLimitUSD   > 0 ? (daySpend   / this._cfg.dailyLimitUSD)   * 100 : null,
            monthlyPct: this._cfg.monthlyLimitUSD > 0 ? (monthSpend / this._cfg.monthlyLimitUSD) * 100 : null,
        };
    }

    resetDaily() {
        this._store.daily   = {};
        this._dirty = true;
        this._persist();
    }

    resetMonthly() {
        this._store.monthly = {};
        this._dirty = true;
        this._persist();
    }

    updateConfig(cfg) {
        this._cfg = cfg;
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    _rolloverIfNeeded() {
        // Keep only last 7 daily + 3 monthly keys to prevent unbounded growth
        const dayKeys   = Object.keys(this._store.daily).sort().slice(0, -7);
        const monthKeys = Object.keys(this._store.monthly).sort().slice(0, -3);
        let changed = false;
        for (const k of dayKeys)   { delete this._store.daily[k];   changed = true; }
        for (const k of monthKeys) { delete this._store.monthly[k]; changed = true; }
        if (changed) this._dirty = true;
    }

    _load() {
        const empty = { daily: {}, monthly: {}, lifetimeUSD: 0 };
        try {
            if (existsSync(BUDGET_FILE)) {
                return { ...empty, ...JSON.parse(readFileSync(BUDGET_FILE, 'utf8')) };
            }
        } catch { /* use empty */ }
        return empty;
    }

    async _persist() {
        if (!this._dirty || this._saving) return;
        this._saving = true;
        try {
            const dir = path.dirname(BUDGET_FILE);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(BUDGET_FILE, JSON.stringify(this._store, null, 2), 'utf8');
            this._dirty = false;
        } catch { /* silent */ } finally {
            this._saving = false;
        }
    }

    _persistSync() {
        if (!this._dirty) return;
        try {
            const dir = path.dirname(BUDGET_FILE);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(BUDGET_FILE, JSON.stringify(this._store, null, 2), 'utf8');
        } catch { /* silent */ }
    }
}

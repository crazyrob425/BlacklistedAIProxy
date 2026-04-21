/**
 * Universal Guard Plugin — Alerting
 *
 * Fire-and-forget webhook notifications for guard events.
 * Supports any HTTP/HTTPS POST endpoint (Slack, Discord, generic webhook).
 *
 * Design principles:
 *  - Non-blocking: alerts are sent asynchronously and NEVER delay the request
 *  - Fault-tolerant: a failed webhook does not propagate any error
 *  - Deduplicated: events of the same type within a 10-second window are
 *    coalesced to prevent webhook flooding under sustained attack
 *  - Formatted: Slack-compatible `text` + `blocks` payload included
 */

import logger from '../../utils/logger.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const DEDUP_WINDOW_MS  = 10_000; // 10 s — coalesce same-type events
const MAX_QUEUE        = 100;    // never accumulate more than this in memory
const REQUEST_TIMEOUT  = 5_000;  // 5 s webhook timeout

// ── Alert sender ──────────────────────────────────────────────────────────────

export class Alerting {
    /**
     * @param {Object}   cfg
     * @param {boolean}  cfg.enabled
     * @param {string}   cfg.webhookUrl
     * @param {string[]} cfg.events  - event types to send
     */
    constructor(cfg) {
        this._cfg   = cfg;
        this._sent  = 0;
        this._fails = 0;

        /** @type {Map<string, number>} event type → last-sent timestamp */
        this._lastSent = new Map();

        /** @type {Array} pending alert queue */
        this._queue = [];
        this._draining = false;
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Queue an alert to be sent asynchronously.
     * Safe to call from the hot path — returns immediately.
     *
     * @param {string} eventType   - e.g. 'rate_limit_exceeded'
     * @param {Object} payload     - Additional context for the alert body
     */
    alert(eventType, payload = {}) {
        if (!this._cfg.enabled) return;
        if (!this._cfg.webhookUrl) return;
        if (!this._cfg.events.includes(eventType)) return;

        // Deduplication: skip if same event type was sent recently
        const now       = Date.now();
        const lastSent  = this._lastSent.get(eventType) ?? 0;
        if ((now - lastSent) < DEDUP_WINDOW_MS) return;
        this._lastSent.set(eventType, now);

        if (this._queue.length >= MAX_QUEUE) {
            logger.warn('[Alerting] Alert queue full — dropping event:', eventType);
            return;
        }

        this._queue.push({ eventType, payload, ts: now });
        setImmediate(() => this._drain());
    }

    getStats() {
        return {
            enabled:   this._cfg.enabled,
            sent:      this._sent,
            failures:  this._fails,
            queued:    this._queue.length,
        };
    }

    updateConfig(cfg) {
        this._cfg = cfg;
    }

    // ── Private ───────────────────────────────────────────────────────────────

    async _drain() {
        if (this._draining || this._queue.length === 0) return;
        this._draining = true;

        while (this._queue.length > 0) {
            const item = this._queue.shift();
            await this._send(item).catch(() => { /* already handled internally */ });
        }

        this._draining = false;
    }

    async _send({ eventType, payload, ts }) {
        const url = this._cfg.webhookUrl;
        if (!url) return;

        const body = this._buildPayload(eventType, payload, ts);

        try {
            // Use undici fetch (available in Node 18+) if present, else native
            const { fetch: _fetch } = await import('undici').catch(() => globalThis);
            const fetchFn = _fetch ?? globalThis.fetch;

            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT);

            const resp = await fetchFn(url, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify(body),
                signal:  ctrl.signal,
            });

            clearTimeout(timer);

            if (resp.ok) {
                this._sent++;
                logger.info(`[Alerting] Sent ${eventType} alert → ${resp.status}`);
            } else {
                this._fails++;
                logger.warn(`[Alerting] Webhook responded ${resp.status} for ${eventType}`);
            }
        } catch (err) {
            this._fails++;
            logger.warn(`[Alerting] Failed to send ${eventType} alert:`, err.message);
        }
    }

    _buildPayload(eventType, payload, ts) {
        const emoji = {
            rate_limit_exceeded: '🚫',
            budget_exceeded:     '💸',
            policy_violation:    '⚠️',
            pii_detected:        '🔒',
        }[eventType] ?? '🔔';

        const title   = `${emoji} BlacklistedAIProxy — ${eventType.replace(/_/g, ' ').toUpperCase()}`;
        const details = Object.entries(payload)
            .map(([k, v]) => `• *${k}*: \`${JSON.stringify(v)}\``)
            .join('\n');

        // Slack/Discord compatible
        return {
            text: title,
            blocks: [
                {
                    type: 'section',
                    text: { type: 'mrkdwn', text: `*${title}*\n${details}` },
                },
                {
                    type: 'context',
                    elements: [{
                        type: 'mrkdwn',
                        text: `Timestamp: ${new Date(ts).toISOString()} | Service: BlacklistedAIProxy`,
                    }],
                },
            ],
            // Generic webhook fallback fields
            event:     eventType,
            timestamp: new Date(ts).toISOString(),
            service:   'blacklistedaiproxy',
            ...payload,
        };
    }
}

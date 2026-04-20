/**
 * Universal Guard Plugin — Rate Limiter
 *
 * Sliding-window rate limiter with separate per-IP and per-API-key limits.
 * Uses an in-memory Map of sliding-window counters.
 *
 * Algorithm: Fixed-window counter with a second "previous window" carry-over
 * fraction, which approximates a true sliding window without per-request
 * timestamp storage.  Accuracy: within ~1% of a true sliding window.
 *
 * Reference: Cloudflare blog "How we extended the sliding window algorithm
 *   to beat rate-limiting" — same fixed+fraction approach.
 */

// ── Sliding-window state ──────────────────────────────────────────────────────

/**
 * @typedef {Object} WindowEntry
 * @property {number} current  - Requests in the current window
 * @property {number} previous - Requests in the previous window
 * @property {number} windowStart - Unix-ms timestamp of current window start
 */

class RateLimiterStore {
    constructor() {
        /** @type {Map<string, WindowEntry>} */
        this._store     = new Map();
        this._cleanupAt = Date.now() + 5 * 60 * 1000; // cleanup every 5 min
    }

    /**
     * Check whether a given key is within the allowed rate.
     *
     * @param {string} key         - Identifier (IP or API key)
     * @param {number} windowMs    - Window size in milliseconds
     * @param {number} limit       - Max requests per window
     * @returns {{ allowed: boolean, remaining: number, resetInMs: number }}
     */
    check(key, windowMs, limit) {
        const now = Date.now();

        // Periodic cleanup of expired entries
        if (now >= this._cleanupAt) {
            this._sweep(windowMs);
            this._cleanupAt = now + 5 * 60 * 1000;
        }

        let entry = this._store.get(key);

        if (!entry || (now - entry.windowStart) >= windowMs) {
            // Start a fresh window (carrying previous count for sliding estimate)
            const prevCount = entry ? entry.current : 0;
            entry = { current: 0, previous: prevCount, windowStart: now };
            this._store.set(key, entry);
        }

        // Sliding estimate: weight the previous window by how much of the
        // current window has elapsed.
        const elapsed  = now - entry.windowStart;
        const fraction = 1 - elapsed / windowMs;
        const estimate = entry.current + Math.floor(entry.previous * fraction);

        if (estimate >= limit) {
            const resetInMs = windowMs - elapsed;
            return { allowed: false, remaining: 0, resetInMs };
        }

        entry.current++;
        const remaining = Math.max(0, limit - estimate - 1);
        return { allowed: true, remaining, resetInMs: windowMs - elapsed };
    }

    _sweep(windowMs) {
        const now = Date.now();
        for (const [key, entry] of this._store) {
            if ((now - entry.windowStart) > windowMs * 2) {
                this._store.delete(key);
            }
        }
    }

    getSize() {
        return this._store.size;
    }
}

// ── Public rate-limiter interface ─────────────────────────────────────────────

export class RateLimiter {
    /**
     * @param {Object} cfg
     * @param {boolean} cfg.enabled
     * @param {{reqPerMinute: number, reqPerHour: number}} cfg.perIp
     * @param {{reqPerMinute: number, reqPerHour: number}} cfg.perKey
     */
    constructor(cfg) {
        this._cfg      = cfg;
        this._perMin   = new RateLimiterStore();  // 1-minute windows
        this._perHour  = new RateLimiterStore();  // 1-hour windows
        this._blocked  = 0;   // lifetime blocked count
        this._allowed  = 0;
    }

    /**
     * Check whether a request from (ip, apiKey) is allowed.
     *
     * @param {string} ip     - Client IP address
     * @param {string} apiKey - Extracted API key (or empty string)
     * @returns {{ allowed: boolean, reason?: string, resetInMs?: number }}
     */
    check(ip, apiKey) {
        if (!this._cfg.enabled) return { allowed: true };

        const ip4 = ip || '0.0.0.0';

        // Per-IP minute check
        const ipMin = this._perMin.check(
            `ip:${ip4}`, 60_000, this._cfg.perIp.reqPerMinute);
        if (!ipMin.allowed) {
            this._blocked++;
            return { allowed: false, reason: 'ip_rate_limit_minute', resetInMs: ipMin.resetInMs };
        }

        // Per-IP hour check
        const ipHour = this._perHour.check(
            `ip:${ip4}`, 3_600_000, this._cfg.perIp.reqPerHour);
        if (!ipHour.allowed) {
            this._blocked++;
            return { allowed: false, reason: 'ip_rate_limit_hour', resetInMs: ipHour.resetInMs };
        }

        // Per-key checks (if a key is provided)
        if (apiKey) {
            const keyMin = this._perMin.check(
                `key:${apiKey}`, 60_000, this._cfg.perKey.reqPerMinute);
            if (!keyMin.allowed) {
                this._blocked++;
                return { allowed: false, reason: 'key_rate_limit_minute', resetInMs: keyMin.resetInMs };
            }

            const keyHour = this._perHour.check(
                `key:${apiKey}`, 3_600_000, this._cfg.perKey.reqPerHour);
            if (!keyHour.allowed) {
                this._blocked++;
                return { allowed: false, reason: 'key_rate_limit_hour', resetInMs: keyHour.resetInMs };
            }
        }

        this._allowed++;
        return { allowed: true };
    }

    getStats() {
        return {
            allowed:       this._allowed,
            blocked:       this._blocked,
            trackedIpKeys: this._perMin.getSize() + this._perHour.getSize(),
        };
    }

    updateConfig(cfg) {
        this._cfg = cfg;
    }
}

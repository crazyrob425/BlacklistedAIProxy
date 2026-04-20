/**
 * Token Optimizer Plugin — Prompt Cache
 *
 * SHA-256-keyed LRU cache with TTL expiry for exact-match prompt response caching.
 * Architecture inspired by NadirClaw/NadirRouter's PromptCache implementation
 * (see: NadirRouter/NadirClaw commit ec0f598 and nadirclaw/cache.py).
 *
 * Design principles:
 *  - LRU eviction: JavaScript Map insertion-order gives O(1) LRU for free.
 *  - TTL:          Per-entry timestamps checked on every `get()` call.
 *  - Bounded:      Hard cap on `maxSize`; LRU entry is evicted when full.
 *  - Deterministic keys: SHA-256 over JSON-serialized { model, messages }.
 *  - Zero deps:    Only Node.js built-in `crypto` module required.
 *  - Thread-safe:  Node.js single-threaded event loop; no concurrent writes.
 *
 * Usage:
 *   const cache = new PromptCache({ maxSize: 500, ttl: 3600 });
 *   cache.put('gpt-4', messages, response);
 *   const hit = cache.get('gpt-4', messages); // response or null
 */

import { createHash } from 'crypto';

/**
 * Compute a deterministic 64-char hex SHA-256 cache key.
 * The key encodes both the model name and the full messages array so that any
 * change to any message (role, content, order) produces a different key.
 *
 * @param {string} model    - AI model identifier (e.g. "claude-sonnet-4")
 * @param {Array}  messages - Chat messages array: [{role, content}, ...]
 * @returns {string} 64-character lowercase hex SHA-256 digest
 */
export function makeCacheKey(model, messages) {
    const payload = JSON.stringify({ model, messages });
    return createHash('sha256').update(payload, 'utf8').digest('hex');
}

/**
 * LRU Prompt Cache with TTL expiry.
 *
 * Stores complete API responses keyed by (model + messages).
 * On cache hit the entry is re-inserted at the tail of the Map so it becomes
 * the most-recently-used and is the last candidate for LRU eviction.
 */
export class PromptCache {
    /**
     * @param {Object} [options]
     * @param {number} [options.maxSize=500]  - Maximum number of cached entries (1–100 000)
     * @param {number} [options.ttl=3600]     - Time-to-live in seconds (0 = infinite)
     */
    constructor({ maxSize = 500, ttl = 3600 } = {}) {
        this.maxSize = Math.max(1, Math.min(100_000, Number(maxSize) || 500));
        this.ttlMs   = Math.max(0, Number(ttl) || 3600) * 1000;

        /** @type {Map<string, {value: any, ts: number}>} */
        this._map    = new Map();
        this._hits   = 0;
        this._misses = 0;
    }

    // ── Public API ───────────────────────────────────────────────────────────

    /**
     * Retrieve a cached response.
     * Returns null on cache miss or if the entry has expired.
     * On a valid hit the entry is promoted to MRU position.
     *
     * @param {string} model
     * @param {Array}  messages
     * @returns {any|null}
     */
    get(model, messages) {
        const key   = makeCacheKey(model, messages);
        const entry = this._map.get(key);

        if (!entry) {
            this._misses++;
            return null;
        }

        if (this.ttlMs > 0 && (Date.now() - entry.ts) > this.ttlMs) {
            this._map.delete(key);
            this._misses++;
            return null;
        }

        // Promote to MRU: delete + re-insert at tail
        this._map.delete(key);
        this._map.set(key, entry);
        this._hits++;
        return entry.value;
    }

    /**
     * Store a response in the cache.
     * If the cache is at capacity the LRU entry (Map head) is evicted first.
     * Re-inserting an existing key updates its value and promotes it to MRU.
     *
     * @param {string} model
     * @param {Array}  messages
     * @param {any}    response  - The API response object to cache
     */
    put(model, messages, response) {
        if (!model || !Array.isArray(messages) || response == null) return;

        const key = makeCacheKey(model, messages);

        // Remove existing (if any) to reset LRU position
        if (this._map.has(key)) {
            this._map.delete(key);
        } else if (this._map.size >= this.maxSize) {
            // Evict least-recently-used entry (first key in Map)
            this._map.delete(this._map.keys().next().value);
        }

        this._map.set(key, { value: response, ts: Date.now() });
    }

    /**
     * Return cache performance statistics.
     *
     * @returns {{
     *   entries:       number,
     *   hits:          number,
     *   misses:        number,
     *   hit_rate:      number,
     *   total_lookups: number,
     *   max_size:      number,
     *   ttl:           number,
     *   enabled:       boolean
     * }}
     */
    getStats() {
        const total = this._hits + this._misses;
        return {
            entries:       this._map.size,
            hits:          this._hits,
            misses:        this._misses,
            hit_rate:      total > 0 ? Math.round((this._hits / total) * 10000) / 10000 : 0,
            total_lookups: total,
            max_size:      this.maxSize,
            ttl:           this.ttlMs > 0 ? this.ttlMs / 1000 : 0,
            enabled:       true,
        };
    }

    /**
     * Remove all entries and reset hit/miss counters.
     */
    clear() {
        this._map.clear();
        this._hits   = 0;
        this._misses = 0;
    }

    /**
     * Remove all expired entries from the cache.
     * Call periodically to reclaim memory without waiting for LRU eviction.
     *
     * @returns {number} Number of entries removed
     */
    sweepExpired() {
        if (this.ttlMs === 0) return 0;
        const now     = Date.now();
        let   removed = 0;
        for (const [key, entry] of this._map) {
            if ((now - entry.ts) > this.ttlMs) {
                this._map.delete(key);
                removed++;
            }
        }
        return removed;
    }

    /**
     * Resize the cache.  If newSize < current entries, the oldest (LRU) entries
     * are evicted until the cache fits within the new limit.
     *
     * @param {number} newSize
     */
    resize(newSize) {
        this.maxSize = Math.max(1, Math.min(100_000, Number(newSize) || 1));
        while (this._map.size > this.maxSize) {
            this._map.delete(this._map.keys().next().value);
        }
    }
}

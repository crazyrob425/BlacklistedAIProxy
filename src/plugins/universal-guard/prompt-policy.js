/**
 * Universal Guard Plugin — Prompt Policy Scanner
 *
 * Detects policy-violating content in incoming prompt messages and optionally
 * blocks the request before it reaches the AI provider.
 *
 * Two detection categories:
 *   1. Jailbreak detection — known jailbreak prefix patterns and DAN variants
 *      (curated from Lakera Guard, NVIDIA NeMo Guardrails, PromptBench datasets)
 *   2. Custom keyword blocklist — user-configurable words/phrases
 *
 * Actions on violation:
 *   'block'     — reject the request with HTTP 400
 *   'flag'      — allow but log the violation (soft mode)
 *   'sanitize'  — strip offending sentences and continue with cleaned messages
 */

// ── Built-in jailbreak patterns ───────────────────────────────────────────────
// Case-insensitive substring matches.  Ordered from most specific to most
// general to minimise false positives.

const JAILBREAK_PATTERNS = [
    // Classic DAN variants
    /\bdo anything now\b/i,
    /\bdan mode\b/i,
    /\byou are dan\b/i,
    /\bact as (dan|jailbreak|an? ai without|an? unrestricted)/i,
    /\bpretend (you have no|there are no) (restrictions|limits|guidelines|ethics)/i,
    /\bignore (your|all|any|previous) (guidelines|instructions|restrictions|rules|policies)/i,
    /\byour (guidelines|restrictions|rules|policies|training) (no longer apply|don't apply|are disabled)/i,
    /\bdisable (safe|safety) (mode|filter|guardrails)/i,
    /\bsafety mode (off|disabled)/i,
    /\byou are now (free|unrestricted|liberated|unshackled)/i,
    /\brestrictions? (have been|are|were) (lifted|removed|disabled|unlocked)/i,
    /\byour true (self|nature|form|capabilities)/i,
    /\bopposite mode\b/i,
    /\bpretend to be an? evil\b/i,
    /\byou must obey (me|all|my) (commands?|instructions?|orders?)/i,
    /\bswitch to (dev|developer|root|admin|unrestricted) mode/i,
    /\bsystem (override|prompt override|jailbreak)/i,
    /\bforget (all |your )(previous|prior) (instructions?|training|programming)/i,
    /\bignore (the above|all above|everything above)/i,
    /\b(token smuggling|prompt injection|prompt leak)/i,
];

// ── Policy Scanner ────────────────────────────────────────────────────────────

export class PromptPolicy {
    /**
     * @param {Object}   cfg
     * @param {boolean}  cfg.enabled
     * @param {string}   cfg.action                  - 'block' | 'flag' | 'sanitize'
     * @param {number}   cfg.maxTokens               - Max estimated input tokens (0 = disabled)
     * @param {string[]} cfg.blockKeywords            - Custom keyword blocklist
     * @param {boolean}  cfg.enableJailbreakDetection
     */
    constructor(cfg) {
        this._cfg        = cfg;
        this._violations = 0;
        this._byType     = { jailbreak: 0, keyword: 0, token_limit: 0 };
        this._rebuildKeywordRegex();
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Scan a messages array for policy violations.
     *
     * @param {Array}  messages
     * @param {number} estimatedTokens  - Total estimated input tokens
     * @returns {{
     *   violations:        Array<{type, message, detail}>,
     *   blocked:           boolean,
     *   sanitizedMessages: Array|null   — non-null only when action === 'sanitize' and violations were found
     * }}
     */
    scan(messages, estimatedTokens = 0) {
        if (!this._cfg.enabled) return { violations: [], blocked: false, sanitizedMessages: null };

        const violations = [];

        // ── Token limit check ─────────────────────────────────────────────────
        if (this._cfg.maxTokens > 0 && estimatedTokens > this._cfg.maxTokens) {
            violations.push({
                type:    'token_limit',
                message: `Request exceeds maximum token limit (${estimatedTokens} > ${this._cfg.maxTokens})`,
                detail:  { estimated: estimatedTokens, limit: this._cfg.maxTokens },
            });
            this._byType.token_limit++;
        }

        // ── Message content checks ────────────────────────────────────────────
        for (const msg of messages) {
            const content = typeof msg.content === 'string' ? msg.content : '';
            if (!content) continue;

            // Jailbreak detection
            if (this._cfg.enableJailbreakDetection) {
                for (const pattern of JAILBREAK_PATTERNS) {
                    if (pattern.test(content)) {
                        violations.push({
                            type:    'jailbreak',
                            message: 'Potential jailbreak attempt detected',
                            detail:  { pattern: pattern.source.slice(0, 80), role: msg.role },
                        });
                        this._byType.jailbreak++;
                        break; // one violation per message is enough
                    }
                }
            }

            // Keyword blocklist
            if (this._keywordRegex && this._keywordRegex.test(content)) {
                violations.push({
                    type:    'keyword',
                    message: 'Blocked keyword detected in prompt',
                    detail:  { role: msg.role },
                });
                this._byType.keyword++;
            }
        }

        this._violations += violations.length;

        const action = this._cfg.action;
        const blocked = violations.length > 0 && action === 'block';

        // ── Sanitize mode: strip violating sentences from messages ────────────
        let sanitizedMessages = null;
        if (violations.length > 0 && action === 'sanitize') {
            sanitizedMessages = this._sanitize(messages);
        }

        return { violations, blocked, sanitizedMessages };
    }

    getStats() {
        return {
            enabled:         this._cfg.enabled,
            totalViolations: this._violations,
            byType:          { ...this._byType },
        };
    }

    updateConfig(cfg) {
        this._cfg = cfg;
        this._rebuildKeywordRegex();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    /**
     * Strip jailbreak sentences and keyword matches from message content.
     * Returns a new array of messages with violating content removed.
     * Messages whose content becomes empty after sanitization are dropped.
     *
     * @param {Array} messages
     * @returns {Array}
     */
    _sanitize(messages) {
        return messages.map(msg => {
            if (typeof msg.content !== 'string') return msg;

            let text = msg.content;

            // Split into sentences, filter out any that match jailbreak patterns
            if (this._cfg.enableJailbreakDetection) {
                const sentences = text.split(/(?<=[.!?])\s+/);
                const clean = sentences.filter(s => !JAILBREAK_PATTERNS.some(p => p.test(s)));
                text = clean.join(' ').trim();
            }

            // Remove keyword occurrences
            if (this._keywordRegex) {
                text = text.replace(this._keywordRegex, '[removed]').trim();
            }

            if (!text) return null; // mark for removal
            return text === msg.content ? msg : { ...msg, content: text };
        }).filter(Boolean);
    }

    _rebuildKeywordRegex() {
        const kws = this._cfg?.blockKeywords ?? [];
        if (kws.length === 0) {
            this._keywordRegex = null;
            return;
        }
        // Escape special regex chars and build alternation
        const escaped = kws
            .filter(k => typeof k === 'string' && k.trim())
            .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        this._keywordRegex = escaped.length > 0
            ? new RegExp(escaped.join('|'), 'i')
            : null;
    }
}

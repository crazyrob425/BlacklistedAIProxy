/**
 * Universal Guard Plugin — PII Scrubber
 *
 * Detects and redacts Personally Identifiable Information (PII) and credential
 * patterns from request message content before forwarding to AI providers.
 *
 * Design principles:
 *  - Regex-based (zero ML deps, < 1 ms per message)
 *  - Each pattern class is independently enabled/disabled
 *  - Action is configurable: 'redact' (replace) or 'flag' (detect only)
 *  - Operates on string content only; non-string content is skipped
 *  - Patterns are anchored/bounded to reduce false positives
 *
 * Pattern sources:
 *  - OWASP Data Classification Guidelines
 *  - AWS secret formats: docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials
 *  - OpenAI/Anthropic key formats: platform.openai.com, console.anthropic.com
 *  - Stripe, GitHub, Google API key formats (official docs)
 */

// ── Pattern registry ──────────────────────────────────────────────────────────

import logger from '../../utils/logger.js';

/**
 * Each entry: { pattern: RegExp, label: string, severity: 'high'|'medium'|'low' }
 * Patterns are tested in order; ALL matches are replaced (global flag required).
 */
const PATTERNS = {
    email: {
        pattern:  /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
        label:    '[REDACTED_EMAIL]',
        severity: 'medium',
    },
    credit_card: {
        // Matches Visa, MC, Amex, Discover — with or without dashes/spaces
        pattern:  /\b(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|3[47][0-9]{13}|6(?:011|5[0-9]{2})[0-9]{12})(?:[-\s]?[0-9]{4})*\b/g,
        label:    '[REDACTED_CARD_NUMBER]',
        severity: 'high',
    },
    ssn: {
        // US SSN: XXX-XX-XXXX
        pattern:  /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0{4})\d{4}\b/g,
        label:    '[REDACTED_SSN]',
        severity: 'high',
    },
    phone: {
        // US/international phone numbers (+1-555-123-4567, (555) 123-4567, etc.)
        pattern:  /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
        label:    '[REDACTED_PHONE]',
        severity: 'low',
    },
    openai_key: {
        pattern:  /\bsk-[A-Za-z0-9\-_]{20,60}\b/g,
        label:    '[REDACTED_API_KEY]',
        severity: 'high',
    },
    anthropic_key: {
        pattern:  /\bsk-ant-[A-Za-z0-9\-_]{20,80}\b/g,
        label:    '[REDACTED_API_KEY]',
        severity: 'high',
    },
    google_api_key: {
        pattern:  /\bAIza[0-9A-Za-z\-_]{35}\b/g,
        label:    '[REDACTED_API_KEY]',
        severity: 'high',
    },
    aws_access_key: {
        pattern:  /\b(?:AKIA|ASIA|AROA|AIPA|ANPA|ANVA|AIDA)[A-Z0-9]{16}\b/g,
        label:    '[REDACTED_AWS_KEY]',
        severity: 'high',
    },
    aws_secret_key: {
        // 40-char base64 following "aws_secret" keywords
        pattern:  /(?:aws.?secret.?access.?key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*["']?([A-Za-z0-9/+]{40})["']?/gi,
        label:    '[REDACTED_AWS_SECRET]',
        severity: 'high',
    },
    github_token: {
        pattern:  /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/g,
        label:    '[REDACTED_GITHUB_TOKEN]',
        severity: 'high',
    },
    stripe_key: {
        pattern:  /\b(?:sk|pk)_(?:live|test)_[0-9a-zA-Z]{24,}\b/g,
        label:    '[REDACTED_STRIPE_KEY]',
        severity: 'high',
    },
    jwt: {
        // JWT tokens: eyXXX.eyXXX.XXX
        pattern:  /\bey[A-Za-z0-9\-_]{10,}\.ey[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{20,}\b/g,
        label:    '[REDACTED_JWT]',
        severity: 'high',
    },
    ipv4: {
        // IPv4 addresses — low severity (often benign in logs/code)
        pattern:  /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
        label:    '[REDACTED_IP]',
        severity: 'low',
    },
};

// ── Scrubber ──────────────────────────────────────────────────────────────────

export class PiiScrubber {
    /**
     * @param {Object} cfg
     * @param {boolean}  cfg.enabled
     * @param {string}   cfg.action          - 'redact' | 'flag'
     * @param {string[]} cfg.patterns        - Pattern class names to enable
     * @param {boolean}  cfg.logDetections   - Whether to log PII detections
     */
    constructor(cfg) {
        this._cfg        = cfg;
        this._detections = 0;
        this._byType     = {};
    }

    /**
     * Scrub PII from a messages array.
     * Returns a new array (original is not mutated).
     * If action is 'flag', messages are NOT modified but detections are counted.
     *
     * @param {Array} messages
     * @returns {{ messages: Array, detections: Array<{type, count}> }}
     */
    scrub(messages) {
        if (!this._cfg.enabled || !Array.isArray(messages)) {
            return { messages, detections: [] };
        }

        const enabledPatterns = this._cfg.patterns
            .filter(name => PATTERNS[name])
            .map(name => ({ name, ...PATTERNS[name] }));

        if (enabledPatterns.length === 0) return { messages, detections: [] };

        const detections = [];

        const scrubbed = messages.map(msg => {
            if (typeof msg.content !== 'string') return msg;

            let text       = msg.content;
            let changed    = false;
            const msgDets  = {};

            for (const { name, pattern, label } of enabledPatterns) {
                // Clone regex to reset lastIndex (global flag)
                const rx = new RegExp(pattern.source, pattern.flags);
                const matches = text.match(rx);
                if (!matches) continue;

                const count = matches.length;
                msgDets[name] = (msgDets[name] ?? 0) + count;

                if (this._cfg.action === 'redact') {
                    text    = text.replace(rx, label);
                    changed = true;
                }
            }

            for (const [type, count] of Object.entries(msgDets)) {
                detections.push({ type, count });
                this._detections        += count;
                this._byType[type]       = (this._byType[type] ?? 0) + count;
            }

            return changed ? { ...msg, content: text } : msg;
        });

        if (detections.length > 0 && this._cfg.logDetections) {
            logger.warn(`[PII Scrubber] Detected: ${detections.map(d => `${d.type}×${d.count}`).join(', ')}`);
        }

        return { messages: scrubbed, detections };
    }

    getStats() {
        return {
            enabled:          this._cfg.enabled,
            totalDetections:  this._detections,
            byType:           { ...this._byType },
        };
    }

    updateConfig(cfg) {
        this._cfg = cfg;
    }
}

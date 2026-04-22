import { describe, expect, test } from '@jest/globals';
import { PiiScrubber } from '../src/plugins/universal-guard/pii-scrubber.js';

describe('PiiScrubber', () => {
    test('does not throw when patterns config is missing or invalid', () => {
        const scrubber = new PiiScrubber({
            enabled: true,
            action: 'redact',
            patterns: null,
            logDetections: false,
        });

        expect(() => scrubber.scrub([{ role: 'user', content: 'email me at x@y.com' }])).not.toThrow();
        expect(scrubber.scrub([{ role: 'user', content: 'email me at x@y.com' }]).detections).toEqual([]);
    });

    test('continues detecting after updateConfig receives invalid patterns', () => {
        const scrubber = new PiiScrubber({
            enabled: true,
            action: 'redact',
            patterns: ['email'],
            logDetections: false,
        });

        const before = scrubber.scrub([{ role: 'user', content: 'x@y.com' }]);
        expect(before.messages[0].content).toBe('[REDACTED_EMAIL]');
        expect(before.detections).toEqual([{ type: 'email', count: 1 }]);

        scrubber.updateConfig({
            enabled: true,
            action: 'redact',
            patterns: 'email',
            logDetections: false,
        });

        const after = scrubber.scrub([{ role: 'user', content: 'x@y.com' }]);
        expect(after.detections).toEqual([]);
    });
});

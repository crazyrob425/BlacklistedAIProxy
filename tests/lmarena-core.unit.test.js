/**
 * Unit tests for lmarena-core.js
 *
 * Covers:
 *  1. SSE parsing (parseSSEStream):
 *     - JSON payload split across multiple chunks (buffer accumulation)
 *     - Stream ending without trailing newline (flush behavior)
 *     - [DONE] sentinel terminates the stream
 *     - Non-JSON data: lines are skipped deterministically (no throw)
 *  2. _callApi retry logic (LMArenaApiService):
 *     - Retries stop when REQUEST_MAX_RETRY_TIME_MS cap is exceeded
 *     - Last error is surfaced after time cap
 *     - Retries still respect REQUEST_MAX_RETRIES within the time cap
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the module under test is imported
// (babel-jest hoists jest.mock() calls to the top of the file)
// ---------------------------------------------------------------------------

jest.mock('../src/utils/logger.js', () => ({
    __esModule: true,
    default: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('../src/utils/proxy-utils.js', () => ({
    configureAxiosProxy: jest.fn(),
    configureTLSSidecar: jest.fn(cfg => cfg),
}));

jest.mock('../src/utils/common.js', () => ({
    MODEL_PROVIDER: { LMARENA_BRIDGE: 'lmarena-bridge' },
    isRetryableNetworkError: (err) =>
        ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH'].includes(err.code),
}));

jest.mock('../src/providers/provider-models.js', () => ({
    PROVIDER_MODELS: { 'lmarena-bridge': ['lmarena-auto', 'gpt-4o'] },
}));

// ---------------------------------------------------------------------------
// Import the module under test AFTER mocks are defined
// ---------------------------------------------------------------------------

import { parseSSEStream, LMArenaApiService } from '../src/providers/lmarena/lmarena-core.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build an async generator from an array of string/Buffer chunks,
 * simulating a real network stream.
 */
async function* makeStream(...chunks) {
    for (const chunk of chunks) {
        yield Buffer.from(chunk);
    }
}

/** Collect all yielded values from an async generator into an array. */
async function collect(gen) {
    const items = [];
    for await (const item of gen) {
        items.push(item);
    }
    return items;
}

/** Make a network-style error with a given code. */
function makeNetworkError(code) {
    const err = new Error(`mock network error: ${code}`);
    err.code = code;
    return err;
}

/** Make an HTTP-style axios error with a given status code. */
function makeHttpError(status) {
    const err = new Error(`Request failed with status code ${status}`);
    err.response = { status };
    return err;
}

// ---------------------------------------------------------------------------
// SSE parsing tests (parseSSEStream)
// ---------------------------------------------------------------------------

describe('parseSSEStream – SSE parsing behavior', () => {
    test('parses a single complete SSE line', async () => {
        const stream = makeStream('data: {"id":1}\n');
        const results = await collect(parseSSEStream(stream));
        expect(results).toEqual([{ id: 1 }]);
    });

    test('accumulates JSON payload split across multiple chunks', async () => {
        // The JSON is split right in the middle; the parser must buffer correctly.
        const stream = makeStream(
            'data: {"id"',   // incomplete JSON, no newline yet
            ':2,"tok":"hello"}\n'
        );
        const results = await collect(parseSSEStream(stream));
        expect(results).toEqual([{ id: 2, tok: 'hello' }]);
    });

    test('flushes remaining buffer when stream ends without trailing newline', async () => {
        // The last `data:` line has no trailing '\n' — the flush path must yield it.
        const stream = makeStream(
            'data: {"id":3,"final":true}'  // no trailing newline
        );
        const results = await collect(parseSSEStream(stream));
        expect(results).toEqual([{ id: 3, final: true }]);
    });

    test('[DONE] terminates the stream and no further chunks are yielded', async () => {
        const stream = makeStream(
            'data: {"id":4}\n',
            'data: [DONE]\n',
            'data: {"id":5}\n'  // must NOT be yielded
        );
        const results = await collect(parseSSEStream(stream));
        expect(results).toEqual([{ id: 4 }]);
    });

    test('[DONE] in flush (no trailing newline) terminates cleanly with no yield', async () => {
        const stream = makeStream(
            'data: {"id":6}\n',
            'data: [DONE]'  // no trailing newline — flush path
        );
        const results = await collect(parseSSEStream(stream));
        expect(results).toEqual([{ id: 6 }]);
    });

    test('non-JSON data: line is skipped deterministically and does not throw', async () => {
        // A keep-alive ping or SSE comment ("data: keep-alive") must be silently skipped,
        // not cause an error or stop the stream.
        const stream = makeStream(
            'data: {"id":7}\n',
            'data: keep-alive\n',       // not valid JSON — must skip
            'data: {"id":8}\n'
        );
        const results = await collect(parseSSEStream(stream));
        // Only the two valid JSON chunks should appear; the ping is silently dropped.
        expect(results).toEqual([{ id: 7 }, { id: 8 }]);
    });

    test('non-JSON data: line in flush position is skipped without throwing', async () => {
        // Same as above but the bad line is the last thing in the stream (flush path).
        const stream = makeStream(
            'data: {"id":9}\n',
            'data: not-json'   // flush path, not valid JSON
        );
        const results = await collect(parseSSEStream(stream));
        expect(results).toEqual([{ id: 9 }]);
    });

    test('empty lines and non-data SSE fields are ignored', async () => {
        const stream = makeStream(
            '\n',
            'event: content\n',
            'id: 1\n',
            'data: {"id":10}\n',
            '\n'
        );
        const results = await collect(parseSSEStream(stream));
        expect(results).toEqual([{ id: 10 }]);
    });

    test('multiple JSON chunks in a single received buffer segment', async () => {
        // Two complete `data:` lines arrive in one chunk.
        const stream = makeStream('data: {"id":11}\ndata: {"id":12}\n');
        const results = await collect(parseSSEStream(stream));
        expect(results).toEqual([{ id: 11 }, { id: 12 }]);
    });
});

// ---------------------------------------------------------------------------
// Retry cap tests (LMArenaApiService._callApi)
// ---------------------------------------------------------------------------

describe('LMArenaApiService._callApi – retry time cap', () => {
    let service;

    beforeEach(() => {
        jest.useFakeTimers();

        // Build a minimal service instance that bypasses real HTTP.
        // We set isInitialized=true and replace axiosInstance.request with a spy.
        service = new LMArenaApiService({ LMARENA_BRIDGE_URL: 'http://localhost:8000' });
        service.isInitialized = true;
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('stops retrying and surfaces last error when REQUEST_MAX_RETRY_TIME_MS is exceeded', async () => {
        // With a 1 s cap and base delay of 1 000 ms, the very first retry waits
        // 1 000 ms, after which elapsed >= 1 000 ms cap, so no second retry happens.
        service.config = {
            ...service.config,
            REQUEST_MAX_RETRIES: 10,          // high count — cap should win
            REQUEST_BASE_DELAY: 1000,         // 1 s base delay
            REQUEST_MAX_RETRY_TIME_MS: 1000,  // 1 s total cap
        };

        const networkErr = makeNetworkError('ECONNRESET');
        service.axiosInstance = { request: jest.fn().mockRejectedValue(networkErr) };

        // Attach the assertion handler BEFORE running timers to avoid unhandled rejection.
        const assertionPromise = expect(service._callApi({ model: 'test' }))
            .rejects.toMatchObject({ code: 'ECONNRESET' });

        await jest.runAllTimersAsync();
        await assertionPromise;

        // Should have been called only a small number of times (1 initial + ≤ 1 retry)
        expect(service.axiosInstance.request.mock.calls.length).toBeGreaterThanOrEqual(1);
        expect(service.axiosInstance.request.mock.calls.length).toBeLessThanOrEqual(3);
    });

    test('retries up to REQUEST_MAX_RETRIES when safely within time cap', async () => {
        // Cap is very large (1 hour); retry count limit of 2 should govern.
        service.config = {
            ...service.config,
            REQUEST_MAX_RETRIES: 2,
            REQUEST_BASE_DELAY: 100,
            REQUEST_MAX_RETRY_TIME_MS: 3_600_000,  // 1 hour — won't be hit
        };

        const networkErr = makeNetworkError('ETIMEDOUT');
        service.axiosInstance = { request: jest.fn().mockRejectedValue(networkErr) };

        const assertionPromise = expect(service._callApi({ model: 'test' }))
            .rejects.toMatchObject({ code: 'ETIMEDOUT' });

        await jest.runAllTimersAsync();
        await assertionPromise;

        // 1 initial attempt + 2 retries = 3 total
        expect(service.axiosInstance.request).toHaveBeenCalledTimes(3);
    });

    test('does not retry when REQUEST_MAX_RETRY_TIME_MS is 0', async () => {
        service.config = {
            ...service.config,
            REQUEST_MAX_RETRIES: 5,
            REQUEST_BASE_DELAY: 100,
            REQUEST_MAX_RETRY_TIME_MS: 0,  // immediate cap — no retries allowed
        };

        const networkErr = makeNetworkError('ECONNRESET');
        service.axiosInstance = { request: jest.fn().mockRejectedValue(networkErr) };

        const assertionPromise = expect(service._callApi({ model: 'test' }))
            .rejects.toMatchObject({ code: 'ECONNRESET' });

        await jest.runAllTimersAsync();
        await assertionPromise;

        // Zero-time cap: elapsed(0) >= 0 → no retry, only 1 attempt.
        expect(service.axiosInstance.request).toHaveBeenCalledTimes(1);
    });

    test('marks 429 error with shouldSwitchCredential regardless of retry cap', async () => {
        service.config = {
            ...service.config,
            REQUEST_MAX_RETRIES: 3,
            REQUEST_BASE_DELAY: 100,
            REQUEST_MAX_RETRY_TIME_MS: 30000,
        };

        const httpErr = makeHttpError(429);
        service.axiosInstance = { request: jest.fn().mockRejectedValue(httpErr) };

        const thrown = await service._callApi({ model: 'test' }).catch(e => e);
        expect(thrown.shouldSwitchCredential).toBe(true);
    });
});

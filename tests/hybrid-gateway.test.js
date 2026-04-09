import { describe, test, expect } from '@jest/globals';
import http from 'http';
import { PassThrough } from 'stream';
import { proxyToHybridGateway, shouldRouteToHybridGateway } from '../src/services/hybrid-gateway.js';

function createMockResponse() {
    const headers = new Map();
    const chunks = [];
    return {
        headersSent: false,
        statusCode: 0,
        setHeader(name, value) {
            headers.set(String(name).toLowerCase(), value);
        },
        writeHead(statusCode, maybeHeaders = undefined) {
            this.statusCode = statusCode;
            this.headersSent = true;
            if (maybeHeaders && typeof maybeHeaders === 'object') {
                for (const [name, value] of Object.entries(maybeHeaders)) {
                    this.setHeader(name, value);
                }
            }
        },
        write(chunk) {
            chunks.push(Buffer.from(chunk));
        },
        end(chunk = undefined) {
            if (chunk) {
                chunks.push(Buffer.from(chunk));
            }
            this.headersSent = true;
        },
        getBodyString() {
            return Buffer.concat(chunks).toString('utf8');
        },
        getHeader(name) {
            return headers.get(String(name).toLowerCase());
        }
    };
}

function createMockRequest(method, headers = {}, initialData = '') {
    const req = new PassThrough();
    req.method = method;
    req.headers = headers;
    req.url = '/';
    req.end(initialData);
    return req;
}

describe('Hybrid gateway routing', () => {
    test('should route only matching paths when enabled', () => {
        const config = {
            HYBRID_GATEWAY_ENABLED: true,
            HYBRID_GATEWAY_URL: 'http://127.0.0.1:9091',
            HYBRID_GATEWAY_PATHS: ['/v1/chat/completions', '/v1beta/models/*'],
            HYBRID_GATEWAY_CANARY_PERCENT: 100
        };

        expect(shouldRouteToHybridGateway(config, 'POST', '/v1/chat/completions')).toBe(true);
        expect(shouldRouteToHybridGateway(config, 'POST', '/v1beta/models/gemini-2.5:generateContent')).toBe(true);
        expect(shouldRouteToHybridGateway(config, 'POST', '/v1/messages')).toBe(false);
    });

    test('should respect canary percent', () => {
        const config = {
            HYBRID_GATEWAY_ENABLED: true,
            HYBRID_GATEWAY_URL: 'http://127.0.0.1:9091',
            HYBRID_GATEWAY_PATHS: ['/v1/chat/completions'],
            HYBRID_GATEWAY_CANARY_PERCENT: 0
        };
        expect(shouldRouteToHybridGateway(config, 'POST', '/v1/chat/completions')).toBe(false);
    });
});

describe('Hybrid gateway proxy', () => {
    test('should proxy and cache model-list responses', async () => {
        let upstreamHitCount = 0;

        const server = http.createServer((req, res) => {
            if (req.url === '/v1/models') {
                upstreamHitCount += 1;
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ source: 'gateway', hit: upstreamHitCount }));
                return;
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
        });

        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const { port } = server.address();
        const config = {
            HYBRID_GATEWAY_URL: `http://127.0.0.1:${port}`,
            HYBRID_GATEWAY_TIMEOUT_MS: 5000,
            HYBRID_GATEWAY_CACHE_ENABLED: true,
            HYBRID_GATEWAY_CACHE_TTL_MS: 60000,
            HYBRID_GATEWAY_CACHE_MAX_ENTRIES: 100,
            HYBRID_GATEWAY_CACHE_MAX_BODY_BYTES: 1024 * 1024
        };

        const req1 = createMockRequest('GET', { host: 'localhost:3000', authorization: 'Bearer test-key' });
        const res1 = createMockResponse();
        const handled1 = await proxyToHybridGateway(req1, res1, config, 'GET', '/v1/models', '');
        expect(handled1).toBe(true);
        expect(res1.statusCode).toBe(200);
        expect(JSON.parse(res1.getBodyString()).hit).toBe(1);

        const req2 = createMockRequest('GET', { host: 'localhost:3000', authorization: 'Bearer test-key' });
        const res2 = createMockResponse();
        const handled2 = await proxyToHybridGateway(req2, res2, config, 'GET', '/v1/models', '');
        expect(handled2).toBe(true);
        expect(res2.statusCode).toBe(200);
        expect(JSON.parse(res2.getBodyString()).hit).toBe(1);
        expect(res2.getHeader('x-hybrid-gateway-cache')).toBe('HIT');
        expect(upstreamHitCount).toBe(1);

        await new Promise((resolve) => server.close(resolve));
    });
});

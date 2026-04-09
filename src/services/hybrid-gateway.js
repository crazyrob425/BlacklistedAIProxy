import http from 'http';
import https from 'https';
import logger from '../utils/logger.js';

const httpAgent = new http.Agent({
    keepAlive: true,
    maxSockets: 256,
    maxFreeSockets: 64
});

const httpsAgent = new https.Agent({
    keepAlive: true,
    maxSockets: 256,
    maxFreeSockets: 64
});

const gatewayCache = new Map();

function normalizePaths(paths) {
    if (!Array.isArray(paths)) {
        return [];
    }
    return paths
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function matchesPath(pathname, patterns) {
    for (const pattern of patterns) {
        if (pattern.endsWith('*')) {
            const prefix = pattern.slice(0, -1);
            if (pathname.startsWith(prefix)) {
                return true;
            }
            continue;
        }
        if (pathname === pattern) {
            return true;
        }
    }
    return false;
}

function normalizeCanaryPercent(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return 100;
    }
    return Math.max(0, Math.min(100, parsed));
}

function shouldUseCanary(percent) {
    if (percent >= 100) return true;
    if (percent <= 0) return false;
    return Math.random() * 100 < percent;
}

function sanitizeGatewayUrl(url) {
    if (typeof url !== 'string' || !url.trim()) {
        return null;
    }
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

function copyHeadersFromUpstream(upstreamRes, res) {
    for (const [name, value] of Object.entries(upstreamRes.headers)) {
        if (value === undefined) continue;
        res.setHeader(name, value);
    }
}

function getCacheKey(method, targetUrl, headers) {
    const auth = headers.authorization || '';
    const googApiKey = headers['x-goog-api-key'] || '';
    const modelProvider = headers['model-provider'] || '';
    return `${method}|${targetUrl}|${auth}|${googApiKey}|${modelProvider}`;
}

function cleanupExpiredCache(now) {
    for (const [key, value] of gatewayCache.entries()) {
        if (value.expiresAt <= now) {
            gatewayCache.delete(key);
        }
    }
}

function trimCacheToMaxEntries(maxEntries) {
    while (gatewayCache.size > maxEntries) {
        const firstKey = gatewayCache.keys().next().value;
        if (!firstKey) break;
        gatewayCache.delete(firstKey);
    }
}

function getCacheConfig(config) {
    return {
        enabled: config.HYBRID_GATEWAY_CACHE_ENABLED === true,
        ttlMs: Math.max(1000, Number(config.HYBRID_GATEWAY_CACHE_TTL_MS) || 15000),
        maxEntries: Math.max(1, Number(config.HYBRID_GATEWAY_CACHE_MAX_ENTRIES) || 200),
        maxBodyBytes: Math.max(1024, Number(config.HYBRID_GATEWAY_CACHE_MAX_BODY_BYTES) || 1024 * 1024)
    };
}

function isCacheableRequest(method, path) {
    if (method !== 'GET') return false;
    return path === '/v1/models' || path === '/v1beta/models';
}

function maybeReplyFromCache(method, targetUrl, reqHeaders, res, cacheConfig) {
    if (!cacheConfig.enabled || !isCacheableRequest(method, new URL(targetUrl).pathname)) {
        return false;
    }
    const now = Date.now();
    cleanupExpiredCache(now);
    const key = getCacheKey(method, targetUrl, reqHeaders);
    const cached = gatewayCache.get(key);
    if (!cached || cached.expiresAt <= now) {
        if (cached) gatewayCache.delete(key);
        return false;
    }
    for (const [name, value] of Object.entries(cached.headers)) {
        res.setHeader(name, value);
    }
    res.setHeader('x-hybrid-gateway-cache', 'HIT');
    res.writeHead(cached.statusCode);
    res.end(cached.body);
    return true;
}

function maybeStoreCache(method, path, targetUrl, reqHeaders, statusCode, headers, bodyBuffer, cacheConfig) {
    if (!cacheConfig.enabled || !isCacheableRequest(method, path)) {
        return;
    }
    if (statusCode < 200 || statusCode >= 300) {
        return;
    }
    if (!bodyBuffer || bodyBuffer.length === 0 || bodyBuffer.length > cacheConfig.maxBodyBytes) {
        return;
    }
    const safeHeaders = { ...headers };
    delete safeHeaders['set-cookie'];
    const key = getCacheKey(method, targetUrl, reqHeaders);
    gatewayCache.set(key, {
        statusCode,
        headers: safeHeaders,
        body: bodyBuffer,
        expiresAt: Date.now() + cacheConfig.ttlMs
    });
    trimCacheToMaxEntries(cacheConfig.maxEntries);
}

function buildGatewayTarget(gatewayBaseUrl, path, search) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const basePath = gatewayBaseUrl.pathname.endsWith('/')
        ? gatewayBaseUrl.pathname.slice(0, -1)
        : gatewayBaseUrl.pathname;
    const mergedPath = `${basePath}${normalizedPath}`;
    const target = new URL(gatewayBaseUrl.toString());
    target.pathname = mergedPath;
    target.search = search;
    return target;
}

function sanitizeForwardHeaders(headers, target) {
    const forwarded = { ...headers };
    forwarded.host = target.host;
    delete forwarded['content-length'];
    delete forwarded.connection;
    delete forwarded['proxy-connection'];
    delete forwarded['transfer-encoding'];
    delete forwarded['keep-alive'];
    delete forwarded.upgrade;
    delete forwarded.te;
    delete forwarded.trailer;
    return forwarded;
}

export function shouldRouteToHybridGateway(config, method, path) {
    if (config.HYBRID_GATEWAY_ENABLED !== true) return false;
    const parsedUrl = sanitizeGatewayUrl(config.HYBRID_GATEWAY_URL);
    if (!parsedUrl) return false;
    const patterns = normalizePaths(config.HYBRID_GATEWAY_PATHS);
    if (patterns.length === 0 || !matchesPath(path, patterns)) {
        return false;
    }
    const canaryPercent = normalizeCanaryPercent(config.HYBRID_GATEWAY_CANARY_PERCENT);
    return shouldUseCanary(canaryPercent);
}

export async function proxyToHybridGateway(req, res, config, method, path, search) {
    const gatewayBaseUrl = sanitizeGatewayUrl(config.HYBRID_GATEWAY_URL);
    if (!gatewayBaseUrl) {
        return false;
    }

    const target = buildGatewayTarget(gatewayBaseUrl, path, search);
    const targetUrl = target.toString();
    const cacheConfig = getCacheConfig(config);

    if (maybeReplyFromCache(method, targetUrl, req.headers, res, cacheConfig)) {
        return true;
    }

    const timeoutMs = Math.max(1000, Number(config.HYBRID_GATEWAY_TIMEOUT_MS) || 120000);
    const transport = target.protocol === 'https:' ? https : http;
    const agent = target.protocol === 'https:' ? httpsAgent : httpAgent;

    return await new Promise((resolve) => {
        const upstreamReq = transport.request({
            protocol: target.protocol,
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            method,
            path: `${target.pathname}${target.search}`,
            headers: sanitizeForwardHeaders(req.headers, target),
            timeout: timeoutMs,
            agent
        }, (upstreamRes) => {
            const responseHeaders = { ...upstreamRes.headers };
            res.setHeader('x-hybrid-gateway-route', 'true');
            copyHeadersFromUpstream(upstreamRes, res);
            res.writeHead(upstreamRes.statusCode || 502);

            const shouldCapture = cacheConfig.enabled && isCacheableRequest(method, path);
            const captured = [];
            let capturedBytes = 0;

            upstreamRes.on('data', (chunk) => {
                if (shouldCapture && capturedBytes <= cacheConfig.maxBodyBytes) {
                    const size = Buffer.byteLength(chunk);
                    capturedBytes += size;
                    if (capturedBytes <= cacheConfig.maxBodyBytes) {
                        captured.push(Buffer.from(chunk));
                    }
                }
                res.write(chunk);
            });

            upstreamRes.on('end', () => {
                res.end();
                if (shouldCapture && capturedBytes <= cacheConfig.maxBodyBytes) {
                    maybeStoreCache(
                        method,
                        path,
                        targetUrl,
                        req.headers,
                        upstreamRes.statusCode || 502,
                        responseHeaders,
                        Buffer.concat(captured),
                        cacheConfig
                    );
                }
                resolve(true);
            });

            upstreamRes.on('error', (error) => {
                logger.error(`[HybridGateway] Upstream response error: ${error.message}`);
                if (!res.headersSent) {
                    res.writeHead(502, { 'Content-Type': 'application/json' });
                }
                res.end(JSON.stringify({ error: { message: 'Hybrid gateway upstream response failed.' } }));
                resolve(true);
            });
        });

        upstreamReq.on('timeout', () => {
            upstreamReq.destroy(new Error(`Hybrid gateway timeout after ${timeoutMs}ms`));
        });

        upstreamReq.on('error', (error) => {
            logger.error(`[HybridGateway] Proxy error: ${error.message}`);
            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: `Hybrid gateway request failed: ${error.message}` } }));
            }
            resolve(true);
        });

        req.pipe(upstreamReq);
    });
}

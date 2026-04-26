/**
 * Token Optimizer Plugin — REST API Routes
 *
 * Exposes management endpoints under /api/token-optimizer.
 * All endpoints require admin-level authentication (UI session or API key).
 */

import logger from '../../utils/logger.js';
import { checkAuth } from '../../ui-modules/auth.js';
import { isAuthorized } from '../../utils/common.js';

function sendJson(res, status, data) {
    res.writeHead(status, {
        'Content-Type':                'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
}

async function isAuthed(req, config) {
    try {
        if (await checkAuth(req)) return true;
        if (config?.REQUIRED_API_KEY) {
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            return isAuthorized(req, url, config.REQUIRED_API_KEY);
        }
        return false;
    } catch {
        return false;
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', c => { data += c.toString(); });
        req.on('end', () => {
            try { resolve(data ? JSON.parse(data) : {}); }
            catch  { reject(new Error('Invalid JSON in request body')); }
        });
        req.on('error', reject);
    });
}

// Plugin reference set by index.js at init time
let _plugin = null;

export function setPluginRef(plugin) {
    _plugin = plugin;
}

/**
 * Handle all requests under /api/token-optimizer.
 * Returns true if the request was handled, false to fall through.
 */
export async function handleTokenOptimizerRoutes(method, path, req, res, config) {
    if (!path.startsWith('/api/token-optimizer')) return false;

    const authed = await isAuthed(req, config);
    if (!authed) {
        sendJson(res, 401, {
            success: false,
            error: { message: 'Unauthorized', code: 'UNAUTHORIZED' },
        });
        return true;
    }

    if (!_plugin) {
        sendJson(res, 503, {
            success: false,
            error: { message: 'Token Optimizer plugin is not available' },
        });
        return true;
    }

    try {
        // GET /api/token-optimizer/stats
        if (method === 'GET' && path === '/api/token-optimizer/stats') {
            const data = {
                cache:        _plugin.cache.getStats(),
                optimization: _plugin.getOptimizationStats(),
                config:       _plugin.getConfig(),
            };
            sendJson(res, 200, { success: true, data });
            return true;
        }

        // POST /api/token-optimizer/cache/clear
        if (method === 'POST' && path === '/api/token-optimizer/cache/clear') {
            _plugin.cache.clear();
            logger.info('[Token Optimizer] Cache cleared via API');
            sendJson(res, 200, {
                success: true,
                message: 'Prompt cache cleared successfully',
                data:    _plugin.cache.getStats(),
            });
            return true;
        }

        // GET /api/token-optimizer/config
        if (method === 'GET' && path === '/api/token-optimizer/config') {
            sendJson(res, 200, { success: true, data: _plugin.getConfig() });
            return true;
        }

        // POST /api/token-optimizer/config
        if (method === 'POST' && path === '/api/token-optimizer/config') {
            const body = await readBody(req);
            await _plugin.updateConfig(body);
            sendJson(res, 200, {
                success: true,
                message: 'Configuration updated',
                data:    _plugin.getConfig(),
            });
            return true;
        }

        // Catch-all 404 under /api/token-optimizer
        sendJson(res, 404, {
            success: false,
            error: { message: `No route for ${method} ${path}` },
        });
        return true;

    } catch (err) {
        logger.error('[Token Optimizer] API route error:', err.message);
        sendJson(res, 500, {
            success: false,
            error: { message: err.message },
        });
        return true;
    }
}

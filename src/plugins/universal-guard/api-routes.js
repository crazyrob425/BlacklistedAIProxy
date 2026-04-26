/**
 * Universal Guard Plugin — REST API Routes
 *
 * Exposes management endpoints under /api/universal-guard.
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
            catch  { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

let _plugin = null;

export function setPluginRef(plugin) {
    _plugin = plugin;
}

export async function handleUniversalGuardRoutes(method, path, req, res, config) {
    if (!path.startsWith('/api/universal-guard')) return false;

    const authed = await isAuthed(req, config);
    if (!authed) {
        sendJson(res, 401, { success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } });
        return true;
    }

    if (!_plugin) {
        sendJson(res, 503, { success: false, error: { message: 'Universal Guard plugin not available' } });
        return true;
    }

    try {
        // GET /api/universal-guard/stats
        if (method === 'GET' && path === '/api/universal-guard/stats') {
            sendJson(res, 200, { success: true, data: _plugin.getAllStats() });
            return true;
        }

        // GET /api/universal-guard/config
        if (method === 'GET' && path === '/api/universal-guard/config') {
            sendJson(res, 200, { success: true, data: _plugin.getConfig() });
            return true;
        }

        // POST /api/universal-guard/config
        if (method === 'POST' && path === '/api/universal-guard/config') {
            const body = await readBody(req);
            await _plugin.updateConfig(body);
            sendJson(res, 200, { success: true, message: 'Configuration updated', data: _plugin.getConfig() });
            return true;
        }

        sendJson(res, 404, { success: false, error: { message: `No route for ${method} ${path}` } });
        return true;

    } catch (err) {
        logger.error('[Universal Guard] API route error:', err.message);
        sendJson(res, 500, { success: false, error: { message: err.message } });
        return true;
    }
}

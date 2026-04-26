/**
 * Marketplace API
 *
 * Serves the plugin marketplace catalog with live plugin status.
 * Routes are registered in ui-manager.js.
 */

import { checkAuth } from './auth.js';
import { getPluginManager } from '../core/plugin-manager.js';
import { MARKETPLACE_CATALOG, MARKETPLACE_CATEGORIES } from '../core/marketplace-catalog.js';

function sendJson(res, status, data) {
    res.writeHead(status, {
        'Content-Type':                'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
}

/**
 * Augment a catalog entry with live installed/enabled status from the
 * PluginManager.
 */
function augmentEntry(entry) {
    const pm = getPluginManager();

    // Determine installed status: plugin is "installed" if it exists in the plugin map
    const plugin  = pm?.plugins?.get(entry.id);
    const cfgEntry = pm?.pluginsConfig?.plugins?.[entry.id];

    const installed = Boolean(plugin);
    const enabled   = installed
        ? (cfgEntry?.enabled !== false && plugin?._enabled === true)
        : false;

    return { ...entry, installed, enabled };
}

/**
 * GET /api/marketplace/catalog
 * Returns the full plugin catalog with live status.
 */
export async function handleGetCatalog(req, res) {
    try {
        const catalog = MARKETPLACE_CATALOG.map(augmentEntry);
        sendJson(res, 200, {
            success: true,
            data: {
                catalog,
                categories: MARKETPLACE_CATEGORIES,
                stats: {
                    total:     catalog.length,
                    installed: catalog.filter(p => p.installed).length,
                    enabled:   catalog.filter(p => p.enabled).length,
                    featured:  catalog.filter(p => p.featured).length,
                },
            },
        });
        return true;
    } catch (err) {
        sendJson(res, 500, { success: false, error: { message: err.message } });
        return true;
    }
}

/**
 * GET /api/marketplace/plugin/:id
 * Returns a single plugin entry with live status.
 */
export async function handleGetPlugin(req, res, pluginId) {
    const entry = MARKETPLACE_CATALOG.find(p => p.id === pluginId);
    if (!entry) {
        sendJson(res, 404, { success: false, error: { message: `Plugin '${pluginId}' not found in catalog` } });
        return true;
    }
    sendJson(res, 200, { success: true, data: augmentEntry(entry) });
    return true;
}

/**
 * Master handler — called from ui-manager.js for /api/marketplace/* paths.
 * Returns true if handled.
 */
export async function handleMarketplaceRoutes(method, path, req, res, config) {
    if (!path.startsWith('/api/marketplace')) return false;

    // Auth
    const authed = await checkAuth(req).catch(() => false);
    if (!authed) {
        sendJson(res, 401, { success: false, error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } });
        return true;
    }

    // GET /api/marketplace/catalog
    if (method === 'GET' && path === '/api/marketplace/catalog') {
        return handleGetCatalog(req, res);
    }

    // GET /api/marketplace/plugin/:id
    const pluginMatch = path.match(/^\/api\/marketplace\/plugin\/([^/]+)$/);
    if (method === 'GET' && pluginMatch) {
        return handleGetPlugin(req, res, decodeURIComponent(pluginMatch[1]));
    }

    sendJson(res, 404, { success: false, error: { message: `No marketplace route for ${method} ${path}` } });
    return true;
}

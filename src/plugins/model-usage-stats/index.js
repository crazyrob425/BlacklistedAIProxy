import logger from '../../utils/logger.js';
import { handleModelUsageStatsRoutes } from './api-routes.js';
import {
    finalizeRequest,
    getStats,
    recordStreamChunkUsage,
    recordUnaryUsage,
    resetStats,
    resetTokenStats,
    setConfigGetter
} from './stats-manager.js';

const modelUsageStatsPlugin = {
    name: 'model-usage-stats',
    version: '1.0.0',
    description: '模型用量统计插件<br>接口：<code>/api/model-usage-stats</code><br>页面：<a href="model-usage-stats.html" target="_blank">model-usage-stats.html</a>',
    type: 'middleware',
    _builtin: true,
    _priority: 9000,

    async init(config) {
        setConfigGetter(() => ({
            persistInterval: config.MODEL_USAGE_STATS_PERSIST_INTERVAL || 5000
        }));
        logger.info('[Model Usage Stats] Initialized');
    },

    async middleware(req, res, requestUrl, config) {
        const aiPaths = ['/v1/chat/completions', '/v1/responses', '/v1/messages', '/v1beta/models'];
        const isAiPath = aiPaths.some(path => requestUrl.pathname.includes(path));

        if (isAiPath && req.method === 'POST' && !config._monitorRequestId) {
            config._monitorRequestId = Date.now() + Math.random().toString(36).substring(2, 10);
        }

        return { handled: false };
    },

    routes: [
        {
            method: '*',
            path: '/api/model-usage-stats',
            handler: handleModelUsageStatsRoutes
        }
    ],

    staticPaths: ['model-usage-stats.html'],

    hooks: {
        async onUnaryResponse({ requestId, model, fromProvider, toProvider, nativeResponse, clientResponse }) {
            recordUnaryUsage({
                requestId,
                model,
                provider: toProvider,
                fromProvider,
                nativeResponse,
                clientResponse
            });
        },

        async onStreamChunk({ requestId, model, fromProvider, toProvider, nativeChunk, chunkToSend }) {
            recordStreamChunkUsage({
                requestId,
                model,
                provider: toProvider,
                fromProvider,
                nativeChunk,
                clientChunk: chunkToSend
            });
        },

        async onContentGenerated(config) {
            await finalizeRequest({
                requestId: config._monitorRequestId,
                model: config.model,
                provider: config.toProvider,
                fromProvider: config.fromProvider,
                isStream: config.isStream
            });
        }
    },

    exports: {
        getStats,
        resetStats,
        resetTokenStats
    }
};

export default modelUsageStatsPlugin;
export {
    getStats,
    resetStats,
    resetTokenStats
};

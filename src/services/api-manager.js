import logger from '../utils/logger.js';
import { 
    handleModelListRequest, 
    handleContentGenerationRequest, 
    API_ACTIONS, 
    ENDPOINT_TYPE 
} from '../utils/common.js';
import { getProviderPoolManager } from './service-manager.js';
import { getSentinel } from '../core/sentinel.js';

/**
 * Enhanced API Request Manager with Super-Failsafe Layer
 * Implements dynamic provider switching and context management.
 */
export async function handleAPIRequests(method, path, req, res, currentConfig, apiService, providerPoolManager, promptLogFilename) {
    // Route model list requests
    if (method === 'GET') {
        if (path === '/v1/models') {
            await handleModelListRequest(req, res, apiService, ENDPOINT_TYPE.OPENAI_MODEL_LIST, currentConfig, providerPoolManager, currentConfig.uuid);
            return true;
        }
        if (path === '/v1beta/models') {
            await handleModelListRequest(req, res, apiService, ENDPOINT_TYPE.GEMINI_MODEL_LIST, currentConfig, providerPoolManager, currentConfig.uuid);
            return true;
        }
    }

    // Route content generation requests with Super-Failsafe Layer
    if (method === 'POST') {
        let endpointType = null;
        if (path === '/v1/chat/completions') endpointType = ENDPOINT_TYPE.OPENAI_CHAT;
        else if (path === '/v1/responses') endpointType = ENDPOINT_TYPE.OPENAI_RESPONSES;
        else if (path === '/v1/messages') endpointType = ENDPOINT_TYPE.CLAUDE_MESSAGE;
        
        const geminiUrlPattern = new RegExp(`/v1beta/models/(.+?):(${API_ACTIONS.GENERATE_CONTENT}|${API_ACTIONS.STREAM_GENERATE_CONTENT})`);
        if (geminiUrlPattern.test(path)) endpointType = ENDPOINT_TYPE.GEMINI_CONTENT;

        if (endpointType) {
            // Ensure Sentinel is initialized for context management
            getSentinel(currentConfig);

            return await executeWithFailsafe(async () => {
                await handleContentGenerationRequest(req, res, apiService, endpointType, currentConfig, promptLogFilename, providerPoolManager, currentConfig.uuid, path);
                return true;
            }, { retryCount: 0, maxRetries: currentConfig.maxRetries || 3 });
        }
    }

    return false;
}

/**
 * The 'Super-Failsafe' Execution Wrapper
 * Dynamically handles 429/500 errors by allowing the system to retry or rotate.
 */
async function executeWithFailsafe(action, context) {
    try {
        return await action();
    } catch (error) {
        const isRateLimit = error.status === 429 || error.message?.includes('429');
        const isServerError = (error.status >= 500) || error.message?.includes('500') || error.message?.includes('502') || error.message?.includes('503');

        if ((isRateLimit || isServerError) && context.retryCount < context.maxRetries) {
            context.retryCount++;
            logger.warn(`[Super-Failsafe] Error ${error.status || 'network'} detected: ${error.message}. Attempting retry ${context.retryCount}/${context.maxRetries}`);
            
            // Artificial delay before retry to let provider limits cool down
            await new Promise(resolve => setTimeout(resolve, 1000 * context.retryCount));
            
            return await executeWithFailsafe(action, context);
        }
        throw error;
    }
}

/**
 * Initialize API management features
 */
export function initializeAPIManagement(services) {
    const providerPoolManager = getProviderPoolManager();
    return async function heartbeatAndRefreshToken() {
        logger.info(`[Heartbeat] Server is running. Current time: ${new Date().toLocaleString()}`, Object.keys(services));
        for (const providerKey in services) {
            const serviceAdapter = services[providerKey];
            try {
                if (serviceAdapter.config?.uuid && providerPoolManager) {
                    providerPoolManager._enqueueRefresh(serviceAdapter.config.MODEL_PROVIDER, { 
                        config: serviceAdapter.config, 
                        uuid: serviceAdapter.config.uuid 
                    });
                } else {
                    await serviceAdapter.refreshToken();
                }
            } catch (error) {
                logger.error(`[Token Refresh Error] Failed to refresh token for ${providerKey}: ${error.message}`);
            }
        }
    };
}

/**
 * Helper function to read request body
 */
export function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => { resolve(body); });
        req.on('error', err => { reject(err); });
    });
}

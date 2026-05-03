/**
 * LMArenaBridge Provider Core
 *
 * Forwards OpenAI-format chat requests to a running LMArenaBridge Python sidecar.
 * LMArenaBridge (https://github.com/CloudWaddie/LMArenaBridge) exposes every model
 * available on LMArena's platform (GPT-5, Claude Opus 4+, Gemini 3 Pro, etc.) as a
 * single OpenAI-compatible endpoint.
 *
 * Configuration keys (per pool node):
 *   LMARENA_BRIDGE_URL      Required. URL of the running LMArenaBridge sidecar.
 *                           e.g. "http://localhost:8000"
 *   LMARENA_BRIDGE_API_KEY  Optional. API key if the bridge requires authentication.
 *   LMARENA_MODEL_OVERRIDE  Optional. Force a specific LMArena model for all requests.
 *
 * Setup:
 *   pip install lmarenabridge camoufox
 *   python -m lmarenabridge  # or: lmarena-bridge --port 8000
 */

import axios from 'axios';
import logger from '../../utils/logger.js';
import * as http from 'http';
import * as https from 'https';
import { configureAxiosProxy, configureTLSSidecar } from '../../utils/proxy-utils.js';
import { isRetryableNetworkError, MODEL_PROVIDER } from '../../utils/common.js';

const LMARENA_HEALTH_TIMEOUT_MS = 5000;
const LMARENA_REQUEST_TIMEOUT_MS = 120000;

// Models exposed via LMArena. Keep in sync with PROVIDER_MODELS in provider-models.js.
// These mirror what LMArena typically offers; the bridge auto-routes by model name.
export const LMARENA_MODELS = [
    'lmarena-auto',
    'gpt-5',
    'gpt-5-mini',
    'claude-opus-4-7',
    'claude-opus-4-6',
    'claude-sonnet-4-6',
    'claude-opus-4-5',
    'gemini-3-pro',
    'gemini-3-flash',
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'grok-4.20',
    'grok-3',
    'deepseek-r2',
    'llama-4-scout',
    'llama-4-maverick',
    'mistral-large-3',
];

export class LMArenaApiService {
    constructor(config) {
        if (!config.LMARENA_BRIDGE_URL) {
            throw new Error(
                '[LMArena] LMARENA_BRIDGE_URL is required. ' +
                'Start the LMArenaBridge sidecar and set this to its base URL (e.g. http://localhost:8000).'
            );
        }

        this.config = config;
        this.baseUrl = config.LMARENA_BRIDGE_URL.replace(/\/$/, '');
        this.apiKey = config.LMARENA_BRIDGE_API_KEY || null;
        this.modelOverride = config.LMARENA_MODEL_OVERRIDE || null;
        this.isInitialized = false;

        const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50, timeout: LMARENA_REQUEST_TIMEOUT_MS });
        const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50, timeout: LMARENA_REQUEST_TIMEOUT_MS });

        const headers = { 'Content-Type': 'application/json' };
        if (this.apiKey) {
            headers['Authorization'] = `Bearer ${this.apiKey}`;
        }

        const axiosConfig = {
            baseURL: this.baseUrl,
            httpAgent,
            httpsAgent,
            headers,
            proxy: false,
        };

        configureAxiosProxy(axiosConfig, config, MODEL_PROVIDER.LMARENA_BRIDGE);
        this.axiosInstance = axios.create(axiosConfig);
    }

    _applySidecar(axiosConfig) {
        return configureTLSSidecar(axiosConfig, this.config, MODEL_PROVIDER.LMARENA_BRIDGE, this.baseUrl);
    }

    /**
     * Verify that the LMArenaBridge sidecar is reachable.
     * Called during pool initialization.
     */
    async initialize() {
        try {
            const axiosConfig = { method: 'get', url: '/health', timeout: LMARENA_HEALTH_TIMEOUT_MS };
            this._applySidecar(axiosConfig);
            await this.axiosInstance.request(axiosConfig);
            this.isInitialized = true;
            logger.info(`[LMArena] Sidecar reachable at ${this.baseUrl}`);
        } catch (err) {
            // Sidecar not running — mark as uninitialized but do not crash.
            // Requests will fail gracefully so the pool manager can rotate.
            logger.warn(`[LMArena] Sidecar health check failed (${this.baseUrl}): ${err.message}`);
            this.isInitialized = false;
        }
        return this.isInitialized;
    }

    /**
     * Ping the sidecar and update isInitialized status.
     */
    async healthCheck() {
        try {
            const axiosConfig = { method: 'get', url: '/health', timeout: LMARENA_HEALTH_TIMEOUT_MS };
            this._applySidecar(axiosConfig);
            await this.axiosInstance.request(axiosConfig);
            this.isInitialized = true;
            return true;
        } catch {
            this.isInitialized = false;
            return false;
        }
    }

    /**
     * Map a BAP model name to the LMArena model string.
     * "lmarena-auto" lets the bridge pick any available arena model.
     */
    _resolveModel(model) {
        if (this.modelOverride) return this.modelOverride;
        if (!model || model === 'lmarena-auto') return null; // bridge default
        return model;
    }

    async _callApi(body, isStream = false, retryCount = 0) {
        if (!this.isInitialized) {
            await this.initialize();
            if (!this.isInitialized) {
                const err = new Error('[LMArena] Sidecar is not available. Is it running?');
                err.shouldSwitchCredential = true;
                throw err;
            }
        }

        const maxRetries = this.config.REQUEST_MAX_RETRIES ?? 3;
        const baseDelay = this.config.REQUEST_BASE_DELAY ?? 1000;

        try {
            const resolvedModel = this._resolveModel(body.model);
            const payload = { ...body };
            if (resolvedModel !== null) payload.model = resolvedModel;
            if (resolvedModel === null) delete payload.model; // bridge picks automatically

            const axiosConfig = {
                method: 'post',
                url: '/v1/chat/completions',
                data: payload,
                timeout: LMARENA_REQUEST_TIMEOUT_MS,
            };
            if (isStream) {
                axiosConfig.responseType = 'stream';
            }
            this._applySidecar(axiosConfig);
            const response = await this.axiosInstance.request(axiosConfig);
            return response;
        } catch (error) {
            const status = error.response?.status;
            const isNetworkError = isRetryableNetworkError(error);

            if (status === 503 || (isNetworkError && retryCount < maxRetries)) {
                const delay = baseDelay * Math.pow(2, retryCount);
                logger.warn(`[LMArena] Retrying (attempt ${retryCount + 1}/${maxRetries}) after ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                return this._callApi(body, isStream, retryCount + 1);
            }

            if (status === 429 || status === 401 || status === 403) {
                error.shouldSwitchCredential = true;
            }
            if (status >= 500 && status < 600 && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                logger.warn(`[LMArena] Server error ${status}, retrying in ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                return this._callApi(body, isStream, retryCount + 1);
            }

            logger.error(`[LMArena] API error (status=${status || error.code}): ${error.message}`);
            throw error;
        }
    }

    async generateContent(model, requestBody) {
        // Strip internal BAP metadata fields
        const body = { ...requestBody, model };
        delete body._monitorRequestId;
        delete body._requestBaseUrl;

        const response = await this._callApi(body, false);
        return response.data;
    }

    async *generateContentStream(model, requestBody) {
        const body = { ...requestBody, model };
        delete body._monitorRequestId;
        delete body._requestBaseUrl;

        const response = await this._callApi(body, true);
        const stream = response.data;
        let buffer = '';

        for await (const chunk of stream) {
            buffer += chunk.toString();
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.substring(0, newlineIndex).trim();
                buffer = buffer.substring(newlineIndex + 1);

                if (!line.startsWith('data: ')) continue;
                const jsonData = line.substring(6).trim();
                if (jsonData === '[DONE]') return;

                try {
                    yield JSON.parse(jsonData);
                } catch {
                    logger.debug('[LMArena] Skipping non-JSON SSE line:', jsonData);
                }
            }
        }
    }

    async listModels() {
        try {
            const axiosConfig = {
                method: 'get',
                url: '/v1/models',
                timeout: LMARENA_HEALTH_TIMEOUT_MS,
            };
            this._applySidecar(axiosConfig);
            const response = await this.axiosInstance.request(axiosConfig);
            return response.data;
        } catch (err) {
            logger.warn(`[LMArena] listModels failed: ${err.message}`);
            // Fallback: return static model list
            return {
                object: 'list',
                data: LMARENA_MODELS.map(id => ({
                    id,
                    object: 'model',
                    created: 0,
                    owned_by: 'lmarena-bridge',
                })),
            };
        }
    }

    isExpiryDateNear() {
        // LMArenaBridge manages its own token refresh internally.
        return false;
    }
}

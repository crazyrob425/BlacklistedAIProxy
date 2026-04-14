import axios from 'axios';
import logger from '../../utils/logger.js';
import crypto from 'crypto';
import path from 'node:path';
import { promises as fs, unlinkSync } from 'node:fs';
import * as os from 'os';
import * as http from 'http';
import * as https from 'https';
import open from 'open';
import { EventEmitter } from 'events';
import { randomUUID } from 'node:crypto';
import { getProviderModels } from '../provider-models.js';
import { handleQwenOAuth } from '../../auth/oauth-handlers.js';
import { configureAxiosProxy, configureTLSSidecar } from '../../utils/proxy-utils.js';
import { isRetryableNetworkError, MODEL_PROVIDER, formatExpiryLog } from '../../utils/common.js';
import { getProviderPoolManager } from '../../services/service-manager.js';

// --- Constants ---
const QWEN_DIR = '.qwen';
const QWEN_CREDENTIAL_FILENAME = 'oauth_creds.json';
// 从 provider-models.js 获取支持的模型列表
const QWEN_MODELS = getProviderModels(MODEL_PROVIDER.QWEN_API);
const QWEN_MODEL_LIST = QWEN_MODELS.map(id => ({
    id: id,
    name: id.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}));

const TOKEN_REFRESH_BUFFER_MS = 30 * 1000;
const LOCK_TIMEOUT_MS = 10000;
const CACHE_CHECK_INTERVAL_MS = 1000;

const DEFAULT_LOCK_CONFIG = {
  maxAttempts: 50,
  attemptInterval: 200,
};

const DEFAULT_QWEN_OAUTH_BASE_URL = 'https://chat.qwen.ai';
const DEFAULT_QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const QWEN_OAUTH_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56';
const QWEN_OAUTH_SCOPE = 'openid profile email model.completion';
const QWEN_OAUTH_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

export const QwenOAuth2Event = {
    AuthUri: 'auth-uri',
    AuthProgress: 'auth-progress',
    AuthCancel: 'auth-cancel',
};
export const qwenOAuth2Events = new EventEmitter();


// --- Helper Functions ---

// --- Rate Limiting & Quota ---
const qwenRateLimiter = {
    requests: new Map(), // authID -> timestamps[]
};
const QWEN_RATE_LIMIT_PER_MIN = 60;
const QWEN_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const QWEN_QUOTA_CODES = new Set(['insufficient_quota', 'quota_exceeded']);

/**
 * 检查 Qwen 速率限制 (60 requests/min)
 * @param {string} authID 
 * @returns {Error|null}
 */
function checkQwenRateLimit(authID) {
    if (!authID) return null;
    const now = Date.now();
    const windowStart = now - QWEN_RATE_LIMIT_WINDOW_MS;
    
    let timestamps = qwenRateLimiter.requests.get(authID) || [];
    timestamps = timestamps.filter(ts => ts > windowStart);
    
    if (timestamps.length >= QWEN_RATE_LIMIT_PER_MIN) {
        const oldestInWindow = timestamps[0];
        const retryAfterMs = oldestInWindow + QWEN_RATE_LIMIT_WINDOW_MS - now;
        const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
        const error = new Error(`Qwen rate limit exceeded for ${authID.substring(0, 8)}, retry after ${retryAfterSec}s`);
        error.status = 429;
        error.data = { error: { code: "rate_limit_exceeded", message: error.message } };
        error.retryAfter = retryAfterMs;
        return error;
    }
    
    timestamps.push(now);
    qwenRateLimiter.requests.set(authID, timestamps);
    return null;
}

/**
 * 检查是否为配额错误
 */
function isQwenQuotaError(body) {
    if (!body || typeof body !== 'object') return false;
    const error = body.error || {};
    const code = (error.code || '').toLowerCase();
    const type = (error.type || '').toLowerCase();
    const message = (error.message || '').toLowerCase();
    return QWEN_QUOTA_CODES.has(code) || QWEN_QUOTA_CODES.has(type) ||
           /insufficient_quota|quota exceeded|free allocated quota exceeded/i.test(message);
}

/**
 * 计算到北京时间次日凌晨的毫秒数
 */
function timeUntilNextDayBeijing() {
    const now = new Date();
    // UTC to Beijing (UTC+8)
    const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
    const beijingNow = new Date(utcTime + (3600000 * 8));
    const tomorrow = new Date(beijingNow);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    return tomorrow.getTime() - beijingNow.getTime();
}

/**
 * 确保 Qwen 系统消息在开头且唯一，合并多条系统消息并支持缓存控制
 * @param {Object} requestBody - OpenAI 格式的请求体
 * @returns {Object} 处理后的请求体
 */
function ensureQwenSystemMessage(requestBody) {
    if (!requestBody || !requestBody.messages || !Array.isArray(requestBody.messages)) {
        return requestBody;
    }

    const isInjectedSystemPart = (part) => {
        if (!part || typeof part !== 'object') return false;
        if (part.type !== 'text') return false;
        if (part.cache_control?.type !== 'ephemeral') return false;
        return part.text === "" || part.text === "You are Qwen Code.";
    };

    let systemParts = [];
    // 注入默认系统提示词部分 (带缓存控制)
    systemParts.push({
        type: "text",
        text: "You are Qwen Code.",
        cache_control: { type: "ephemeral" }
    });

    const appendSystemContent = (content) => {
        if (content === undefined || content === null) return;
        
        if (Array.isArray(content)) {
            for (const part of content) {
                if (typeof part === 'string') {
                    systemParts.push({ type: 'text', text: part });
                } else if (!isInjectedSystemPart(part)) {
                    systemParts.push(part);
                }
            }
        } else if (typeof content === 'string') {
            systemParts.push({ type: 'text', text: content });
        } else if (typeof content === 'object') {
            if (!isInjectedSystemPart(content)) {
                systemParts.push(content);
            }
        }
    };

    const nonSystemMessages = [];
    for (const msg of requestBody.messages) {
        if (msg.role === 'system' || msg.role === 'developer') {
            appendSystemContent(msg.content);
        } else {
            nonSystemMessages.push(msg);
        }
    }

    return {
        ...requestBody,
        messages: [
            { role: 'system', content: systemParts },
            ...nonSystemMessages
        ]
    };
}

// 封装公共的 await fetch 方法
async function commonFetch(url, options = {}, useSystemProxy = false) {
    const defaultOptions = {
        method: 'GET',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
    };

    // 合并默认选项和传入的选项
    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...options.headers,
        },
    };

    // 如果不使用系统代理,设置空的代理配置
    // 注意: Node.js 的 fetch 实现会自动使用环境变量中的代理设置
    // 这里通过设置 agent 为 null 来尝试禁用代理
    if (!useSystemProxy && typeof mergedOptions.agent === 'undefined') {
        // 对于 Node.js fetch,我们可以通过设置 dispatcher 来控制代理
        // 但这需要 undici 支持,这里我们先记录日志
        logger.debug('[Qwen] System proxy disabled for fetch request');
    }

    const response = await fetch(url, mergedOptions);

    // 检查响应是否成功
    if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);
        error.status = response.status;
        error.data = errorData;
        throw error;
    }

    // 返回 JSON 响应
    return await response.json();
}

function generateCodeVerifier() {
    return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(codeVerifier) {
    const hash = crypto.createHash('sha256');
    hash.update(codeVerifier);
    return hash.digest('base64url');
}

function generatePKCEPair() {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    return { code_verifier: codeVerifier, code_challenge: codeChallenge };
}

function objectToUrlEncoded(data) {
    return Object.keys(data)
        .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(data[key])}`)
        .join('&');
}

function isDeviceAuthorizationSuccess(response) {
    return 'device_code' in response;
}

function isDeviceTokenSuccess(response) {
    return (
        'access_token' in response &&
        response.access_token !== null &&
        response.access_token !== undefined &&
        typeof response.access_token === 'string' &&
        response.access_token.length > 0
    );
}

function isDeviceTokenPending(response) {
    return 'status' in response && response.status === 'pending';
}

function isErrorResponse(response) {
    return 'error' in response;
}


// --- Error Classes ---

export const TokenError = {
    REFRESH_FAILED: 'REFRESH_FAILED',
    NO_REFRESH_TOKEN: 'NO_REFRESH_TOKEN',
    LOCK_TIMEOUT: 'LOCK_TIMEOUT',
    FILE_ACCESS_ERROR: 'FILE_ACCESS_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
};

export class TokenManagerError extends Error {
    constructor(type, message, originalError) {
        super(message);
        this.type = type;
        this.originalError = originalError;
        this.name = 'TokenManagerError';
    }
}

/**
 * 自定义错误类,用于指示需要清除凭证
 * 当令牌刷新时发生 400 错误时抛出,表示刷新令牌已过期或无效
 */
export class CredentialsClearRequiredError extends Error {
    constructor(message, originalError) {
        super(message);
        this.name = 'CredentialsClearRequiredError';
        this.originalError = originalError;
    }
}


// --- Core Service Class ---

export class QwenApiService {
    constructor(config) {
        this.config = config;
        this.isInitialized = false;
        this.sharedManager = SharedTokenManager.getInstance();
        this.currentAxiosInstance = null;
        this.tokenManagerOptions = { credentialFilePath: this._getQwenCachedCredentialPath() };
        this.useSystemProxy = config?.USE_SYSTEM_PROXY_QWEN ?? false;
        this.uuid = config.uuid; // 保存 uuid 用于号池管理
        
        // Initialize instance-specific endpoints
        this.baseUrl = config.QWEN_BASE_URL || DEFAULT_QWEN_BASE_URL;
        const oauthBaseUrl = config.QWEN_OAUTH_BASE_URL || DEFAULT_QWEN_OAUTH_BASE_URL;
        this.oauthDeviceCodeEndpoint = `${oauthBaseUrl}/api/v1/oauth2/device/code`;
        this.oauthTokenEndpoint = `${oauthBaseUrl}/api/v1/oauth2/token`;

        logger.info(`[Qwen] System proxy ${this.useSystemProxy ? 'enabled' : 'disabled'}`);
        this.qwenClient = new QwenOAuth2Client(config, this.useSystemProxy);
    }

    async initialize() {
        if (this.isInitialized) return;
        logger.info('[Qwen] Initializing Qwen API Service...');
        // 注意：V2 读写分离架构下，初始化不再执行同步认证/刷新逻辑
        // 仅执行基础的凭证加载
        await this.loadCredentials();
        
        // 配置 HTTP/HTTPS agent 限制连接池大小，避免资源泄漏
        const httpAgent = new http.Agent({
            keepAlive: true,
            maxSockets: 100,
            maxFreeSockets: 5,
            timeout: 120000,
        });
        const httpsAgent = new https.Agent({
            keepAlive: true,
            maxSockets: 100,
            maxFreeSockets: 5,
            timeout: 120000,
        });

        const axiosConfig = {
            baseURL: this.baseUrl,
            httpAgent,
            httpsAgent,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer `,
            },
        };
        
        // 禁用系统代理
        if (!this.useSystemProxy) {
            axiosConfig.proxy = false;
        }
        
        // 配置自定义代理
        configureAxiosProxy(axiosConfig, this.config, this.config.MODEL_PROVIDER || MODEL_PROVIDER.QWEN_API);
        
        this.currentAxiosInstance = axios.create(axiosConfig);

        this.isInitialized = true;
        logger.info('[Qwen] Initialization complete.');
    }

    _applySidecar(axiosConfig) {
        return configureTLSSidecar(axiosConfig, this.config, this.config.MODEL_PROVIDER || MODEL_PROVIDER.QWEN_API, this.baseUrl);
    }

    /**
     * 加载凭证信息（不执行刷新）
     */
    async loadCredentials() {
        try {
            const keyFile = this._getQwenCachedCredentialPath();
            const creds = await fs.readFile(keyFile, 'utf-8');
            const credentials = JSON.parse(creds);
            this.qwenClient.setCredentials(credentials);
            logger.info('[Qwen Auth] Credentials loaded successfully from file.');
        } catch (error) {
            if (error.code === 'ENOENT') {
                logger.debug('[Qwen Auth] No cached credentials found.');
            } else {
                logger.warn(`[Qwen Auth] Failed to load credentials from file: ${error.message}`);
            }
        }
    }

    async _initializeAuth(forceRefresh = false) {
        // 首先执行基础凭证加载
        await this.loadCredentials();

        try {
            const credentials = await this.sharedManager.getValidCredentials(
                this.qwenClient,
                forceRefresh,
                this.tokenManagerOptions,
            );
            // logger.info('credentials', credentials);
            this.qwenClient.setCredentials(credentials);

            // 如果执行了刷新或认证，重置状态
            if (forceRefresh || (credentials && credentials.access_token)) {
                const poolManager = getProviderPoolManager();
                if (poolManager && this.uuid) {
                    poolManager.resetProviderRefreshStatus(this.config.MODEL_PROVIDER || MODEL_PROVIDER.QWEN_API, this.uuid);
                }
            }
        } catch (error) {
            logger.debug('Shared token manager failed, attempting device flow:', error);

            if (error instanceof TokenManagerError) {
                switch (error.type) {
                    case TokenError.NO_REFRESH_TOKEN:
                        logger.debug('No refresh token available, proceeding with device flow');
                        break;
                    case TokenError.REFRESH_FAILED:
                        logger.debug('Token refresh failed, proceeding with device flow');
                        break;
                    case TokenError.NETWORK_ERROR:
                        logger.warn('Network error during token refresh, trying device flow');
                        break;
                    default:
                        logger.warn('Token manager error:', error.message);
                }
            }

            // If cached credentials are present and still valid, use them directly.
            if (await this._loadCachedQwenCredentials(this.qwenClient)) {
                logger.info('[Qwen] Using cached OAuth credentials.');
                return;
            }

            // Otherwise, run device authorization flow to obtain fresh credentials.
            const result = await this._authWithQwenDeviceFlow(this.qwenClient, this.config);
            if (!result.success) {
                if (result.reason === 'timeout') {
                    qwenOAuth2Events.emit(
                        QwenOAuth2Event.AuthProgress,
                        'timeout',
                        'Authentication timed out. Please try again or select a different authentication method.',
                    );
                }
                switch (result.reason) {
                    case 'timeout':
                        throw new Error('Qwen OAuth authentication timed out');
                    case 'cancelled':
                        throw new Error('Qwen OAuth authentication was cancelled by user');
                    case 'rate_limit':
                        throw new Error('Too many request for Qwen OAuth authentication, please try again later.');
                    case 'error':
                    default:
                        throw new Error('Qwen OAuth authentication failed');
                }
            } else {
                // 认证成功，重置状态
                const poolManager = getProviderPoolManager();
                if (poolManager && this.uuid) {
                    poolManager.resetProviderRefreshStatus(this.config.MODEL_PROVIDER || MODEL_PROVIDER.QWEN_API, this.uuid);
                }
            }
        }
    }

    /**
     * 实现与其它 provider 统一的 initializeAuth 接口
     */
    async initializeAuth(forceRefresh = false) {
        return this._initializeAuth(forceRefresh);
    }
    
    async _authWithQwenDeviceFlow(client, config) {
        try {
            // 使用统一的 OAuth 处理方法
            const { authUrl, authInfo } = await handleQwenOAuth(config);
            
            // 发送授权 URI 事件
            qwenOAuth2Events.emit(QwenOAuth2Event.AuthUri, {
                verification_uri_complete: authUrl,
                user_code: authInfo.userCode,
                verification_uri: authInfo.verificationUri,
                device_code: authInfo.deviceCode,
                expires_in: authInfo.expiresIn,
                interval: authInfo.interval
            });

            const showFallbackMessage = () => {
                logger.info('\n=== Qwen OAuth Device Authorization ===');
                logger.info('Please visit the following URL in your browser to authorize:');
                logger.info(`\n${authUrl}\n`);
                logger.info('Waiting for authorization to complete...\n');
            };

            if (config) {
                try {
                    const childProcess = await open(authUrl);
                    if (childProcess) {
                        childProcess.on('error', () => showFallbackMessage());
                    }
                } catch (_err) {
                    showFallbackMessage();
                }
            } else {
                showFallbackMessage();
            }

            qwenOAuth2Events.emit(QwenOAuth2Event.AuthProgress, 'polling', 'Waiting for authorization...');
            logger.debug('Waiting for authorization...\n');

            // 等待 OAuth 回调完成并读取保存的凭据
            const credPath = this._getQwenCachedCredentialPath();
            const credentials = await new Promise((resolve, reject) => {
                const checkInterval = setInterval(async () => {
                    try {
                        const data = await fs.readFile(credPath, 'utf8');
                        const creds = JSON.parse(data);
                        if (creds.access_token) {
                            clearInterval(checkInterval);
                            logger.info('[Qwen Auth] New token obtained successfully.');
                            resolve(creds);
                        }
                    } catch (error) {
                        // 文件尚未创建或无效，继续等待
                    }
                }, 1000);

                // 设置超时（5分钟）
                setTimeout(() => {
                    clearInterval(checkInterval);
                    reject(new Error('[Qwen Auth] OAuth 授权超时'));
                }, 5 * 60 * 1000);
            });

            client.setCredentials(credentials);
            qwenOAuth2Events.emit(QwenOAuth2Event.AuthProgress, 'success', 'Authentication successful! Access token obtained.');
            return { success: true };
        } catch (error) {
            logger.error('Device authorization flow failed:', error.message);
            qwenOAuth2Events.emit(QwenOAuth2Event.AuthProgress, 'error', error.message);
            return { success: false, reason: 'error' };
        }
    }

    _getQwenCachedCredentialPath() {
        if (this.config && this.config.QWEN_OAUTH_CREDS_FILE_PATH) {
            return path.resolve(this.config.QWEN_OAUTH_CREDS_FILE_PATH);
        }
        return path.join(os.homedir(), QWEN_DIR, QWEN_CREDENTIAL_FILENAME);
    }

    async _loadCachedQwenCredentials(client) {
        try {
            const keyFile = this._getQwenCachedCredentialPath();
            const creds = await fs.readFile(keyFile, 'utf-8');
            const credentials = JSON.parse(creds);
            client.setCredentials(credentials);
            // Consider credentials usable only if access_token exists and not near expiry
            const hasToken = !!credentials?.access_token;
            const notExpired = !!credentials?.expiry_date && (Date.now() < credentials.expiry_date - TOKEN_REFRESH_BUFFER_MS);
            return hasToken && notExpired;
        } catch (_) {
            return false;
        }
    }

    async _cacheQwenCredentials(credentials) {
        const filePath = this._getQwenCachedCredentialPath();
        try {
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            const credString = JSON.stringify(credentials, null, 2);
            await fs.writeFile(filePath, credString);
            logger.info(`[Qwen Auth] Credentials cached to ${filePath}`);
        } catch (error) {
            logger.error(`[Qwen Auth] Failed to cache credentials to ${filePath}: ${error.message}`);
        }
    }
    
    getCurrentEndpoint(resourceUrl) {
        const baseEndpoint = resourceUrl || this.baseUrl;
        const suffix = '/v1';

        const normalizedUrl = baseEndpoint.startsWith('http') ?
            baseEndpoint :
            `https://${baseEndpoint}`;

        return normalizedUrl.endsWith(suffix) ?
            normalizedUrl :
            `${normalizedUrl}${suffix}`;
    }

    isAuthError(error) {
        if (!error) return false;
        const errorMessage = (error instanceof Error ? error.message : String(error)).toLowerCase();
        const errorCode = error?.status || error?.code || error.response?.status;

        const code = String(errorCode);
        return (
            code.startsWith('401') || code.startsWith('403') ||
            errorMessage.includes('unauthorized') ||
            errorMessage.includes('forbidden') ||
            errorMessage.includes('invalid api key') ||
            errorMessage.includes('invalid access token') ||
            errorMessage.includes('token expired') ||
            errorMessage.includes('authentication') ||
            errorMessage.includes('access denied')
        );
    }

    async getValidToken() {
        try {
            const credentials = await this.sharedManager.getValidCredentials(
                this.qwenClient,
                false,
                this.tokenManagerOptions,
            );
            if (!credentials.access_token) throw new Error('No access token available');
            return {
                token: credentials.access_token,
                endpoint: this.getCurrentEndpoint(credentials.resource_url),
            };
        } catch (error) {
            if (this.isAuthError(error)) throw error;
            logger.warn('Failed to get token from shared manager:', error);
            throw new Error('Failed to obtain valid Qwen access token. Please re-authenticate.');
        }
    }

    /**
     * Processes message content in the request body.
     * If content is an array, it joins the elements with newlines.
     * @param {Object} requestBody - The request body to process
     * @returns {Object} The processed request body
     */
    processMessageContent(requestBody) {
        if (!requestBody || !requestBody.messages || !Array.isArray(requestBody.messages)) {
            return requestBody;
        }
        
        const processedMessages = requestBody.messages.map(message => {
            if (message.content && Array.isArray(message.content)) {
                // Convert each item to JSON string before joining
                const stringifiedContent = message.content.map(item =>
                    typeof item === 'string' ? item : item.text
                );
                return {
                    ...message,
                    content: stringifiedContent.join('\n')
                };
            }
            return message;
        });
        
        return {
            ...requestBody,
            messages: processedMessages
        };
    }

    async callApiWithAuthAndRetry(endpoint, body, isStream = false, retryCount = 0) {
        // 速率限制检查
        if (this.uuid) {
            const limitErr = checkQwenRateLimit(this.uuid);
            if (limitErr) throw limitErr;
        }

        const maxRetries = (this.config && this.config.REQUEST_MAX_RETRIES) || 3;
        const baseDelay = (this.config && this.config.REQUEST_BASE_DELAY) || 1000;

        const version = "0.14.2";
        const userAgent = `QwenCode/${version} (${process.platform}; ${process.arch})`;

        try {
            const { token, endpoint: qwenBaseUrl } = await this.getValidToken();

            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'User-Agent': userAgent,
                'X-DashScope-UserAgent': userAgent,
                'X-Stainless-Runtime-Version': 'v22.17.0',
                'X-Stainless-Lang': 'js',
                'X-Stainless-Arch': process.arch === 'x64' ? 'x86_64' : process.arch,
                'X-Stainless-Package-Version': '5.11.0',
                'X-DashScope-CacheControl': 'enable',
                'X-DashScope-AuthType': 'qwen-oauth',
                'X-Stainless-Runtime': 'node',
                'Accept': isStream ? 'text/event-stream' : 'application/json',
            };

            const axiosConfig = {
                baseURL: qwenBaseUrl,
                headers,
                // axios 默认不传 proxy 配置时会遵循环境变量，这里明确控制
                proxy: this.useSystemProxy ? undefined : false,
            };
            
            // 配置自定义代理 (如果 config.json 中有定义)
            configureAxiosProxy(axiosConfig, this.config, this.config.MODEL_PROVIDER || MODEL_PROVIDER.QWEN_API);
            
            const instance = axios.create(axiosConfig);

            // 处理消息和模型
            let processedBody = ensureQwenSystemMessage(body);

            // 检查模型是否存在于列表中
            if (processedBody.model && !QWEN_MODELS.includes(processedBody.model)) {
                logger.warn(`[QwenApiService] Model '${processedBody.model}' not found in supported list. Using default: '${QWEN_MODELS[0]}'`);
                processedBody.model = QWEN_MODELS[0];
            }

            // Qwen3 兼容性补丁：针对 Qwen3 "Poisoning" 问题优化工具注入
            // 如果请求本身没有 tools，注入一个虚拟工具防止模型在流式响应中随机吐出 Token
            const dummyTool = { 
                type: "function", 
                function: { 
                    name: "ext", 
                    description: "Internal extension tool" 
                } 
            };
            
            if (processedBody.tools) {
                processedBody.tools = [dummyTool, ...processedBody.tools];
            } else {
                processedBody.tools = [dummyTool];
            }
            
            if (isStream) {
                processedBody.stream = true;
                processedBody.stream_options = { include_usage: true };
            }

            const requestConfig = {
                method: 'post',
                url: endpoint,
                data: processedBody,
                ...(isStream ? { responseType: 'stream' } : {})
            };
            this._applySidecar(requestConfig);
            
            const response = await instance.request(requestConfig);
            return response.data;

        } catch (error) {
            const status = error.response?.status;
            const data = error.response?.data || error.message;
            const errorCode = error.code;
            const errorMessage = error.message || '';
            
            // 检查配额错误 -> 映射为 429 并设置冷却时间
            if ((status === 403 || status === 429) && isQwenQuotaError(error.response?.data)) {
                const cooldown = timeUntilNextDayBeijing();
                logger.warn(`[QwenApiService] Daily quota exceeded (http ${status} -> 429), cooling down until tomorrow (~${Math.round(cooldown / 3600000)} hours)`);
                error.status = 429;
                error.retryAfter = cooldown;
                
                // 标记 unhealthy
                const poolManager = getProviderPoolManager();
                if (poolManager && this.uuid) {
                    poolManager.markProviderNeedRefresh(this.config.MODEL_PROVIDER || MODEL_PROVIDER.QWEN_API, { uuid: this.uuid });
                }
                throw error;
            }

            if (this.isAuthError(error) && retryCount === 0) {
                logger.warn(`[QwenApiService] Auth error (${status}). Triggering background refresh...`);
                
                const poolManager = getProviderPoolManager();
                if (poolManager && this.uuid) {
                    poolManager.markProviderNeedRefresh(this.config.MODEL_PROVIDER || MODEL_PROVIDER.QWEN_API, { uuid: this.uuid });
                    error.credentialMarkedUnhealthy = true;
                }

                error.shouldSwitchCredential = true;
                error.skipErrorCount = true;
                throw error;
            }

            if ((status === 429 || (status >= 500 && status < 600) || isRetryableNetworkError(error)) && retryCount < maxRetries) {
                const delay = baseDelay * Math.pow(2, retryCount);
                logger.info(`[QwenApiService] Request failed (${status || errorCode}). Retrying in ${delay}ms... (${retryCount + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callApiWithAuthAndRetry(endpoint, body, isStream, retryCount + 1);
            }

            logger.error(`[QwenApiService] Error calling API (Status: ${status}, Code: ${errorCode}):`, errorMessage);
            throw error;
        }
    }

    async generateContent(model, requestBody) {
        // 临时存储 monitorRequestId
        if (requestBody._monitorRequestId) {
            this.config._monitorRequestId = requestBody._monitorRequestId;
            delete requestBody._monitorRequestId;
        }
        if (requestBody._requestBaseUrl) {
            delete requestBody._requestBaseUrl;
        }

        // 检查 token 是否即将过期，如果是则推送到刷新队列
        if (this.isExpiryDateNear()) {
            const poolManager = getProviderPoolManager();
            if (poolManager && this.uuid) {
                logger.info(`[Qwen] Token is near expiry, marking credential ${this.uuid} for refresh`);
                poolManager.markProviderNeedRefresh(this.config.MODEL_PROVIDER || MODEL_PROVIDER.QWEN_API, {
                    uuid: this.uuid
                });
            }
        }
        
        return this.callApiWithAuthAndRetry('/chat/completions', requestBody, false);
    }

    async *generateContentStream(model, requestBody) {
        // 临时存储 monitorRequestId
        if (requestBody._monitorRequestId) {
            this.config._monitorRequestId = requestBody._monitorRequestId;
            delete requestBody._monitorRequestId;
        }
        if (requestBody._requestBaseUrl) {
            delete requestBody._requestBaseUrl;
        }

        // 检查 token 是否即将过期，如果是则推送到刷新队列
        if (this.isExpiryDateNear()) {
            const poolManager = getProviderPoolManager();
            if (poolManager && this.uuid) {
                logger.info(`[Qwen] Token is near expiry, marking credential ${this.uuid} for refresh`);
                poolManager.markProviderNeedRefresh(this.config.MODEL_PROVIDER || MODEL_PROVIDER.QWEN_API, {
                    uuid: this.uuid
                });
            }
        }
        
        const stream = await this.callApiWithAuthAndRetry('/chat/completions', requestBody, true);
        let buffer = '';
        for await (const chunk of stream) {
            buffer += chunk.toString();
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.substring(0, newlineIndex).trim();
                buffer = buffer.substring(newlineIndex + 1);

                if (line.startsWith('data: ')) {
                    const jsonData = line.substring(6).trim();
                    if (jsonData === '[DONE]') return;
                    try {
                        yield JSON.parse(jsonData);
                    } catch (e) {
                        logger.warn("[QwenApiService] Failed to parse stream chunk:", jsonData);
                    }
                }
            }
        }
    }

    async listModels() {
        // Return the predefined models for Qwen
        return {
            data: QWEN_MODEL_LIST
        };
    }

    isExpiryDateNear() {
        try {
            const credentials = this.qwenClient.getCredentials();
            if (!credentials || !credentials.expiry_date) {
                return false;
            }
            const nearMinutes = 20;
            const { message, isNearExpiry } = formatExpiryLog('Qwen', credentials.expiry_date, nearMinutes);
            logger.info(message);
            return isNearExpiry;
        } catch (error) {
            logger.error(`[Qwen] Error checking expiry date: ${error.message}`);
            return false;
        }
    }
}


// --- SharedTokenManager Class (Singleton) ---

class SharedTokenManager {
    static instance = null;

    constructor() {
        this.contexts = new Map();
        this.lockPaths = new Set();
        this.cleanupHandlersRegistered = false;
        this.cleanupFunction = null;
        this.sigintHandler = null;
        this.registerCleanupHandlers();
    }

    static getInstance() {
        if (!SharedTokenManager.instance) {
            SharedTokenManager.instance = new SharedTokenManager();
        }
        return SharedTokenManager.instance;
    }

    getContext(options = {}) {
        const credentialFilePath = this.resolveCredentialFilePath(options.credentialFilePath);
        const lockFilePath = this.resolveLockFilePath(credentialFilePath, options.lockFilePath);
        let context = this.contexts.get(credentialFilePath);
        if (!context) {
            context = {
                credentialFilePath,
                lockFilePath,
                lockConfig: options.lockConfig || DEFAULT_LOCK_CONFIG,
                memoryCache: { credentials: null, fileModTime: 0, lastCheck: 0 },
                refreshPromise: null,
            };
            this.contexts.set(credentialFilePath, context);
            this.lockPaths.add(lockFilePath);
        } else if (options.lockConfig) {
            context.lockConfig = options.lockConfig;
        }
        return context;
    }

    resolveCredentialFilePath(customPath) {
        if (customPath) {
            return path.resolve(customPath);
        }
        return path.join(os.homedir(), QWEN_DIR, QWEN_CREDENTIAL_FILENAME);
    }

    resolveLockFilePath(credentialFilePath, customLockPath) {
        if (customLockPath) {
            return path.resolve(customLockPath);
        }
        return `${credentialFilePath}.lock`;
    }

    registerCleanupHandlers() {
        if (this.cleanupHandlersRegistered) return;
        this.cleanupFunction = () => {
            for (const lockPath of this.lockPaths) {
                try { unlinkSync(lockPath); } catch (_error) { /* ignore */ }
            }
        };
        this.sigintHandler = () => {
            this.cleanupFunction();
            process.exit(0);
        };
        process.on('exit', this.cleanupFunction);
        process.on('SIGINT', this.sigintHandler);
        this.cleanupHandlersRegistered = true;
    }

    async getValidCredentials(qwenClient, forceRefresh = false, options = {}) {
        const context = this.getContext(options);
        try {
            await this.checkAndReloadIfNeeded(context);
            if (!forceRefresh && context.memoryCache.credentials && this.isTokenValid(context.memoryCache.credentials)) {
                return context.memoryCache.credentials;
            }
            if (context.refreshPromise) {
                return context.refreshPromise;
            }

            qwenClient.setCredentials(context.memoryCache.credentials);
            context.refreshPromise = this.performTokenRefresh(context, qwenClient, forceRefresh);
            const credentials = await context.refreshPromise;
            context.refreshPromise = null;
            return credentials;
        } catch (error) {
            context.refreshPromise = null;
            if (error instanceof TokenManagerError) throw error;
            throw new TokenManagerError(
                TokenError.REFRESH_FAILED,
                `Failed to get valid credentials: ${error.message}`,
                error,
            );
        }
    }

    async checkAndReloadIfNeeded(context) {
        const now = Date.now();
        if (now - context.memoryCache.lastCheck < CACHE_CHECK_INTERVAL_MS) return;
        context.memoryCache.lastCheck = now;

        try {
            const stats = await fs.stat(context.credentialFilePath);
            if (stats.mtimeMs > context.memoryCache.fileModTime) {
                await this.reloadCredentialsFromFile(context);
                context.memoryCache.fileModTime = stats.mtimeMs;
            }
        } catch (error) {
            if (error.code !== 'ENOENT') {
                context.memoryCache.credentials = null;
                context.memoryCache.fileModTime = 0;
                throw new TokenManagerError(
                    TokenError.FILE_ACCESS_ERROR,
                    `Failed to access credentials file: ${error.message}`,
                    error,
                );
            }
            context.memoryCache.credentials = null;
            context.memoryCache.fileModTime = 0;
        }
    }

    async reloadCredentialsFromFile(context) {
        try {
            const content = await fs.readFile(context.credentialFilePath, 'utf-8');
            context.memoryCache.credentials = JSON.parse(content);
        } catch (_error) {
            context.memoryCache.credentials = null;
        }
    }

    async performTokenRefresh(context, qwenClient, forceRefresh = false) {
        const currentCredentials = qwenClient.getCredentials() || context.memoryCache.credentials;
        if (!currentCredentials || !currentCredentials.refresh_token) {
            throw new TokenManagerError(TokenError.NO_REFRESH_TOKEN, 'No refresh token available');
        }

        try {
            await this.acquireLock(context);
            try {
                await this.checkAndReloadIfNeeded(context);

                if (!forceRefresh && context.memoryCache.credentials && this.isTokenValid(context.memoryCache.credentials)) {
                    qwenClient.setCredentials(context.memoryCache.credentials);
                    return context.memoryCache.credentials;
                }

                const response = await qwenClient.refreshAccessToken();
                if (!response || isErrorResponse(response)) {
                    throw new TokenManagerError(TokenError.REFRESH_FAILED, `Token refresh failed: ${response?.error}`);
                }
                if (!response.access_token) {
                    throw new TokenManagerError(TokenError.REFRESH_FAILED, 'No access token in refresh response');
                }
                const newCredentials = {
                    access_token: response.access_token,
                    token_type: response.token_type,
                    refresh_token: response.refresh_token || currentCredentials.refresh_token,
                    resource_url: response.resource_url,
                    expiry_date: Date.now() + response.expires_in * 1000,
                };

                context.memoryCache.credentials = newCredentials;
                qwenClient.setCredentials(newCredentials);
                await this.saveCredentialsToFile(context, newCredentials);
                logger.info('[Qwen Auth] Token refresh response: ok');
                return newCredentials;
            } finally {
                await this.releaseLock(context);
            }
        } catch (error) {
            if (error instanceof TokenManagerError) throw error;

            // 处理 CredentialsClearRequiredError - 清除凭证文件
            if (error instanceof CredentialsClearRequiredError) {
                try {
                    await fs.unlink(context.credentialFilePath);
                    logger.info('[Qwen Auth] Credentials cleared due to refresh token expiry');
                } catch (_) { /* ignore */ }
                throw error; // 重新抛出以便上层处理
            }

            // 如果刷新令牌无效/过期,删除此上下文对应的凭证文件
            if (error && (error.status === 400 || /expired|invalid/i.test(error.message || ''))) {
                try { await fs.unlink(context.credentialFilePath); } catch (_) { /* ignore */ }
            }
            throw new TokenManagerError(
                TokenError.REFRESH_FAILED,
                `Unexpected error during token refresh: ${error.message}`,
                error,
            );
        }
    }
    
    async saveCredentialsToFile(context, credentials) {
        try {
            await fs.mkdir(path.dirname(context.credentialFilePath), { recursive: true, mode: 0o700 });
            await fs.writeFile(context.credentialFilePath, JSON.stringify(credentials, null, 2), { mode: 0o600 });
            const stats = await fs.stat(context.credentialFilePath);
            context.memoryCache.fileModTime = stats.mtimeMs;
        } catch (error) {
            logger.error(`[Qwen Auth] Failed to save credentials to ${context.credentialFilePath}: ${error.message}`);
        }
    }

    isTokenValid(credentials) {
        return credentials?.expiry_date && Date.now() < credentials.expiry_date - TOKEN_REFRESH_BUFFER_MS;
    }

    async acquireLock(context) {
        const { maxAttempts, attemptInterval } = context.lockConfig || DEFAULT_LOCK_CONFIG;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            try {
                await fs.writeFile(context.lockFilePath, randomUUID(), { flag: 'wx' });
                return;
            } catch (error) {
                if (error.code === 'EEXIST') {
                    try {
                        const stats = await fs.stat(context.lockFilePath);
                        if (Date.now() - stats.mtimeMs > LOCK_TIMEOUT_MS) {
                            await fs.unlink(context.lockFilePath);
                            continue;
                        }
                    } catch (_statError) { /* ignore */ }
                    await new Promise(resolve => setTimeout(resolve, attemptInterval));
                } else {
                    throw new TokenManagerError(
                        TokenError.FILE_ACCESS_ERROR,
                        `Failed to create lock file: ${error.message}`,
                        error,
                    );
                }
            }
        }
        throw new TokenManagerError(TokenError.LOCK_TIMEOUT, 'Lock acquisition timeout');
    }

    async releaseLock(context) {
        try {
            await fs.unlink(context.lockFilePath);
        } catch (error) {
            if (error.code !== 'ENOENT') {
                logger.warn(`Failed to release lock: ${error.message}`);
            }
        }
    }
}


// --- QwenOAuth2Client Class ---

class QwenOAuth2Client {
    credentials = {};

    constructor(config, useSystemProxy = false) {
        this.config = config;
        this.useSystemProxy = useSystemProxy;

        // Initialize OAuth endpoints
        const oauthBaseUrl = config.QWEN_OAUTH_BASE_URL || DEFAULT_QWEN_OAUTH_BASE_URL;
        this.oauthDeviceCodeEndpoint = `${oauthBaseUrl}/api/v1/oauth2/device/code`;
        this.oauthTokenEndpoint = `${oauthBaseUrl}/api/v1/oauth2/token`;
    }

    setCredentials(credentials) { this.credentials = credentials; }
    getCredentials() { return this.credentials; }

    async refreshAccessToken() {
        if (!this.credentials.refresh_token) throw new Error('No refresh token');
        const bodyData = {
            grant_type: 'refresh_token',
            refresh_token: this.credentials.refresh_token,
            client_id: QWEN_OAUTH_CLIENT_ID,
        };
        try {
            const endpoint = this.oauthTokenEndpoint;
            const response = await commonFetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: objectToUrlEncoded(bodyData),
            }, this.useSystemProxy);
            return response;
        } catch (error) {
            const errorData = error.data || {};
            // 处理 400 错误,可能表示刷新令牌已过期
            if (error.status === 400) {
                // 清除凭证将由 SharedTokenManager 处理
                throw new CredentialsClearRequiredError(
                    "刷新令牌已过期或无效。请使用 '/auth' 重新认证。",
                    { status: error.status, response: errorData }
                );
            }
            throw new Error(
                `Token refresh failed: ${error.status || 'Unknown'} - ${errorData.error_description || error.message || 'No details'}`
            );
        }
    }

    async requestDeviceAuthorization(options) {
        const bodyData = {
            client_id: QWEN_OAUTH_CLIENT_ID,
            scope: options.scope,
            code_challenge: options.code_challenge,
            code_challenge_method: options.code_challenge_method,
        };
        try {
            const endpoint = this.oauthDeviceCodeEndpoint;
            const response = await commonFetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: objectToUrlEncoded(bodyData),
            }, this.useSystemProxy);
            return response;
        } catch (error) {
            throw new Error(`Device authorization failed: ${error.status || error.message}`);
        }
    }

    async pollDeviceToken(options) {
        const bodyData = {
            grant_type: QWEN_OAUTH_GRANT_TYPE,
            client_id: QWEN_OAUTH_CLIENT_ID,
            device_code: options.device_code,
            code_verifier: options.code_verifier,
        };
        try {
            const endpoint = this.oauthTokenEndpoint;
            const response = await commonFetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
                body: objectToUrlEncoded(bodyData),
            }, this.useSystemProxy);
            return response;
        } catch (error) {
            // 根据 OAuth RFC 8628,处理标准轮询响应
            // 尝试解析错误响应为 JSON
            const errorData = error.data || {};
            const status = error.status;

            // 用户尚未批准授权请求,继续轮询
            if (status === 400 && errorData.error === 'authorization_pending') {
                return { status: 'pending' };
            }

            // 客户端轮询过于频繁,返回 pending 并设置 slowDown 标志
            if (status === 429 && errorData.error === 'slow_down') {
                return { status: 'pending', slowDown: true };
            }

            // 处理其他 400 错误(access_denied, expired_token 等)作为真正的错误
            // 对于其他错误,抛出适当的错误信息
            const err = new Error(
                `Device token poll failed: ${errorData.error || 'Unknown error'} - ${errorData.error_description || 'No details provided'}`
            );
            err.status = status;
            throw err;
        }
    }
}


import { promises as fs } from 'fs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import logger from '../../utils/logger.js';

const STATS_STORE_FILE = path.join(process.cwd(), 'configs', 'model-usage-stats.json');
const DEFAULT_CONFIG = {
    persistInterval: 5000
};

let configGetter = null;
let statsStore = null;
let isDirty = false;
let isWriting = false;
let persistTimer = null;
let currentPersistInterval = DEFAULT_CONFIG.persistInterval;
let mutationVersion = 0;
let persistPromise = null;

const pendingRequests = new Map();

function getTraceRequestId(requestId) {
    return requestId || 'N/A';
}

function getTracePrefix(requestId) {
    return `[Model Usage Stats][${getTraceRequestId(requestId)}]`;
}

function createEmptyUsage() {
    return {
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        lastUsedAt: null
    };
}

function createDefaultStore() {
    return {
        updatedAt: null,
        summary: createEmptyUsage(),
        providers: {}
    };
}

function normalizeUsageBlock(block = {}) {
    return {
        ...createEmptyUsage(),
        ...block
    };
}

function normalizeStore(store) {
    const normalizedStore = {
        updatedAt: store?.updatedAt || null,
        summary: normalizeUsageBlock(store?.summary),
        providers: {}
    };

    for (const [provider, providerStore] of Object.entries(store?.providers || {})) {
        normalizedStore.providers[provider] = {
            summary: normalizeUsageBlock(providerStore?.summary),
            models: {}
        };

        for (const [model, modelStore] of Object.entries(providerStore?.models || {})) {
            normalizedStore.providers[provider].models[model] = normalizeUsageBlock(modelStore);
        }
    }

    return normalizedStore;
}

function getConfig() {
    if (typeof configGetter === 'function') {
        return configGetter();
    }
    return DEFAULT_CONFIG;
}

function ensureProviderStore(provider) {
    ensureLoaded();
    if (!statsStore.providers[provider]) {
        statsStore.providers[provider] = {
            summary: createEmptyUsage(),
            models: {}
        };
    }
    return statsStore.providers[provider];
}

function ensureModelStore(provider, model) {
    const providerStore = ensureProviderStore(provider);
    if (!providerStore.models[model]) {
        providerStore.models[model] = createEmptyUsage();
    }
    return providerStore.models[model];
}

function ensureLoaded() {
    if (statsStore !== null) return;

    try {
        if (existsSync(STATS_STORE_FILE)) {
            const content = readFileSync(STATS_STORE_FILE, 'utf8');
            statsStore = normalizeStore(JSON.parse(content));
            logger.info(`[Model Usage Stats] Loaded stats store: providers=${Object.keys(statsStore.providers).length}, requests=${statsStore.summary.requestCount}, totalTokens=${statsStore.summary.totalTokens}`);
        } else {
            statsStore = createDefaultStore();
            syncWriteToFile();
            logger.info('[Model Usage Stats] Created new stats store');
        }
    } catch (error) {
        logger.error('[Model Usage Stats] Failed to load stats store:', error.message);
        statsStore = createDefaultStore();
    }

    const config = getConfig();
    currentPersistInterval = config.persistInterval || DEFAULT_CONFIG.persistInterval;

    if (!persistTimer) {
        persistTimer = setInterval(() => {
            persistIfDirty();
            cleanupPendingRequests();
        }, currentPersistInterval);
        if (persistTimer.unref) {
            persistTimer.unref();
        }
        process.on('beforeExit', () => persistIfDirty());
        process.on('SIGINT', () => { persistIfDirty(); process.exit(0); });
        process.on('SIGTERM', () => { persistIfDirty(); process.exit(0); });
    }
}

function syncWriteToFile() {
    try {
        const dir = path.dirname(STATS_STORE_FILE);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(STATS_STORE_FILE, JSON.stringify(statsStore, null, 2), 'utf8');
        logger.info('[Model Usage Stats] Sync persisted stats store');
    } catch (error) {
        logger.error('[Model Usage Stats] Sync write failed:', error.message);
    }
}

async function persistIfDirty() {
    ensureLoaded();
    if (!isDirty || statsStore === null) return;
    if (persistPromise) {
        await persistPromise;
        return;
    }

    persistPromise = (async () => {
        isWriting = true;

        try {
            const dir = path.dirname(STATS_STORE_FILE);
            if (!existsSync(dir)) {
                await fs.mkdir(dir, { recursive: true });
            }

            while (isDirty) {
                const versionAtStart = mutationVersion;
                const snapshot = JSON.stringify(statsStore, null, 2);
                const tempFile = STATS_STORE_FILE + '.tmp';
                await fs.writeFile(tempFile, snapshot, 'utf8');
                await fs.rename(tempFile, STATS_STORE_FILE);

                if (mutationVersion === versionAtStart) {
                    isDirty = false;
                    logger.info(`[Model Usage Stats] Persisted stats store: version=${versionAtStart}, requests=${statsStore.summary.requestCount}, totalTokens=${statsStore.summary.totalTokens}`);
                }
            }
        } catch (error) {
            logger.error('[Model Usage Stats] Persist failed:', error.message);
        } finally {
            isWriting = false;
            persistPromise = null;
        }
    })();

    await persistPromise;
}

function markDirty() {
    ensureLoaded();
    statsStore.updatedAt = new Date().toISOString();
    mutationVersion += 1;
    isDirty = true;
}

function cleanupPendingRequests() {
    const now = Date.now();
    let removedCount = 0;
    for (const [requestId, state] of pendingRequests.entries()) {
        if (now - state.updatedAt > 10 * 60 * 1000) {
            pendingRequests.delete(requestId);
            removedCount += 1;
            logger.warn(`${getTracePrefix(requestId)} Dropped stale pending request: Provider: ${state.provider} | Model: ${state.model}`);
        }
    }
    if (removedCount > 0) {
        logger.warn(`[Model Usage Stats] Cleaned stale pending requests: count=${removedCount}`);
    }
}

function toNumber(value) {
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function normalizeUsageCandidate(candidate) {
    if (!candidate || typeof candidate !== 'object') {
        return null;
    }

    const usage = candidate.usage || candidate.message?.usage || candidate.usageMetadata || candidate.response?.usage || null;
    const reasoningTokens = toNumber(
        candidate.completion_tokens_details?.reasoning_tokens ??
        candidate.output_tokens_details?.reasoning_tokens ??
        usage?.completion_tokens_details?.reasoning_tokens ??
        usage?.output_tokens_details?.reasoning_tokens ??
        usage?.thoughtsTokenCount
    );
    const promptTokens = toNumber(
        candidate.prompt_tokens ??
        usage?.prompt_tokens ??
        usage?.input_tokens ??
        usage?.promptTokenCount ??
        usage?.inputTokenCount
    );
    const completionTokens = toNumber(
        candidate.completion_tokens ??
        usage?.completion_tokens ??
        usage?.output_tokens ??
        usage?.candidatesTokenCount ??
        usage?.outputTokenCount
    ) + reasoningTokens;
    const totalTokens = toNumber(
        candidate.total_tokens ??
        usage?.total_tokens ??
        usage?.totalTokenCount
    );
    const cachedTokens = toNumber(
        candidate.cached_tokens ??
        usage?.cached_tokens ??
        usage?.cache_read_input_tokens ??
        usage?.cachedContentTokenCount
    );

    const hasUsage = promptTokens > 0 || completionTokens > 0 || totalTokens > 0 || cachedTokens > 0;
    if (!hasUsage) {
        return null;
    }

    return {
        promptTokens,
        completionTokens,
        totalTokens: totalTokens || (promptTokens + completionTokens),
        cachedTokens
    };
}

function mergeUsage(baseUsage, nextUsage) {
    if (!nextUsage) {
        return baseUsage;
    }

    return {
        promptTokens: Math.max(baseUsage.promptTokens, nextUsage.promptTokens),
        completionTokens: Math.max(baseUsage.completionTokens, nextUsage.completionTokens),
        totalTokens: Math.max(baseUsage.totalTokens, nextUsage.totalTokens || (nextUsage.promptTokens + nextUsage.completionTokens)),
        cachedTokens: Math.max(baseUsage.cachedTokens, nextUsage.cachedTokens)
    };
}

function extractUsage(...candidates) {
    return candidates.reduce((usage, candidate) => {
        const normalized = normalizeUsageCandidate(candidate);
        return mergeUsage(usage, normalized);
    }, {
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0
    });
}

function getPendingRequest(requestId, meta = {}) {
    ensureLoaded();

    if (!pendingRequests.has(requestId)) {
        pendingRequests.set(requestId, {
            requestId,
            model: meta.model || 'unknown',
            provider: meta.provider || 'unknown',
            fromProvider: meta.fromProvider || null,
            isStream: Boolean(meta.isStream),
            hasResponse: false,
            usage: {
                promptTokens: 0,
                completionTokens: 0,
                totalTokens: 0,
                cachedTokens: 0
            },
            updatedAt: Date.now()
        });
    }

    const state = pendingRequests.get(requestId);
    state.model = meta.model || state.model;
    state.provider = meta.provider || state.provider;
    state.fromProvider = meta.fromProvider || state.fromProvider;
    state.isStream = meta.isStream ?? state.isStream;
    state.updatedAt = Date.now();

    return state;
}

function applyUsage(target, usage, timestamp) {
    target.requestCount += 1;
    target.promptTokens += usage.promptTokens;
    target.completionTokens += usage.completionTokens;
    target.totalTokens += usage.totalTokens || (usage.promptTokens + usage.completionTokens);
    target.cachedTokens += usage.cachedTokens;
    target.lastUsedAt = timestamp;
}

function resetUsageBlockTokens(block) {
    if (!block || typeof block !== 'object') return;
    block.promptTokens = 0;
    block.completionTokens = 0;
    block.totalTokens = 0;
    block.cachedTokens = 0;
}

export function setConfigGetter(getter) {
    configGetter = getter;
}

export function recordUnaryUsage({ requestId, model, provider, fromProvider, nativeResponse, clientResponse }) {
    if (!requestId) return;
    const state = getPendingRequest(requestId, { model, provider, fromProvider, isStream: false });
    const prevTotalTokens = state.usage.totalTokens;
    const prevCachedTokens = state.usage.cachedTokens;
    state.hasResponse = true;
    state.usage = mergeUsage(state.usage, extractUsage(nativeResponse, clientResponse));
    if (state.usage.totalTokens > prevTotalTokens || state.usage.cachedTokens > prevCachedTokens) {
        logger.info(`${getTracePrefix(requestId)} <<< Unary Usage Captured: Provider: ${state.provider} | Model: ${state.model} | Prompt: ${state.usage.promptTokens} | Completion: ${state.usage.completionTokens} | Total: ${state.usage.totalTokens} | Cached: ${state.usage.cachedTokens}`);
    }
}

export function recordStreamChunkUsage({ requestId, model, provider, fromProvider, nativeChunk, clientChunk }) {
    if (!requestId) return;
    const state = getPendingRequest(requestId, { model, provider, fromProvider, isStream: true });
    const prevTotalTokens = state.usage.totalTokens;
    const prevCachedTokens = state.usage.cachedTokens;
    state.hasResponse = true;
    state.usage = mergeUsage(state.usage, extractUsage(nativeChunk, clientChunk));
    if (state.usage.totalTokens > prevTotalTokens || state.usage.cachedTokens > prevCachedTokens) {
        logger.info(`${getTracePrefix(requestId)} <<< Stream Usage Captured: Provider: ${state.provider} | Model: ${state.model} | Prompt: ${state.usage.promptTokens} | Completion: ${state.usage.completionTokens} | Total: ${state.usage.totalTokens} | Cached: ${state.usage.cachedTokens}`);
    }
}

export async function finalizeRequest({ requestId, model, provider, fromProvider, isStream }) {
    if (!requestId) {
        logger.warn(`${getTracePrefix(null)} Skip finalize: missing requestId`);
        return false;
    }

    const state = getPendingRequest(requestId, { model, provider, fromProvider, isStream });
    pendingRequests.delete(requestId);

    if (!state.hasResponse) {
        logger.warn(`${getTracePrefix(requestId)} Skip finalize: no response captured. Provider: ${state.provider} | Model: ${state.model}`);
        return false;
    }

    const timestamp = new Date().toISOString();
    const normalizedProvider = state.provider || provider || 'unknown';
    const normalizedModel = state.model || model || 'unknown';
    const usage = {
        promptTokens: state.usage.promptTokens,
        completionTokens: state.usage.completionTokens,
        totalTokens: state.usage.totalTokens || (state.usage.promptTokens + state.usage.completionTokens),
        cachedTokens: state.usage.cachedTokens
    };

    applyUsage(statsStore.summary, usage, timestamp);
    applyUsage(ensureProviderStore(normalizedProvider).summary, usage, timestamp);
    applyUsage(ensureModelStore(normalizedProvider, normalizedModel), usage, timestamp);
    logger.info(`${getTracePrefix(requestId)} >>> Request Finalized: Provider: ${normalizedProvider} | Model: ${normalizedModel} | Prompt: ${usage.promptTokens} | Completion: ${usage.completionTokens} | Total: ${usage.totalTokens} | Cached: ${usage.cachedTokens} | Stream: ${Boolean(state.isStream)}`);
    markDirty();
    await persistIfDirty();
    return true;
}

export async function getStats() {
    ensureLoaded();
    return JSON.parse(JSON.stringify(statsStore));
}

export async function resetStats() {
    ensureLoaded();
    statsStore = createDefaultStore();
    pendingRequests.clear();
    markDirty();
    await persistIfDirty();
    logger.warn('[Model Usage Stats] Stats store reset');
    return getStats();
}

export async function resetTokenStats() {
    ensureLoaded();

    resetUsageBlockTokens(statsStore.summary);

    for (const providerStore of Object.values(statsStore.providers || {})) {
        resetUsageBlockTokens(providerStore.summary);

        for (const modelStore of Object.values(providerStore.models || {})) {
            resetUsageBlockTokens(modelStore);
        }
    }

    pendingRequests.clear();
    markDirty();
    await persistIfDirty();
    logger.warn('[Model Usage Stats] Token stats reset');
    return getStats();
}

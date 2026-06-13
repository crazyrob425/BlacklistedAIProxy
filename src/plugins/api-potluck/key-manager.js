/**
 * API 大锅饭 - Key 管理模块
 * 使用内存缓存 + 写锁 + 定期持久化，解决并发安全问题
 */

import { promises as fs } from 'fs';
import logger from '../../utils/logger.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { RateManager } from '../../utils/rate-tracker.js';
import { getBeijingDateString } from '../../utils/common.js';

// 配置文件路径
const KEYS_STORE_FILE = path.join(process.cwd(), 'configs', 'api-potluck-keys.json');

const KEY_PREFIX = 'maki_';

const DEFAULT_CONFIG = {
    persistInterval: 5000,
    defaultDailyLimit: 500
};

let configGetter = null;

/**
 * 设置配置获取器
 */
export function setConfigGetter(getter) {
    configGetter = getter;
}

/**
 * 获取当前配置
 */
function getConfig() {
    if (configGetter) {
        return configGetter();
    }
    return DEFAULT_CONFIG;
}

/**
 * 获取今日日期字符串
 */
function getTodayDateString() {
    return getBeijingDateString();
}

// 插件状态
let keyStore = null;
let isDirty = false;
let isWriting = false;
let persistTimer = null;
let currentPersistInterval = DEFAULT_CONFIG.persistInterval;

const rateManager = new RateManager(60);

function createUsageBucket() {
    return {
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        cachedTokens: 0,
        maxQps: 0,
        maxRpm: 0,
        maxTps: 0
    };
}

function toNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
}

function normalizeUsageBucket(bucket) {
    if (typeof bucket === 'number') {
        return {
            ...createUsageBucket(),
            requestCount: bucket
        };
    }

    return {
        ...createUsageBucket(),
        ...(bucket || {}),
        requestCount: toNumber(bucket?.requestCount),
        promptTokens: toNumber(bucket?.promptTokens),
        completionTokens: toNumber(bucket?.completionTokens),
        totalTokens: toNumber(bucket?.totalTokens),
        cachedTokens: toNumber(bucket?.cachedTokens),
        maxQps: toNumber(bucket?.maxQps),
        maxRpm: toNumber(bucket?.maxRpm),
        maxTps: toNumber(bucket?.maxTps)
    };
}

function normalizeUsageMap(map = {}) {
    const normalized = {};
    for (const [name, usage] of Object.entries(map || {})) {
        normalized[name] = normalizeUsageBucket(usage);
    }
    return normalized;
}

function normalizeUsageHistoryDay(day = {}) {
    return {
        summary: normalizeUsageBucket(day.summary || {
            requestCount: day.requestCount
        }),
        providers: normalizeUsageMap(day.providers),
        models: normalizeUsageMap(day.models)
    };
}

function normalizeKeyData(keyData = {}) {
    const normalized = {
        ...keyData,
        todayUsage: toNumber(keyData.todayUsage),
        totalUsage: toNumber(keyData.totalUsage),
        todayPromptTokens: toNumber(keyData.todayPromptTokens),
        todayCompletionTokens: toNumber(keyData.todayCompletionTokens),
        todayTotalTokens: toNumber(keyData.todayTotalTokens),
        todayCachedTokens: toNumber(keyData.todayCachedTokens),
        totalPromptTokens: toNumber(keyData.totalPromptTokens),
        totalCompletionTokens: toNumber(keyData.totalCompletionTokens),
        totalTokens: toNumber(keyData.totalTokens),
        totalCachedTokens: toNumber(keyData.totalCachedTokens),
        usageHistory: {}
    };

    for (const [date, day] of Object.entries(keyData.usageHistory || {})) {
        normalized.usageHistory[date] = normalizeUsageHistoryDay(day);
    }

    return normalized;
}

function normalizeStore(store = {}) {
    const normalized = { keys: {} };
    for (const [keyId, keyData] of Object.entries(store.keys || {})) {
        normalized.keys[keyId] = normalizeKeyData(keyData);
    }
    return normalized;
}

function addUsage(target, usage = {}) {
    // 默认请求数为 1，确保总量与明细一致
    const rCount = usage.requestCount !== undefined ? toNumber(usage.requestCount) : 1;
    target.requestCount += rCount;
    target.promptTokens += toNumber(usage.promptTokens);
    target.completionTokens += toNumber(usage.completionTokens);
    target.totalTokens += toNumber(usage.totalTokens);
    target.cachedTokens += toNumber(usage.cachedTokens);
    
    // 聚合峰值：使用累加还是最大值取决于上下文。
    // 在汇总多个 Key 的历史数据时，累加可能更能代表系统总峰值（假设可能同时发生）
    // 但更准确的是记录全局 RateTracker 的峰值。
    // 这里简单处理：如果 usage 中有峰值，则取最大值或累加。
    // 鉴于这是日历展示，我们取最大值以展示该日达到的最高单项或汇总峰值。
    target.maxQps = Math.max(target.maxQps || 0, toNumber(usage.maxQps));
    target.maxRpm = Math.max(target.maxRpm || 0, toNumber(usage.maxRpm));
    target.maxTps = Math.max(target.maxTps || 0, toNumber(usage.maxTps));
}

function resetUsageBucketTokens(bucket) {
    if (!bucket || typeof bucket !== 'object') return;
    bucket.promptTokens = 0;
    bucket.completionTokens = 0;
    bucket.totalTokens = 0;
    bucket.cachedTokens = 0;
    bucket.maxQps = 0;
    bucket.maxRpm = 0;
    bucket.maxTps = 0;
}

function resetUsageHistoryTokens(usageHistory) {
    if (!usageHistory || typeof usageHistory !== 'object') return;

    for (const day of Object.values(usageHistory)) {
        if (!day || typeof day !== 'object') continue;
        resetUsageBucketTokens(day.summary);

        for (const usage of Object.values(day.providers || {})) {
            resetUsageBucketTokens(usage);
        }

        for (const usage of Object.values(day.models || {})) {
            resetUsageBucketTokens(usage);
        }
    }
}

/**
 * 初始化：从文件加载数据到内存
 */
function ensureLoaded() {
    if (keyStore !== null) return;
    try {
        if (existsSync(KEYS_STORE_FILE)) {
            const content = readFileSync(KEYS_STORE_FILE, 'utf8');
            keyStore = normalizeStore(JSON.parse(content));
        } else {
            keyStore = { keys: {} };
            syncWriteToFile();
        }
    } catch (error) {
        logger.error('[API Potluck] Failed to load key store:', error.message);
        keyStore = { keys: {} };
    }
    
    // 获取配置的持久化间隔
    const config = getConfig();
    currentPersistInterval = config.persistInterval || DEFAULT_CONFIG.persistInterval;
    
    // 启动定期持久化
    if (!persistTimer) {
        persistTimer = setInterval(persistIfDirty, currentPersistInterval);
        // 进程退出时保存
        process.on('beforeExit', () => persistIfDirty());
        process.on('SIGINT', () => { persistIfDirty(); process.exit(0); });
        process.on('SIGTERM', () => { persistIfDirty(); process.exit(0); });
    }
}

/**
 * 同步写入文件（仅初始化时使用）
 */
function syncWriteToFile() {
    try {
        const dir = path.dirname(KEYS_STORE_FILE);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        writeFileSync(KEYS_STORE_FILE, JSON.stringify(keyStore, null, 2), 'utf8');
    } catch (error) {
        logger.error('[API Potluck] Sync write failed:', error.message);
    }
}

/**
 * 异步持久化（带写锁）
 */
async function persistIfDirty() {
    if (!isDirty || isWriting || keyStore === null) return;
    isWriting = true;
    try {
        const dir = path.dirname(KEYS_STORE_FILE);
        if (!existsSync(dir)) {
            await fs.mkdir(dir, { recursive: true });
        }
        // 写入临时文件再重命名，防止写入中断导致文件损坏
        const tempFile = KEYS_STORE_FILE + '.tmp';
        await fs.writeFile(tempFile, JSON.stringify(keyStore, null, 2), 'utf8');
        await fs.rename(tempFile, KEYS_STORE_FILE);
        isDirty = false;
    } catch (error) {
        logger.error('[API Potluck] Persist failed:', error.message);
    } finally {
        isWriting = false;
    }
}

/**
 * 标记数据已修改
 */
function markDirty() {
    isDirty = true;
}

/**
 * 生成随机 API Key（确保不重复）
 */
function generateApiKey() {
    ensureLoaded();
    let apiKey;
    let attempts = 0;
    const maxAttempts = 10;
    
    do {
        apiKey = `${KEY_PREFIX}${crypto.randomBytes(16).toString('hex')}`;
        attempts++;
        if (attempts >= maxAttempts) {
            throw new Error('Failed to generate unique API key after multiple attempts');
        }
    } while (keyStore.keys[apiKey]);
    
    return apiKey;
}

/**
 * 检查并重置过期的每日计数
 */
function checkAndResetDailyCount(keyData) {
    const today = getTodayDateString();
    if (keyData.lastResetDate !== today) {
        keyData.todayUsage = 0;
        keyData.todayPromptTokens = 0;
        keyData.todayCompletionTokens = 0;
        keyData.todayTotalTokens = 0;
        keyData.todayCachedTokens = 0;
        keyData.lastResetDate = today;
    }
    return keyData;
}

/**
 * 创建新的 API Key
 * @param {string} name - Key 名称
 * @param {number} [dailyLimit] - 每日限额，不传则使用配置的默认值
 */
export async function createKey(name = '', dailyLimit = null) {
    ensureLoaded();
    const config = getConfig();
    const actualDailyLimit = dailyLimit ?? config.defaultDailyLimit ?? DEFAULT_CONFIG.defaultDailyLimit;
    
    const apiKey = generateApiKey();
    const now = new Date().toISOString();
    const today = getTodayDateString();

    const keyData = {
        id: apiKey,
        name: name || `Key-${Object.keys(keyStore.keys).length + 1}`,
        createdAt: now,
        dailyLimit: actualDailyLimit,
        todayUsage: 0,
        totalUsage: 0,
        todayPromptTokens: 0,
        todayCompletionTokens: 0,
        todayTotalTokens: 0,
        todayCachedTokens: 0,
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        totalCachedTokens: 0,
        lastResetDate: today,
        lastUsedAt: null,
        enabled: true,
        usageHistory: {}
    };

    keyStore.keys[apiKey] = keyData;
    markDirty();

    await persistIfDirty(); // 创建操作立即持久化

    logger.info(`[API Potluck] Created key: ${apiKey.substring(0, 12)}...`);
    return keyData;
}

/**
 * 获取所有 Key 列表
 */
export async function listKeys() {
    ensureLoaded();
    const keys = [];
    for (const [keyId, keyData] of Object.entries(keyStore.keys)) {
        const updated = checkAndResetDailyCount({ ...keyData });
        const rates = rateManager.getStats(`key:${keyId}`);
        keys.push({
            ...updated,
            qps: rates.qps,
            tps: rates.tps,
            rpm: rates.rpm,
            maxQps: Math.max(updated.maxQps || 0, rates.maxQps),
            maxTps: Math.max(updated.maxTps || 0, rates.maxTps),
            maxRpm: Math.max(updated.maxRpm || 0, rates.maxRpm),
            maskedKey: `${keyId.substring(0, 12)}...${keyId.substring(keyId.length - 4)}`
        });
    }
    return keys;
}

/**
 * 获取单个 Key 详情
 */
export async function getKey(keyId) {
    ensureLoaded();
    const keyData = keyStore.keys[keyId];
    if (!keyData) return null;
    const updated = checkAndResetDailyCount({ ...keyData });
    const rates = rateManager.getStats(`key:${keyId}`);
    return {
        ...updated,
        qps: rates.qps,
        tps: rates.tps,
        rpm: rates.rpm,
        maxQps: Math.max(updated.maxQps || 0, rates.maxQps),
        maxTps: Math.max(updated.maxTps || 0, rates.maxTps),
        maxRpm: Math.max(updated.maxRpm || 0, rates.maxRpm)
    };
}

/**
 * 删除 Key
 */
export async function deleteKey(keyId) {
    ensureLoaded();
    if (!keyStore.keys[keyId]) return false;
    delete keyStore.keys[keyId];
    
    // 清理速率追踪器，防止内存泄漏
    rateManager.remove(`key:${keyId}`);

    markDirty();
    await persistIfDirty(); // 删除操作立即持久化
    logger.info(`[API Potluck] Deleted key: ${keyId.substring(0, 12)}...`);
    return true;
}

/**
 * 更新 Key 的每日限额
 */
export async function updateKeyLimit(keyId, newLimit) {
    ensureLoaded();
    if (!keyStore.keys[keyId]) return null;
    keyStore.keys[keyId].dailyLimit = newLimit;
    markDirty();
    return keyStore.keys[keyId];
}

/**
 * 重置 Key 的当天调用次数
 */
export async function resetKeyUsage(keyId) {
    ensureLoaded();
    if (!keyStore.keys[keyId]) return null;
    keyStore.keys[keyId].todayUsage = 0;
    keyStore.keys[keyId].todayPromptTokens = 0;
    keyStore.keys[keyId].todayCompletionTokens = 0;
    keyStore.keys[keyId].todayTotalTokens = 0;
    keyStore.keys[keyId].todayCachedTokens = 0;
    keyStore.keys[keyId].lastResetDate = getTodayDateString();
    if (!keyStore.keys[keyId].usageHistory) keyStore.keys[keyId].usageHistory = {};
    keyStore.keys[keyId].usageHistory[getTodayDateString()] = normalizeUsageHistoryDay();
    markDirty();
    return keyStore.keys[keyId];
}

/**
 * 重置单个 Key 的 Token 统计（保留调用次数）
 */
export async function resetKeyTokenStats(keyId) {
    ensureLoaded();
    const keyData = keyStore.keys[keyId];
    if (!keyData) return null;

    keyData.todayPromptTokens = 0;
    keyData.todayCompletionTokens = 0;
    keyData.todayTotalTokens = 0;
    keyData.todayCachedTokens = 0;
    keyData.totalPromptTokens = 0;
    keyData.totalCompletionTokens = 0;
    keyData.totalTokens = 0;
    keyData.totalCachedTokens = 0;
    resetUsageHistoryTokens(keyData.usageHistory);

    // 重置该 Key 的速率追踪器
    rateManager.remove(`key:${keyId}`);

    markDirty();
    await persistIfDirty();
    logger.info(`[API Potluck] Reset token stats for key: ${keyId.substring(0, 12)}...`);
    return keyData;
}

/**
 * 重置所有 Key 的 Token 统计（保留调用次数）
 */
export async function resetAllTokenStats() {
    ensureLoaded();
    let updated = 0;

    for (const keyData of Object.values(keyStore.keys)) {
        keyData.todayPromptTokens = 0;
        keyData.todayCompletionTokens = 0;
        keyData.todayTotalTokens = 0;
        keyData.todayCachedTokens = 0;
        keyData.totalPromptTokens = 0;
        keyData.totalCompletionTokens = 0;
        keyData.totalTokens = 0;
        keyData.totalCachedTokens = 0;
        resetUsageHistoryTokens(keyData.usageHistory);
        updated++;
    }

    // 重置所有 Key 的速率追踪器
    rateManager.clear();

    if (updated > 0) {

        markDirty();
        await persistIfDirty();
    }

    logger.info(`[API Potluck] Reset token stats for all keys: ${updated}`);
    return { total: Object.keys(keyStore.keys).length, updated };
}

/**
 * 切换 Key 的启用/禁用状态
 */
export async function toggleKey(keyId) {
    ensureLoaded();
    if (!keyStore.keys[keyId]) return null;
    keyStore.keys[keyId].enabled = !keyStore.keys[keyId].enabled;
    markDirty();
    return keyStore.keys[keyId];
}

/**
 * 更新 Key 名称
 */
export async function updateKeyName(keyId, newName) {
    ensureLoaded();
    if (!keyStore.keys[keyId]) return null;
    keyStore.keys[keyId].name = newName;
    markDirty();
    return keyStore.keys[keyId];
}

// 用于防止同一请求重复统计速率，改用 Map 以支持批量清理
const recordedRequests = new Map();
let lastCleanupTime = Date.now();

/**
 * 清理过期的请求记录
 */
function cleanupRecordedRequests() {
    const now = Date.now();
    if (now - lastCleanupTime < 60000) return; // 每分钟清理一次
    
    const cutoff = now - 60000; // 清理 1 分钟前的记录
    for (const [id, timestamp] of recordedRequests.entries()) {
        if (timestamp < cutoff) recordedRequests.delete(id);
    }
    lastCleanupTime = now;
}

/**
 * 增加 API Key 的使用量
 * @param {string} apiKey - API Key ID
 * @param {string} pName - 提供商名称
 * @param {string} mName - 模型名称
 * @param {Object} usage - 用量数据
 * @param {string} [requestId] - 请求 ID，用于防止重复统计速率
 */
export async function incrementUsage(apiKey, pName = 'unknown', mName = 'unknown', usage = {}, requestId = null) {
    ensureLoaded();
    const keyData = keyStore.keys[apiKey];
    if (!keyData) return;

    // 防止同一请求重复统计速率
    let shouldRecordRate = true;
    if (requestId) {
        cleanupRecordedRequests();
        if (recordedRequests.has(requestId)) {
            shouldRecordRate = false;
        } else {
            recordedRequests.set(requestId, Date.now());
        }
    }

    // 记录速率统计
    if (shouldRecordRate) {
        rateManager.record(`key:${apiKey}`, usage.totalTokens);
    }

    const rates = rateManager.getGlobalStats();
    const updatePeaks = (target) => {
        target.maxQps = Math.max(target.maxQps || 0, rates.qps);
        target.maxRpm = Math.max(target.maxRpm || 0, rates.rpm);
        target.maxTps = Math.max(target.maxTps || 0, rates.tps);
    };

    // 更新每日和历史统计
    const today = getTodayDateString();
    if (!keyData.usageHistory) keyData.usageHistory = {};
    if (!keyData.usageHistory[today]) {
        keyData.usageHistory[today] = normalizeUsageHistoryDay();
    }
    
    const dayHistory = keyData.usageHistory[today];
    addUsage(dayHistory.summary, usage);
    updatePeaks(dayHistory.summary);
    
    if (!dayHistory.providers[pName]) dayHistory.providers[pName] = createUsageBucket();
    addUsage(dayHistory.providers[pName], usage);
    updatePeaks(dayHistory.providers[pName]);
    
    if (!dayHistory.models[mName]) dayHistory.models[mName] = createUsageBucket();
    addUsage(dayHistory.models[mName], usage);
    updatePeaks(dayHistory.models[mName]);

    // 更新今日和累计总量 (统一处理默认调用次数)
    const rCount = usage.requestCount !== undefined ? toNumber(usage.requestCount) : 1;
    keyData.todayUsage += rCount;
    keyData.totalUsage += rCount;
    keyData.todayPromptTokens += toNumber(usage.promptTokens);
    keyData.todayCompletionTokens += toNumber(usage.completionTokens);
    keyData.todayTotalTokens += toNumber(usage.totalTokens);
    keyData.todayCachedTokens += toNumber(usage.cachedTokens);
    keyData.totalPromptTokens += toNumber(usage.promptTokens);
    keyData.totalCompletionTokens += toNumber(usage.completionTokens);
    keyData.totalTokens += toNumber(usage.totalTokens);
    keyData.totalCachedTokens += toNumber(usage.cachedTokens);
    keyData.lastUsedAt = new Date().toISOString();

    // 同时也给 keyData 注入实时峰值（如果需要持久化）
    if (!keyData.maxQps) keyData.maxQps = 0;
    if (!keyData.maxRpm) keyData.maxRpm = 0;
    if (!keyData.maxTps) keyData.maxTps = 0;
    updatePeaks(keyData);

    // 清理该 Key 的过期历史 (保留 100 天以支持 3 个月日历)
    const userDates = Object.keys(keyData.usageHistory).sort();
    if (userDates.length > 100) {
        const dropDates = userDates.slice(0, userDates.length - 100);
        dropDates.forEach(d => delete keyData.usageHistory[d]);
    }

    markDirty();
    
    return {
        ...keyData,
        usedBonus: false
    };
}

/**
 * 获取统计信息
 */
export async function getStats() {
    ensureLoaded();
    const keys = Object.values(keyStore.keys);
    let enabledKeys = 0, todayTotalUsage = 0, totalUsage = 0;
    let todayPromptTokens = 0, todayCompletionTokens = 0, todayTotalTokens = 0, todayCachedTokens = 0;
    let totalPromptTokens = 0, totalCompletionTokens = 0, totalTokens = 0, totalCachedTokens = 0;
    const aggregatedHistory = {};

    for (const key of keys) {
        checkAndResetDailyCount(key);
        if (key.enabled) enabledKeys++;
        todayTotalUsage += key.todayUsage;
        totalUsage += key.totalUsage;
        todayPromptTokens += key.todayPromptTokens || 0;
        todayCompletionTokens += key.todayCompletionTokens || 0;
        todayTotalTokens += key.todayTotalTokens || 0;
        todayCachedTokens += key.todayCachedTokens || 0;
        totalPromptTokens += key.totalPromptTokens || 0;
        totalCompletionTokens += key.totalCompletionTokens || 0;
        totalTokens += key.totalTokens || 0;
        totalCachedTokens += key.totalCachedTokens || 0;

        // 汇总每个 Key 的历史数据
        if (key.usageHistory) {
            Object.entries(key.usageHistory).forEach(([date, history]) => {
                if (!aggregatedHistory[date]) {
                    aggregatedHistory[date] = normalizeUsageHistoryDay();
                }
                addUsage(aggregatedHistory[date].summary, history.summary);
                
                // 汇总提供商
                if (history.providers) {
                    Object.entries(history.providers).forEach(([p, usage]) => {
                        aggregatedHistory[date].providers[p] = normalizeUsageBucket(aggregatedHistory[date].providers[p]);
                        addUsage(aggregatedHistory[date].providers[p], usage);
                    });
                }
                
                // 汇总模型
                if (history.models) {
                    Object.entries(history.models).forEach(([m, usage]) => {
                        aggregatedHistory[date].models[m] = normalizeUsageBucket(aggregatedHistory[date].models[m]);
                        addUsage(aggregatedHistory[date].models[m], usage);
                    });
                }
            });
        }
    }

    const globalRates = rateManager.getGlobalStats();
    return {
        totalKeys: keys.length,
        enabledKeys,
        disabledKeys: keys.length - enabledKeys,
        todayTotalUsage,
        totalUsage,
        todayPromptTokens,
        todayCompletionTokens,
        todayTotalTokens,
        todayCachedTokens,
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens,
        totalCachedTokens,
        qps: globalRates.qps,
        tps: globalRates.tps,
        rpm: globalRates.rpm,
        maxQps: globalRates.maxQps,
        maxTps: globalRates.maxTps,
        maxRpm: globalRates.maxRpm,
        usageHistory: aggregatedHistory
    };
}


/**
 * 批量更新所有 Key 的每日限额
 * @param {number} newLimit - 新s的每日限额
 * @returns {Promise<{total: number, updated: number}>}
 */
export async function applyDailyLimitToAllKeys(newLimit) {
    ensureLoaded();
    const keys = Object.values(keyStore.keys);
    let updated = 0;
    
    for (const keyData of keys) {
        if (keyData.dailyLimit !== newLimit) {
            keyData.dailyLimit = newLimit;
            updated++;
        }
    }
    
    if (updated > 0) {
        markDirty();
        await persistIfDirty();
    }
    
    logger.info(`[API Potluck] Applied daily limit ${newLimit} to ${updated}/${keys.length} keys`);
    return { total: keys.length, updated };
}

/**
 * 获取所有 Key ID 列表
 * @returns {string[]}
 */
export function getAllKeyIds() {
    ensureLoaded();
    return Object.keys(keyStore.keys);
}

/**
 * 验证 API Key 是否有效
 * @param {string} apiKey - 待验证的 Key
 * @returns {Promise<{valid: boolean, reason?: string, keyData?: Object}>}
 */
export async function validateKey(apiKey) {
    ensureLoaded();
    if (!apiKey || !apiKey.startsWith(KEY_PREFIX)) {
        return { valid: false, reason: 'invalid_format' };
    }
    const keyData = keyStore.keys[apiKey];
    if (!keyData) {
        return { valid: false, reason: 'not_found' };
    }
    if (!keyData.enabled) {
        return { valid: false, reason: 'disabled' };
    }
    const updated = checkAndResetDailyCount(keyData);
    if (updated.dailyLimit > 0 && updated.todayUsage >= updated.dailyLimit) {
        return { valid: false, reason: 'quota_exceeded', keyData: updated };
    }
    return { valid: true, keyData: updated };
}

/**
 * 重新生成 API Key（保留原有数据，更换 Key ID）
 * @param {string} oldKeyId - 原 Key ID
 * @returns {Promise<{oldKey: string, newKey: string, keyData: Object}|null>}
 */
export async function regenerateKey(oldKeyId) {
    ensureLoaded();
    const oldKeyData = keyStore.keys[oldKeyId];
    if (!oldKeyData) return null;
    
    // 生成新的唯一 Key
    const newKeyId = generateApiKey();
    
    // 复制数据到新 Key
    const newKeyData = {
        ...oldKeyData,
        id: newKeyId,
        regeneratedAt: new Date().toISOString(),
        regeneratedFrom: oldKeyId.substring(0, 12) + '...'
    };
    
    // 删除旧 Key，添加新 Key
    delete keyStore.keys[oldKeyId];
    keyStore.keys[newKeyId] = newKeyData;
    
    // 清理旧 Key 的速率追踪器
    rateManager.remove(`key:${oldKeyId}`);

    markDirty();
    await persistIfDirty();
    
    return {
        oldKey: oldKeyId,
        newKey: newKeyId,
        keyData: newKeyData
    };
}

// 导出常量
export { KEY_PREFIX };

/**
 * 速率追踪器 - 用于统计 QPS 和 TPS
 * 使用滑动窗口（桶）实现，性能较好
 */
export class RateTracker {
    /**
     * @param {number} windowSeconds - 窗口大小（秒），默认 10 秒
     */
    constructor(windowSeconds = 10) {
        this.windowSeconds = windowSeconds;
        // 桶数组，每个桶代表 1 秒
        this.buckets = Array.from({ length: windowSeconds }, () => ({ count: 0, total: 0 }));
        this.lastUpdateTime = Math.floor(Date.now() / 1000);
        this.firstRecordTime = 0; // 记录第一次收到记录的时间，用于计算初期的准确速率
        this.maxQps = 0; // 峰值 QPS
        this.maxTps = 0; // 峰值 TPS
        this.maxRpm = 0; // 峰值 RPM
    }

    /**
     * 重置峰值
     */
    resetPeaks() {
        this.maxQps = 0;
        this.maxTps = 0;
        this.maxRpm = 0;
    }

    /**
     * 向前推进时间，清理过期的桶
     * @private
     */
    _advance(nowSeconds) {
        const diff = nowSeconds - this.lastUpdateTime;
        if (diff <= 0) return;

        // 如果时间差超过窗口大小，清理所有桶
        const skip = Math.min(diff, this.windowSeconds);
        for (let i = 0; i < skip; i++) {
            const index = (this.lastUpdateTime + i + 1) % this.windowSeconds;
            this.buckets[index] = { count: 0, total: 0 };
        }
        this.lastUpdateTime = nowSeconds;
    }

    /**
     * 记录一次请求和对应的 Token 数量
     * @param {number} tokens - 本次请求产生的 Token 数量
     */
    record(tokens = 0) {
        const nowSeconds = Math.floor(Date.now() / 1000);
        if (this.firstRecordTime === 0) {
            this.firstRecordTime = nowSeconds;
        }

        this._advance(nowSeconds);
        const index = nowSeconds % this.windowSeconds;
        this.buckets[index].count += 1;
        this.buckets[index].total += (Number(tokens) || 0);
    }

    /**
     * 获取当前的速率统计
     * @returns {{qps: number, tps: number}}
     */
    getStats() {
        const nowSeconds = Math.floor(Date.now() / 1000);
        
        // 如果从未有记录，直接返回 0
        if (this.firstRecordTime === 0) {
            return { qps: 0, tps: 0, rpm: 0, maxQps: 0, maxTps: 0, maxRpm: 0 };
        }

        this._advance(nowSeconds);
        
        let totalCount = 0;
        let totalTokens = 0;
        for (const bucket of this.buckets) {
            totalCount += bucket.count;
            totalTokens += bucket.total;
        }

        // 计算有效的分母：取 (当前时间 - 开始时间 + 1) 和 窗口大小 的较小值，最小为 1
        const elapsed = Math.max(1, nowSeconds - this.firstRecordTime + 1);
        const divisor = Math.min(elapsed, this.windowSeconds);

        const qps = Number((totalCount / divisor).toFixed(2));
        const tps = Number((totalTokens / divisor).toFixed(2));
        const rpm = Number((totalCount * (60 / divisor)).toFixed(2));

        // 更新峰值
        if (qps > this.maxQps) this.maxQps = qps;
        if (tps > this.maxTps) this.maxTps = tps;
        if (rpm > this.maxRpm) this.maxRpm = rpm;

        return {
            qps,
            tps,
            rpm,
            maxQps: this.maxQps,
            maxTps: this.maxTps,
            maxRpm: this.maxRpm
        };
    }
}

/**
 * 速率管理类 - 用于管理多个追踪器
 */
export class RateManager {
    constructor(windowSeconds = 10, maxTrackers = 5000) {
        this.windowSeconds = windowSeconds;
        this.maxTrackers = maxTrackers; // 防止内存泄露，限制追踪器数量
        this.trackers = new Map();
        this.globalTracker = new RateTracker(windowSeconds);
    }

    /**
     * 记录用量
     * @param {string} key - 标识符（如 provider 或 model）
     * @param {number} tokens - Token 数量
     */
    record(key, tokens = 0) {
        this.globalTracker.record(tokens);
        if (key) {
            if (!this.trackers.has(key)) {
                // 容量控制
                if (this.trackers.size >= this.maxTrackers) {
                    return;
                }
                this.trackers.set(key, new RateTracker(this.windowSeconds));
            }
            this.trackers.get(key).record(tokens);
        }
    }

    /**
     * 删除指定的追踪器
     * @param {string} key 
     */
    remove(key) {
        if (key) {
            this.trackers.delete(key);
        }
    }

    /**
     * 清理所有追踪器
     */
    clear() {
        this.trackers.clear();
        this.globalTracker = new RateTracker(this.windowSeconds);
    }

    /**
     * 重置所有追踪器的峰值
     */
    resetPeaks() {
        this.globalTracker.resetPeaks();
        for (const tracker of this.trackers.values()) {
            tracker.resetPeaks();
        }
    }

    /**
     * 获取全局统计
     */
    getGlobalStats() {
        return this.globalTracker.getStats();
    }

    /**
     * 获取指定标识符的统计
     */
    getStats(key) {
        if (!key || !this.trackers.has(key)) {
            return { qps: 0, tps: 0, rpm: 0, maxQps: 0, maxTps: 0, maxRpm: 0 };
        }
        return this.trackers.get(key).getStats();
    }

    /**
     * 获取所有统计
     */
    getAllStats() {
        const result = {
            global: this.globalTracker.getStats(),
            items: {}
        };
        for (const [key, tracker] of this.trackers.entries()) {
            result.items[key] = tracker.getStats();
        }
        return result;
    }
}

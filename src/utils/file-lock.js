import logger from './logger.js';
import { writeFileSync, renameSync, unlinkSync, promises as pfs } from 'fs';

/**
 * 文件锁管理器：支持按文件路径隔离的异步锁
 */
class FileLockManager {
    constructor() {
        this.locks = new Map();
        this.currentHolders = new Map(); // 记录每个路径当前的持有者 ID
    }

    /**
     * 获取指定路径的锁链
     */
    getLock(filePath) {
        if (!this.locks.has(filePath)) {
            this.locks.set(filePath, Promise.resolve());
        }
        return this.locks.get(filePath);
    }

    /**
     * 更新指定路径的锁链
     */
    updateLock(filePath, promise) {
        this.locks.set(filePath, promise.then(() => {}).catch(() => {}));
    }

    /**
     * 分配一个新的持有者 ID
     */
    assignHolder(filePath) {
        const id = Math.random().toString(36).substring(2, 11);
        this.currentHolders.set(filePath, id);
        return id;
    }

    /**
     * 校验持有者 ID 是否仍然有效
     */
    isHolderValid(filePath, id) {
        return this.currentHolders.get(filePath) === id;
    }
}

const lockManager = new FileLockManager();

/**
 * 超时包装函数
 */
function withTimeout(promise, ms = 30000) {
    return Promise.race([
        promise,
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Operation timeout after ${ms}ms`)), ms)
        )
    ]);
}

/**
 * 带有重试机制的重命名操作
 */
async function retryRename(src, dest, retries = 5, delay = 100) {
    for (let i = 0; i < retries; i++) {
        try {
            await pfs.rename(src, dest);
            return;
        } catch (err) {
            const isLocked = err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'EBUSY';
            if (isLocked && i < retries - 1) {
                await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
                continue;
            }
            throw err;
        }
    }
}

/**
 * 获取文件锁并执行回调函数
 * @param {string} filePath - 锁的标识（文件路径）
 * @param {Function} fn - 回调函数，接收一个 isLocked 有效性检查函数
 */
export function withFileLock(filePath, fn) {
    const lockKey = typeof filePath === 'string' ? filePath : 'global_lock';
    const callback = typeof filePath === 'function' ? filePath : fn;

    const currentLock = lockManager.getLock(lockKey);
    const next = currentLock
        .then(async () => {
            const holderId = lockManager.assignHolder(lockKey);
            // 传递一个检查函数，让回调内部可以判断自己是否因超时而失去了锁
            const checkValidity = () => {
                if (!lockManager.isHolderValid(lockKey, holderId)) {
                    throw new Error(`Lock on ${lockKey} has been revoked due to timeout or preemption.`);
                }
            };
            return await withTimeout(callback(checkValidity), 30000);
        })
        .catch(err => {
            logger.error(`[FileLock][${lockKey}] Operation failed:`, err?.message || err);
            throw err;
        });

    lockManager.updateLock(lockKey, next);
    return next;
}

/**
 * 原子化写入文件：先写临时文件，成功后再 rename
 */
export function atomicWriteFileSync(filePath, data, encoding = 'utf-8') {
    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
    try {
        writeFileSync(tempPath, data, encoding);
        renameSync(tempPath, filePath);
    } catch (error) {
        logger.error(`[FileLock] Atomic write failed for ${filePath}:`, error.message);
        try { unlinkSync(tempPath); } catch (e) {}
        throw error;
    }
}

/**
 * 原子化写入文件（异步版，带 Windows 重试支持）
 */
export async function atomicWriteFile(filePath, data, encoding = 'utf-8') {
    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 7)}.tmp`;
    try {
        await pfs.writeFile(tempPath, data, encoding);
        await retryRename(tempPath, filePath);
    } catch (error) {
        logger.error(`[FileLock] Atomic write (async) failed for ${filePath}:`, error.message);
        try { await pfs.unlink(tempPath); } catch (e) {}
        throw error;
    }
}

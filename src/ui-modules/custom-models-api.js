import { existsSync, readFileSync } from 'fs';
import logger from '../utils/logger.js';
import { getRequestBody } from '../utils/common.js';
import { broadcastEvent } from './event-broadcast.js';
import { CONFIG } from '../core/config-manager.js';
import { withFileLock, atomicWriteFile } from '../utils/file-lock.js';

function syncRuntimeCustomModels(currentConfig, customModels) {
    const normalizedCustomModels = Array.isArray(customModels) ? customModels : [];
    currentConfig.customModels = normalizedCustomModels;
    CONFIG.customModels = normalizedCustomModels;
}

/**
 * 获取自定义模型列表
 */
export async function handleGetCustomModels(req, res, currentConfig) {
    const filePath = currentConfig.CUSTOM_MODELS_FILE_PATH || 'configs/custom_models.json';
    let customModels = [];

    try {
        if (existsSync(filePath)) {
            const data = readFileSync(filePath, 'utf-8');
            customModels = JSON.parse(data);
        } else if (Array.isArray(currentConfig.customModels)) {
            customModels = currentConfig.customModels;
        }
    } catch (error) {
        logger.warn('[UI API] Failed to load custom models:', error.message);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(customModels));
    return true;
}

/**
 * 添加自定义模型
 */
export async function handleAddCustomModel(req, res, currentConfig) {
    try {
        const body = await getRequestBody(req);
        const filePath = CONFIG.CUSTOM_MODELS_FILE_PATH || 'configs/custom_models.json';
        return await withFileLock(filePath, () => _handleAddCustomModel(req, res, currentConfig, body));
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'File operation failed: ' + err.message } }));
        return true;
    }
}
async function _handleAddCustomModel(req, res, currentConfig, body) {
    try {
        const newModel = body;

        if (!newModel.id) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Model ID is required' } }));
            return true;
        }

        const filePath = currentConfig.CUSTOM_MODELS_FILE_PATH || 'configs/custom_models.json';
        let customModels = [];

        if (existsSync(filePath)) {
            try {
                const data = readFileSync(filePath, 'utf-8');
                customModels = JSON.parse(data);
            } catch (e) {
                logger.warn('[UI API] Failed to parse custom models file:', e.message);
            }
        }

        // Check for duplicates
        if (customModels.some(m => m.id === newModel.id)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: `Model ID '${newModel.id}' already exists` } }));
            return true;
        }

        customModels.push(newModel);

        // Save to file
        await atomicWriteFile(filePath, JSON.stringify(customModels, null, 2), 'utf-8');
        syncRuntimeCustomModels(currentConfig, customModels);
        
        logger.info(`[UI API] Added custom model: ${newModel.id}`);

        broadcastEvent('config_update', {
            action: 'add_custom_model',
            filePath,
            model: newModel,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, model: newModel }));
        return true;
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

/**
 * 更新自定义模型
 */
export async function handleUpdateCustomModel(req, res, currentConfig, modelId) {
    try {
        const body = await getRequestBody(req);
        const filePath = CONFIG.CUSTOM_MODELS_FILE_PATH || 'configs/custom_models.json';
        return await withFileLock(filePath, () => _handleUpdateCustomModel(req, res, currentConfig, modelId, body));
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'File operation failed: ' + err.message } }));
        return true;
    }
}
async function _handleUpdateCustomModel(req, res, currentConfig, modelId, body) {
    try {
        const updatedModel = body;

        const filePath = currentConfig.CUSTOM_MODELS_FILE_PATH || 'configs/custom_models.json';
        let customModels = [];

        if (existsSync(filePath)) {
            try {
                const data = readFileSync(filePath, 'utf-8');
                customModels = JSON.parse(data);
            } catch (e) {
                logger.warn('[UI API] Failed to parse custom models file:', e.message);
            }
        }

        const index = customModels.findIndex(m => m.id === modelId);
        if (index === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Model not found' } }));
            return true;
        }

        // Ensure ID stays consistent if not explicitly changing it (or handle ID change)
        if (updatedModel.id && updatedModel.id !== modelId) {
            if (customModels.some(m => m.id === updatedModel.id)) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: { message: `New Model ID '${updatedModel.id}' already exists` } }));
                return true;
            }
        }

        customModels[index] = { ...customModels[index], ...updatedModel };

        // Save to file
        await atomicWriteFile(filePath, JSON.stringify(customModels, null, 2), 'utf-8');
        syncRuntimeCustomModels(currentConfig, customModels);
        
        logger.info(`[UI API] Updated custom model: ${modelId}`);

        broadcastEvent('config_update', {
            action: 'update_custom_model',
            filePath,
            model: customModels[index],
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, model: customModels[index] }));
        return true;
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

/**
 * 删除自定义模型
 */
export async function handleDeleteCustomModel(req, res, currentConfig, modelId) {
    try {
        const filePath = CONFIG.CUSTOM_MODELS_FILE_PATH || 'configs/custom_models.json';
        return await withFileLock(filePath, () => _handleDeleteCustomModel(req, res, currentConfig, modelId));
    } catch (err) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'File operation failed: ' + err.message } }));
        return true;
    }
}
async function _handleDeleteCustomModel(req, res, currentConfig, modelId) {
    try {
        const filePath = currentConfig.CUSTOM_MODELS_FILE_PATH || 'configs/custom_models.json';
        let customModels = [];

        if (existsSync(filePath)) {
            try {
                const data = readFileSync(filePath, 'utf-8');
                customModels = JSON.parse(data);
            } catch (e) {
                logger.warn('[UI API] Failed to parse custom models file:', e.message);
            }
        }

        const index = customModels.findIndex(m => m.id === modelId);
        if (index === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Model not found' } }));
            return true;
        }

        const deletedModel = customModels.splice(index, 1)[0];

        // Save to file
        await atomicWriteFile(filePath, JSON.stringify(customModels, null, 2), 'utf-8');
        syncRuntimeCustomModels(currentConfig, customModels);
        
        logger.info(`[UI API] Deleted custom model: ${modelId}`);

        broadcastEvent('config_update', {
            action: 'delete_custom_model',
            filePath,
            model: deletedModel,
            timestamp: new Date().toISOString()
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, deletedModel }));
        return true;
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: error.message } }));
        return true;
    }
}

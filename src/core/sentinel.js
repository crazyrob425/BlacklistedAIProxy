import logger from '../utils/logger.js';

/**
 * Sentinel Context Manager
 * Handles conversation pruning and summarization to stay within token limits.
 */
export class Sentinel {
    constructor(config) {
        this.config = config;
        this.threshold = config.SENTINEL_THRESHOLD || 0.8;
        this.maxTokens = config.MAX_TOKENS || 8192;
    }

    /**
     * Processes a list of messages and prunes them if they exceed the threshold.
     * @param {Array} messages - List of OpenAI format messages.
     * @returns {Promise<Array>} - Pruned/Summarized messages.
     */
    async process(messages) {
        // Mock token calculation (integration with actual tokenizer needed)
        const estimatedTokens = messages.reduce((acc, msg) => acc + (msg.content?.length || 0) / 4, 0);
        
        if (estimatedTokens > this.maxTokens * this.threshold) {
            logger.info(`[Sentinel] Context limit reached (${Math.round(estimatedTokens)} tokens). Pruning...`);
            
            // Keep system message and most recent messages
            const systemMessage = messages.find(m => m.role === 'system');
            const recentMessages = messages.slice(-5);
            
            const newMessages = systemMessage ? [systemMessage, ...recentMessages] : recentMessages;
            logger.info(`[Sentinel] Pruned conversation to ${newMessages.length} messages.`);
            return newMessages;
        }
        
        return messages;
    }
}

let sentinelInstance = null;
export function getSentinel(config) {
    if (!sentinelInstance && config) {
        sentinelInstance = new Sentinel(config);
    }
    return sentinelInstance;
}

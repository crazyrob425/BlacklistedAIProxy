/**
 * LMArena Provider Strategy
 *
 * Uses the OpenAI protocol strategy since LMArenaBridge exposes a
 * fully OpenAI-compatible /v1/chat/completions endpoint.
 *
 * We re-export OpenAIStrategy so the gateway routing layer knows
 * this provider speaks OpenAI protocol.
 */

export { OpenAIStrategy as LMArenaStrategy } from '../openai/openai-strategy.js';

/**
 * LMArena Provider Strategy
 *
 * LMArenaBridge exposes an OpenAI-compatible /v1/chat/completions
 * endpoint, so it should use the OpenAI strategy via an `openai-*`
 * provider type rather than a dedicated `lmarena` protocol strategy.
 *
 * This module intentionally exports nothing to avoid exposing an
 * unused alias that is not registered in the provider strategy factory.
 */

export {};

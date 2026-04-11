/**
 * Tracing helpers (Epic A – span utilities)
 *
 * Provides consistent LLM semantic-convention attributes (gen_ai.* namespace,
 * aligned with the OTel GenAI SIG proposal) and stable start/end helpers so
 * call-sites stay concise.  All functions are no-ops when OTel is disabled.
 */

import { context, trace, SpanKind, SpanStatusCode } from '@opentelemetry/api';
import { getTracer } from './otel.js';

// ── Semantic-convention attribute keys ────────────────────────────────────────

export const ATTR = {
    GEN_AI_SYSTEM:              'gen_ai.system',
    GEN_AI_REQUEST_MODEL:       'gen_ai.request.model',
    GEN_AI_REQUEST_MAX_TOKENS:  'gen_ai.request.max_tokens',
    GEN_AI_REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
    GEN_AI_REQUEST_STREAM:      'gen_ai.request.streaming',
    GEN_AI_RESPONSE_MODEL:      'gen_ai.response.model',
    GEN_AI_USAGE_INPUT_TOKENS:  'gen_ai.usage.input_tokens',
    GEN_AI_USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
    GEN_AI_FINISH_REASON:       'gen_ai.finish_reason',
    HTTP_METHOD:                'http.method',
    HTTP_TARGET:                'http.target',
    HTTP_STATUS_CODE:           'http.status_code',
    HTTP_CLIENT_IP:             'http.client_ip',
    PROXY_PROVIDER:             'proxy.provider',
    PROXY_REQUEST_ID:           'proxy.request_id',
    PROXY_POOL_UUID:            'proxy.pool_uuid',
    PROXY_CANARY:               'proxy.canary',
};

// ── Root HTTP span (one per inbound request) ─────────────────────────────────

/**
 * Start a root server span for an inbound HTTP request.
 * @returns {{ span: import('@opentelemetry/api').Span, ctx: import('@opentelemetry/api').Context }}
 */
export function startRequestSpan({ method, path, clientIp, requestId }) {
    const span = getTracer().startSpan(`${method} ${path}`, {
        kind: SpanKind.SERVER,
        attributes: {
            [ATTR.HTTP_METHOD]:    method,
            [ATTR.HTTP_TARGET]:    path,
            [ATTR.HTTP_CLIENT_IP]: clientIp,
            [ATTR.PROXY_REQUEST_ID]: requestId,
        },
    });
    const ctx = trace.setSpan(context.active(), span);
    return { span, ctx };
}

/** Finish an HTTP request span. */
export function endRequestSpan(span, statusCode, error) {
    span.setAttribute(ATTR.HTTP_STATUS_CODE, statusCode);
    if (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    } else if (statusCode >= 400) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${statusCode}` });
    } else {
        span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
}

// ── Provider LLM call span ────────────────────────────────────────────────────

/**
 * Start a child span representing a single LLM provider call.
 * @returns {{ span: import('@opentelemetry/api').Span, ctx: import('@opentelemetry/api').Context }}
 */
export function startProviderSpan({ parentCtx, provider, model, streaming = false, poolUuid = null }) {
    const span = getTracer().startSpan(`llm.${provider}`, {
        kind: SpanKind.CLIENT,
        attributes: {
            [ATTR.GEN_AI_SYSTEM]:         provider,
            [ATTR.GEN_AI_REQUEST_MODEL]:  model,
            [ATTR.GEN_AI_REQUEST_STREAM]: streaming,
            [ATTR.PROXY_PROVIDER]:        provider,
            ...(poolUuid ? { [ATTR.PROXY_POOL_UUID]: poolUuid } : {}),
        },
    }, parentCtx ?? context.active());
    const ctx = trace.setSpan(parentCtx ?? context.active(), span);
    return { span, ctx };
}

/**
 * Finish a provider span with optional usage/model/error attributes.
 * @param {import('@opentelemetry/api').Span} span
 * @param {{ usage?: object, finishReason?: string, responseModel?: string, error?: Error }} opts
 */
export function endProviderSpan(span, { usage, finishReason, responseModel, error } = {}) {
    if (usage) {
        span.setAttributes({
            [ATTR.GEN_AI_USAGE_INPUT_TOKENS]:  usage.input_tokens  ?? usage.prompt_tokens     ?? 0,
            [ATTR.GEN_AI_USAGE_OUTPUT_TOKENS]: usage.output_tokens ?? usage.completion_tokens ?? 0,
        });
    }
    if (finishReason)  span.setAttribute(ATTR.GEN_AI_FINISH_REASON,    finishReason);
    if (responseModel) span.setAttribute(ATTR.GEN_AI_RESPONSE_MODEL, responseModel);
    if (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    } else {
        span.setStatus({ code: SpanStatusCode.OK });
    }
    span.end();
}

// ── Gateway routing span ──────────────────────────────────────────────────────

/** Start a span for a hybrid-gateway routing hop. */
export function startGatewaySpan({ parentCtx, targetUrl, canary = false }) {
    const span = getTracer().startSpan('gateway.proxy', {
        kind: SpanKind.CLIENT,
        attributes: {
            [ATTR.HTTP_TARGET]:  targetUrl,
            [ATTR.PROXY_CANARY]: canary,
        },
    }, parentCtx ?? context.active());
    const ctx = trace.setSpan(parentCtx ?? context.active(), span);
    return { span, ctx };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Return the W3C trace-id hex string for the currently active span, or ''.
 * No-op spans have an all-zeros ID which is treated as absent.
 */
export function currentTraceId() {
    const span = trace.getActiveSpan();
    if (!span) return '';
    const { traceId } = span.spanContext();
    return traceId === '00000000000000000000000000000000' ? '' : traceId;
}

/** Run `fn` inside the given OTel context so child spans are properly parented. */
export async function withContext(ctx, fn) {
    return context.with(ctx, fn);
}

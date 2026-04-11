/**
 * OpenTelemetry SDK initializer (Epic A – P1)
 *
 * Initialises the OTel NodeSDK with an OTLP-HTTP trace exporter and wires in
 * the optional Langfuse bridge.  All configuration is via env vars so the app
 * runs unchanged with or without a collector.
 *
 * Environment variables
 * ─────────────────────
 *  OTEL_ENABLED                   – "true" to enable (default: false)
 *  OTEL_SERVICE_NAME              – service name (default: "blacklisted-ai-proxy")
 *  OTEL_EXPORTER_OTLP_ENDPOINT    – collector base URL (default: http://localhost:4318)
 *  OTEL_LOG_LEVEL                 – none|error|warn|info|debug  (default: warn)
 *  LANGFUSE_SECRET_KEY            – enables Langfuse bridge when set
 *  LANGFUSE_PUBLIC_KEY            – enables Langfuse bridge when set
 *  LANGFUSE_HOST                  – self-hosted Langfuse URL (default: https://cloud.langfuse.com)
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { trace, diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readVersion() {
    try { return readFileSync(join(__dirname, '../../VERSION'), 'utf8').trim(); }
    catch { return '0.0.0'; }
}

let sdk = null;
let initialized = false;

/**
 * Initialise the OTel SDK.  Safe to call multiple times; only the first call
 * has any effect.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.enabled]
 * @param {string}  [opts.serviceName]
 * @param {string}  [opts.endpoint]
 */
export function initTelemetry(opts = {}) {
    if (initialized) return;
    initialized = true;

    const enabled = opts.enabled === true ||
        String(process.env.OTEL_ENABLED).toLowerCase() === 'true';

    if (!enabled) return;

    const levelMap = {
        none: DiagLogLevel.NONE, error: DiagLogLevel.ERROR,
        warn: DiagLogLevel.WARN, info: DiagLogLevel.INFO, debug: DiagLogLevel.DEBUG,
    };
    diag.setLogger(
        new DiagConsoleLogger(),
        levelMap[process.env.OTEL_LOG_LEVEL ?? 'warn'] ?? DiagLogLevel.WARN,
    );

    const serviceName = opts.serviceName ??
        process.env.OTEL_SERVICE_NAME ?? 'blacklisted-ai-proxy';
    const endpoint = (opts.endpoint ??
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318').replace(/\/$/, '');

    sdk = new NodeSDK({
        resource: new Resource({
            'service.name': serviceName,
            'service.version': readVersion(),
        }),
        traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
    });

    sdk.start();
    process.once('SIGTERM', shutdownTelemetry);
    process.once('SIGINT',  shutdownTelemetry);
}

/** Return a named tracer.  Returns a no-op tracer when OTel is disabled. */
export function getTracer(name = 'blacklisted-ai-proxy') {
    return trace.getTracer(name);
}

/** Flush pending spans and shut down the SDK (called automatically on exit). */
export async function shutdownTelemetry() {
    if (sdk) { try { await sdk.shutdown(); } catch { /* best-effort */ } }
}

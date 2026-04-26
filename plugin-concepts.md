# BlacklistedAIProxy — Plugin Concepts, Developer Guide & Marketplace Documentation

> **Version:** 1.0.0  
> **Last Updated:** 2026-04-20  
> **Status:** Beta — Plugin System v1  

---

## Table of Contents

1. [Plugin Architecture Overview](#1-plugin-architecture-overview)
2. [Plugin Manifest Reference](#2-plugin-manifest-reference)
3. [Plugin Developer Guide](#3-plugin-developer-guide)
4. [Security Checklist](#4-security-checklist)
5. [Performance Requirements & SLOs](#5-performance-requirements--slos)
6. [Testing Requirements](#6-testing-requirements)
7. [Plugin Information Form (Template)](#7-plugin-information-form-template)
8. [Marketplace Catalog Schema Reference](#8-marketplace-catalog-schema-reference)
9. [Top 5 Recommended Plugin Concepts](#9-top-5-recommended-plugin-concepts)
10. [#1 Recommended Next Plugin: Multi-Model Ensemble Synthesizer](#10-1-recommended-next-plugin-multi-model-ensemble-synthesizer)
11. [Changelog Policy](#11-changelog-policy)

---

## 1. Plugin Architecture Overview

BlacklistedAIProxy's plugin system is a lifecycle-driven, hook-based middleware architecture. Every plugin is a plain JavaScript ES module that exports a default object conforming to the Plugin interface. Plugins are auto-discovered from the `src/plugins/` directory, registered with the `PluginManager`, and given the opportunity to participate in the full request/response lifecycle.

### 1.1 Request Flow (Annotated)

```
HTTP Request
    │
    ▼
┌─────────────────────────────────────────────────────────────────┐
│  Master Router (master.js / common.js)                          │
│                                                                  │
│  ① Auth Plugins     (type: 'auth',   priority: ~9999)          │
│     └─ authenticate() → { handled, authorized, error }         │
│                                                                  │
│  ② Middleware Plugins (type: 'middleware', priority: 50–8000)  │
│     └─ middleware() → { handled: true }  ← SHORT-CIRCUIT       │
│        or { handled: false }             ← CONTINUE            │
│                                                                  │
│  ③ Provider routing (model selection, protocol conversion)     │
│                                                                  │
│  ④ AI Provider Call (HTTP → Gemini / Claude / OpenAI / etc.)  │
│                                                                  │
│  ⑤ Response handling                                           │
│     ├─ Streaming:   onStreamChunk() hook                        │
│     └─ Unary:       onUnaryResponse() hook                      │
│                                                                  │
│  ⑥ Content Generated:  onContentGenerated() hook               │
└─────────────────────────────────────────────────────────────────┘
    │
    ▼
HTTP Response
```

### 1.2 Plugin Priority

Plugins are sorted by `_priority` (ascending — lower number runs first). Recommended ranges:

| Range         | Typical Use Case                         |
|---------------|------------------------------------------|
| 1–49          | Reserved for system internals            |
| 50–99         | Token optimization, caching              |
| 100–499       | Response transformation                  |
| 500–2999      | Analytics, monitoring, logging           |
| 3000–7999     | General middleware                       |
| 8000–8999     | Budget / quota enforcement               |
| 9000–9499     | Security guards (rate-limit, PII)        |
| 9500–9998     | Custom auth middleware                   |
| 9999+         | Core auth (default-auth, reserved)       |

### 1.3 Plugin Discovery

The PluginManager scans `src/plugins/*/index.js` at startup and dynamically imports each plugin. The plugin's `name` field is used as its identifier. Plugins with no `index.js` are silently skipped. A `configs/plugins.json` file persists enabled/disabled state across restarts.

### 1.4 Plugin Types

| Type          | Description                                                     |
|---------------|-----------------------------------------------------------------|
| `_builtin`    | Ships with the project; always registered; managed via config  |
| `auth`        | Participates in the authentication flow via `authenticate()`   |
| `middleware`  | Participates in the middleware chain via `middleware()`        |
| *(default)*   | Hooks-only plugin; no middleware participation                  |

---

## 2. Plugin Manifest Reference

The default export of `index.js` must be an object with the following properties:

### 2.1 Required Fields

```js
export default {
    name:        'my-plugin',     // string — Unique slug. Matches directory name.
    version:     '1.0.0',         // string — SemVer version string.
    description: 'One-line desc', // string — Shown in plugin manager UI.
}
```

### 2.2 Optional Configuration Fields

```js
{
    type:       'middleware',  // string — 'middleware' | 'auth' | '_builtin' | undefined
    _builtin:   false,         // boolean — Mark as built-in (non-removable)
    _priority:  100,           // number  — Execution order (lower = earlier)
}
```

### 2.3 Lifecycle Hooks

```js
{
    /**
     * Called once at server startup when the plugin is enabled.
     * Use for: opening database connections, loading config, starting timers.
     * Throwing from init() will mark the plugin as disabled.
     *
     * @param {Object} config — The full server CONFIG object
     * @returns {Promise<void>}
     */
    async init(config) {},

    /**
     * Called when the plugin is being shut down (server exit or restart).
     * Use for: closing connections, flushing buffers, persisting state.
     *
     * @returns {Promise<void>}
     */
    async destroy() {},
}
```

### 2.4 Request Middleware

```js
{
    /**
     * Runs on EVERY incoming HTTP request, BEFORE the provider call.
     * Return { handled: true } to short-circuit all further processing.
     * Return { handled: false } to continue the chain.
     *
     * NEVER throw from middleware. Catch all exceptions internally.
     *
     * @param {IncomingMessage}  req         — Node.js HTTP request
     * @param {ServerResponse}   res         — Node.js HTTP response
     * @param {URL}              requestUrl  — Parsed request URL
     * @param {Object}           config      — Full server CONFIG (mutable)
     * @returns {Promise<{ handled: boolean }>}
     */
    async middleware(req, res, requestUrl, config) {
        // ...
        return { handled: false };
    },
}
```

### 2.5 Authentication (type: 'auth' only)

```js
{
    /**
     * Called for type='auth' plugins during the authentication phase.
     *
     * @returns {Promise<{
     *   handled:    boolean,         — true if this plugin handled auth
     *   authorized: boolean | null,  — true = pass, false = reject, null = abstain
     *   error?:     Object,          — Error details if authorized=false
     * }>}
     */
    async authenticate(req, res, requestUrl, config) {},
}
```

### 2.6 Hooks Object

```js
{
    hooks: {
        /**
         * Called after a non-streaming (unary) response is received from
         * the AI provider. Use for: response caching, usage accounting.
         *
         * @param {Object} ctx
         * @param {string}  ctx.requestId      — Plugin request ID
         * @param {string}  ctx.model          — Model identifier
         * @param {Object}  ctx.nativeResponse — Raw provider response
         * @param {Object}  ctx.clientResponse — Converted client response
         */
        async onUnaryResponse(ctx) {},

        /**
         * Called for each SSE chunk in a streaming response.
         * Do NOT block this hook — it runs in the critical streaming path.
         */
        async onStreamChunk(ctx) {},

        /**
         * Called once after the full response has been delivered to the client.
         * Use for: analytics, logging, cleanup.
         * Available on ctx: model, originalRequestBody, processedRequestBody,
         *   usage (promptTokens, completionTokens), _pluginRequestId.
         */
        async onContentGenerated(ctx) {},

        /**
         * Called at the start of every request, before any processing.
         * Use for: request logging, rate-limit pre-checks.
         */
        async onBeforeRequest(req, config) {},

        /**
         * Called after the response has been sent to the client.
         */
        async onAfterResponse(req, res, config) {},
    },
}
```

### 2.7 Routes

```js
{
    /**
     * Plugin-owned REST routes. Each route is checked AFTER the main
     * UI management routes, so prefix all paths with /api/<plugin-name>
     * to avoid conflicts.
     *
     * The handler function signature matches handleUIApiRequests:
     *   (method, path, req, res, config) => Promise<boolean>
     */
    routes: [
        {
            method:  'GET',                      // HTTP method or '*' for all
            path:    '/api/my-plugin/stats',     // Exact path OR path prefix
            handler: myHandlerFunction,
        },
    ],
}
```

### 2.8 Static Files

```js
{
    /**
     * Static HTML/CSS/JS files the plugin wants to serve from /static/.
     * These must already exist at static/<filename>.
     * Specified as relative paths from the static/ directory.
     */
    staticPaths: ['my-plugin.html', 'my-plugin.css'],
}
```

---

## 3. Plugin Developer Guide

### 3.1 Project Structure

```
src/plugins/
└── my-plugin/
    ├── index.js          ← Plugin entry point (required)
    ├── api-routes.js     ← REST route handlers
    ├── [module].js       ← One file per logical component
    └── README.md         ← Plugin-specific documentation (optional)

static/
├── my-plugin.html        ← Plugin dashboard page (optional)
└── components/
    └── section-*.html    ← If plugin adds a main section (optional)

configs/
└── my-plugin.json        ← Persisted plugin configuration (auto-created)
```

### 3.2 Minimal Plugin Template

```js
// src/plugins/my-plugin/index.js
import logger from '../../utils/logger.js';

export default {
    name:        'my-plugin',
    version:     '1.0.0',
    description: 'Brief description of what this plugin does.',
    type:        '_builtin',
    _builtin:    true,
    _priority:   500,

    async init(config) {
        logger.info('[My Plugin] Initialized');
    },

    async destroy() {
        logger.info('[My Plugin] Destroyed');
    },

    async middleware(req, res, requestUrl, config) {
        try {
            // Your middleware logic here.
            // Return { handled: true } to stop the chain.
            // Return { handled: false } to continue.
            return { handled: false };
        } catch (err) {
            logger.error('[My Plugin] Middleware error (non-fatal):', err.message);
            return { handled: false };
        }
    },

    hooks: {
        async onContentGenerated(ctx) {
            try {
                // Post-request analytics, logging, etc.
            } catch { /* Always swallow errors in hooks */ }
        },
    },
};
```

### 3.3 Body Access Pattern

The request body is a Node.js readable stream. Two patterns exist:

**Pattern A — Read in middleware (plugin controls the body):**
```js
async middleware(req, res, requestUrl, config) {
    // Read stream and cache in req._rawBody for downstream consumers
    const chunks = [];
    await new Promise((resolve, reject) => {
        req.on('data', c => chunks.push(c));
        req.on('end',  resolve);
        req.on('error', reject);
    });
    req._rawBody = Buffer.concat(chunks);
    const body   = JSON.parse(req._rawBody.toString('utf8'));
    // Modify body, write back:
    req._rawBody = Buffer.from(JSON.stringify(modifiedBody), 'utf8');
    return { handled: false };
}
```

**Pattern B — Use getRequestBody() (downstream, no stream interception):**
```js
// Available in route handlers; automatically picks up req._rawBody if set.
import { getRequestBody } from '../../utils/common.js';
const body = await getRequestBody(req);
```

> **Rule:** If your middleware reads the body stream, you MUST store the bytes in `req._rawBody`. Failing to do so will cause downstream `getRequestBody()` calls to receive an empty body (EOF on already-consumed stream).

### 3.4 Configuration Persistence

```js
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';

const CONFIG_FILE = path.join(process.cwd(), 'configs', 'my-plugin.json');
const DEFAULTS    = { enabled: true, someOption: 'value' };

function loadConfig() {
    try {
        if (existsSync(CONFIG_FILE)) {
            return { ...DEFAULTS, ...JSON.parse(readFileSync(CONFIG_FILE, 'utf8')) };
        }
    } catch { /* use defaults */ }
    return { ...DEFAULTS };
}

function saveConfig(cfg) {
    try {
        const dir = path.dirname(CONFIG_FILE);
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
    } catch { /* silent */ }
}
```

### 3.5 Error Isolation Contract

Every plugin MUST adhere to the following error isolation contract:

1. **Never throw from `middleware()`** — wrap all logic in try/catch.
2. **Never throw from hooks** — swallow all exceptions silently or with a warning log.
3. **Never throw from `init()`** unless you intend to disable the plugin.
4. **Always return from `middleware()`** — returning `undefined` or `null` will break the chain.
5. **Cap memory usage** — use bounded data structures (LRU maps, ring buffers). Unbounded growth causes OOM crashes.
6. **Use non-blocking I/O** — never use synchronous filesystem operations on the hot path.

### 3.6 REST API Best Practices

```js
// Standard JSON response helper
function sendJson(res, status, data) {
    res.writeHead(status, {
        'Content-Type':                'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(data));
}

// Standard success response
sendJson(res, 200, { success: true, data: { ... } });

// Standard error response
sendJson(res, 400, { success: false, error: { message: 'Description', code: 'ERROR_CODE' } });
```

**HTTP status codes to use:**
- `200` — Success
- `400` — Bad request (invalid parameters)
- `401` — Unauthorized (missing or invalid credentials)
- `404` — Route not found (within your plugin's namespace)
- `422` — Validation error (well-formed but semantically invalid)
- `429` — Rate limited or quota exceeded
- `500` — Internal plugin error
- `503` — Plugin not available / not initialized

### 3.7 Authentication in Route Handlers

All plugin routes that expose sensitive data or allow configuration changes MUST validate authentication:

```js
import { checkAuth } from '../../ui-modules/auth.js';
import { isAuthorized } from '../../utils/common.js';

async function isAuthed(req, config) {
    try {
        if (await checkAuth(req)) return true;
        if (config?.REQUIRED_API_KEY) {
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            return isAuthorized(req, url, config.REQUIRED_API_KEY);
        }
        return false;
    } catch { return false; }
}
```

---

## 4. Security Checklist

Every plugin submitted to the marketplace must pass the following checks before being classified as `verified` or `official`. For `community` plugins, this checklist is self-assessed.

### 4.1 Authentication & Authorization
- [ ] All management endpoints check admin authentication via `checkAuth()` or API key validation
- [ ] No endpoints expose secrets, credentials, or internal state without authentication
- [ ] User-controlled input is never used to construct file paths without sanitization
- [ ] No plugin accepts arbitrary JavaScript execution from user input

### 4.2 Input Validation
- [ ] All numeric config inputs are bounded (min/max enforced)
- [ ] String inputs are length-limited
- [ ] JSON body parsing uses try/catch; malformed input returns 400, not 500
- [ ] Regular expressions used for PII/pattern matching are tested for ReDoS (catastrophic backtracking)

### 4.3 Memory Safety
- [ ] All in-memory data structures have a defined maximum size
- [ ] No unbounded Maps, Arrays, or Sets that grow with request traffic
- [ ] Timer intervals are `unref()`-ed where appropriate to not prevent process exit
- [ ] Pending/in-flight state maps are cleaned up in all code paths (including errors)

### 4.4 Dependency Safety
- [ ] No external npm dependencies (preferred — use Node.js built-ins)
- [ ] If external deps are required, they are pinned to exact versions
- [ ] All external deps have been checked against the GitHub Advisory Database
- [ ] No dependencies with known RCE, injection, or prototype pollution vulnerabilities

### 4.5 Data Handling
- [ ] No sensitive data (API keys, tokens, PII) is written to log files
- [ ] No sensitive data is stored in plaintext beyond what is strictly necessary
- [ ] Persisted files use atomic write patterns (temp file + rename) where data loss would be harmful
- [ ] No user data is sent to external services without explicit opt-in configuration

### 4.6 Network Safety
- [ ] Outbound HTTP requests use a timeout (recommended: 5 seconds)
- [ ] Outbound URLs are validated before use (must start with https://)
- [ ] No SSRF: user-supplied URLs are not proxied without restriction
- [ ] Outbound errors are caught and never propagate to the response

### 4.7 Rate Limiting of Side Effects
- [ ] Expensive operations (database writes, webhook calls) are debounced or rate-limited
- [ ] Log output is rate-limited for high-frequency events (no log flooding)
- [ ] Cache writes are bounded; cache reads are O(1) or O(log n) worst case

---

## 5. Performance Requirements & SLOs

All plugins are expected to meet the following service-level objectives. Violation of these SLOs may cause the plugin to be disabled automatically in a future version of the plugin manager.

### 5.1 Latency Budget

| Hook / Phase          | P50 Target | P99 Limit   | Notes                                      |
|-----------------------|------------|-------------|------------------------------------------- |
| `middleware()`        | < 1 ms     | < 5 ms      | Excludes first-time body read from stream  |
| `authenticate()`      | < 2 ms     | < 10 ms     |                                            |
| `onUnaryResponse()`   | < 0.5 ms   | < 2 ms      |                                            |
| `onStreamChunk()`     | < 0.1 ms   | < 0.5 ms    | Critical path — absolute minimum           |
| `onContentGenerated()`| < 1 ms     | < 5 ms      |                                            |
| `init()`              | < 500 ms   | < 2000 ms   | One-time cost; no hard limit but be sane  |
| Route handlers        | < 50 ms    | < 500 ms    | Excludes external I/O wait time            |

### 5.2 Memory Budget

| Category              | Limit        | Notes                                           |
|-----------------------|--------------|-------------------------------------------------|
| In-memory cache       | ≤ 200 MB     | Use LRU eviction; expose size config to users   |
| In-flight state       | ≤ 10 MB      | Pending response maps etc.                      |
| Plugin code + data    | ≤ 50 MB      | Including loaded modules                        |
| Single request        | ≤ 5 MB       | Per-request allocations must be GC-able         |

### 5.3 CPU Budget

- No synchronous CPU work > 5 ms on the main event loop thread
- Heavy computation (ML inference, regex over 1 MB+ strings) must be offloaded to a Worker thread
- Regex patterns must complete in < 1 ms on inputs up to 100 KB

---

## 6. Testing Requirements

### 6.1 Minimum Test Coverage

Every plugin must include tests in `src/plugins/<plugin-name>/tests/` or equivalent. Minimum required test scenarios:

**Unit Tests (required):**
- [ ] `init()` succeeds with minimal config
- [ ] `middleware()` returns `{ handled: false }` for non-matching requests
- [ ] `middleware()` returns `{ handled: true }` when short-circuiting (e.g., cache hit, rate limit)
- [ ] `middleware()` never throws; returns `{ handled: false }` on internal errors
- [ ] All public methods of internal modules (cache, optimizer, etc.)
- [ ] Config load with missing file returns defaults
- [ ] Config save/load round-trip

**Integration Tests (required for marketplace listing):**
- [ ] Full request flow: request → middleware → provider call → hook → response
- [ ] Concurrent request handling (at least 10 simultaneous requests)
- [ ] Config update via REST API persists across a simulated restart
- [ ] Auth rejection on protected endpoints (missing token → 401)

**Edge Case Tests (strongly recommended):**
- [ ] Empty messages array
- [ ] Messages with null/undefined content
- [ ] Very large body (> 1 MB)
- [ ] Invalid JSON body
- [ ] Malformed API keys/tokens
- [ ] Extreme config values (maxSize=1, ttl=0, limit=1)

### 6.2 Test File Structure

```
src/plugins/my-plugin/
├── index.js
├── [module].js
└── tests/
    ├── unit.test.js       ← Module-level unit tests
    ├── integration.test.js ← End-to-end plugin tests
    └── fixtures/
        ├── messages.json  ← Test message arrays
        └── responses.json ← Cached response fixtures
```

---

## 7. Plugin Information Form (Template)

When submitting a plugin for the marketplace, complete the following information form. This becomes the plugin's `marketplace-catalog.js` entry and README.

```
════════════════════════════════════════════════════════════════
  BLACKLISTEDAIPROXY PLUGIN SUBMISSION FORM
════════════════════════════════════════════════════════════════

SECTION A — IDENTIFICATION
─────────────────────────
Plugin ID (unique slug, lowercase, hyphenated):
  _______________________________________________

Display Name:
  _______________________________________________

Version (SemVer):
  _______________________________________________

Author Name:
  _______________________________________________

Author URL / GitHub Profile:
  _______________________________________________

Repository URL (source code):
  _______________________________________________

License (SPDX identifier, e.g. MIT, Apache-2.0, GPL-3.0):
  _______________________________________________

Plugin Size Estimate (e.g. ~15 KB):
  _______________________________________________

Minimum BlacklistedAIProxy Core Version:
  _______________________________________________

────────────────────────────────────────────────────────────────
SECTION B — CLASSIFICATION
─────────────────────────
Primary Category (circle one):
  security | optimization | analytics | utilities | productivity | ai-enhancement

Sub-Categories (list up to 3):
  _______________________________________________

Trust Tier (circle one, self-assessed for community submissions):
  official | verified | community

Plugin Type (circle one):
  middleware | auth | hooks-only | ui-extension

Capabilities (check all that apply):
  [ ] middleware()        — Intercepts AI requests
  [ ] authenticate()      — Participates in auth flow
  [ ] hooks               — Subscribes to lifecycle events
  [ ] routes              — Exposes REST API endpoints
  [ ] static files        — Provides dashboard HTML pages

Tags (comma-separated, lowercase):
  _______________________________________________

────────────────────────────────────────────────────────────────
SECTION C — DESCRIPTION
───────────────────────
One-Line Description (< 120 characters):
  _______________________________________________

Full Markdown Description (include: what it does, why it matters,
  key features, configuration options, usage examples):
  ┌─────────────────────────────────────────────────┐
  │                                                 │
  │                                                 │
  └─────────────────────────────────────────────────┘

Dashboard URL (if plugin provides its own page, relative path):
  _______________________________________________

Documentation URL (external docs, if any):
  _______________________________________________

────────────────────────────────────────────────────────────────
SECTION D — TECHNICAL DETAILS
─────────────────────────────
Execution Priority (1–9999, see priority table):
  _______________________________________________

Config File Path (e.g. configs/my-plugin.json):
  _______________________________________________

Is Restart Required to Toggle?: [ ] Yes  [x] No

Is the Plugin Configurable via REST API?:  [ ] Yes  [ ] No

Does the Plugin Store Data Persistently?:  [ ] Yes  [ ] No
  If yes, where?: ___________________________________

Does the Plugin Make Outbound HTTP Requests?:  [ ] Yes  [ ] No
  If yes, to which domains?: ________________________

Does the Plugin Modify Request Bodies?:  [ ] Yes  [ ] No
  If yes, explain the modification: ________________

Does the Plugin Cache Responses?:  [ ] Yes  [ ] No
  If yes, what is the max memory usage?: ____________

────────────────────────────────────────────────────────────────
SECTION E — SECURITY SELF-ASSESSMENT
────────────────────────────────────
(Complete the Security Checklist from Section 4 and attach it)

Known Limitations or Caveats:
  _______________________________________________

────────────────────────────────────────────────────────────────
SECTION F — CHANGELOG
─────────────────────
v1.0.0 (YYYY-MM-DD):
  _______________________________________________

════════════════════════════════════════════════════════════════
```

---

## 8. Marketplace Catalog Schema Reference

Each plugin entry in `src/core/marketplace-catalog.js` follows this schema:

```ts
interface PluginCatalogEntry {
    // Required
    id:             string;    // Unique slug matching directory name
    name:           string;    // Human-readable display name
    version:        string;    // SemVer version
    author:         { name: string; url: string };
    category:       string;    // Primary category slug
    trustTier:      'official' | 'verified' | 'community';
    description:    string;    // < 120 chars, one-liner
    longDescription: string;   // Markdown-formatted full description
    icon:           string;    // FontAwesome class (e.g. 'fa-bolt')
    iconColor:      string;    // CSS color string (e.g. '#f59e0b')
    capabilities:   string[];  // ['middleware', 'routes', 'hooks', 'static']
    license:        string;    // SPDX identifier
    changelog:      Array<{ version: string; date: string; notes: string }>;

    // Optional
    subCategories?: string[];
    rating?:        { score: number; count: number };  // 0.0–5.0
    installs?:      number;
    featured?:      boolean;
    tags?:          string[];
    minCoreVersion?: string;
    size?:          string;    // e.g. '~15 KB'
    repository?:    string;
    documentationUrl?: string | null;
    dashboardUrl?:  string | null;   // Relative URL to plugin page
    configurable?:  boolean;
    restartRequired?: boolean;
    screenshots?:   string[];

    // Runtime (populated by marketplace-api.js, NOT stored in catalog)
    installed?:     boolean;
    enabled?:       boolean;
}
```

---

## 9. Top 5 Recommended Plugin Concepts

> **Selection Criteria:** Every concept below was evaluated against BlacklistedAIProxy's unique value
> proposition: **all major commercial LLMs are 100% free to users, and built-in provider routing
> already selects the best-fit model by request context.** A plugin concept is disqualified if it:
> - Duplicates core routing logic (routing already exists as a built-in feature)
> - Frames its value around "cheaper" models (meaningless when everything is free)
> - Introduces quotas, token budgets, or resource rationing (there is nothing to ration — access is unlimited)
>
> Concepts are ranked by *net-new capability* they add that does not exist anywhere in the current codebase.

The following five plugin concepts were selected by analyzing:
1. BlacklistedAIProxy's unique free-access-to-all-LLMs architecture
2. The top 50 AI infrastructure repositories on GitHub by stars
3. NadirClaw's architecture (prompt caching, token optimization, wizard UX)
4. Real user pain points reported in LiteLLM, OpenRouter, and similar proxy issue trackers
5. Feature gaps that **cannot** be solved by existing core features

Each concept combines best practices from multiple open-source projects and adds capability that
does not exist anywhere else in the current codebase.

---

### Concept #1 — Multi-Model Ensemble Synthesizer ⭐ TOP PICK

**Category:** ai-enhancement  
**Priority Slot:** 300  
**Estimated Impact:** Measurable quality uplift on every request; unique killer feature only possible
because all models are free

**The Core Insight:**
Every other AI proxy on the market forces users to pick *one* model per request — because every
call costs money. BlacklistedAIProxy is the only proxy where sending a prompt to 3 or 4 frontier
models simultaneously costs the user exactly **$0.00**. This plugin turns that structural advantage
into a first-class feature: fan out one prompt to N models, collect all responses, synthesize or
vote on the best answer, and return a single high-confidence reply.

**What it does:**
1. Intercepts any chat/completion request before it reaches the provider
2. Fans the prompt out to a configurable set of models in parallel (e.g. GPT-4o + Claude 3.5
   Sonnet + Gemini 1.5 Pro)
3. Collects all N responses with latency and quality metadata
4. Runs a lightweight synthesis step (configurable):
   - **`vote`** — majority consensus on factual answers (most common answer wins)
   - **`best`** — return the response that scores highest on a heuristic rubric (length, coherence,
     format match)
   - **`merge`** — call a lightweight "judge" model to synthesize all N answers into one refined
     response
   - **`all`** — return all responses as a structured JSON array (power-user / comparison mode)
5. Logs per-model latency and quality score for dashboard visualization

**Key Open-Source References:**
- RouteLLM (lm-sys/routellm) — multi-model dispatch and quality evaluation patterns
- LiteLLM (BerriAI/litellm) — parallel provider fan-out, response aggregation
- Chatbot Arena (lm-sys/FastChat) — model comparison and ELO-based quality ranking methodology
- OpenAI Evals (openai/evals) — rubric-based response scoring patterns
- LangChain MapReduceDocumentsChain — fan-out / reduce synthesis pattern
- Guardrails AI (guardrails-ai/guardrails) — structured response validation before synthesis
- Portkey AI Gateway (Portkey-AI/gateway) — multi-provider parallel request patterns

**Technical Implementation:**
1. **Fan-out middleware** (runs at priority 300, before provider dispatch):
   - Clones request body N times
   - Fires N provider calls in parallel using `Promise.allSettled`
   - Respects existing per-provider auth from config (no duplicate auth setup needed)
2. **Synthesis engine** (`synthesizer.js`):
   - `vote`: tokenize each response → extract final answer → find most common → return
   - `best`: score each response on 4 heuristics (relevance keywords, length normalcy,
     markdown structure if requested, no refusal markers) → return highest scorer
   - `merge`: construct a meta-prompt like `"Given these N answers: [...] provide the best
     combined answer"` and call the fastest available model as judge
   - `all`: serialize to `{ responses: [{model, text, latencyMs, score}] }` JSON
3. **Streaming support**: In `best` and `vote` modes, buffer all responses then stream the winner
   back. In `all` mode, stream a newline-delimited JSON array
4. **Timeout contract**: each provider call has a hard 15 s timeout; any that exceed it are
   dropped from synthesis (minimum 1 required to respond)
5. **Dashboard panel**: `static/ensemble.html`
   - Model selector checkboxes (which models participate)
   - Per-model average latency, win rate, agreement rate
   - Synthesis mode dropdown
   - Live request log showing fan-out results per request

**Config Schema:**
```json
{
  "enabled": false,
  "models": ["gpt-4o", "claude-3-5-sonnet-20241022", "gemini-1.5-pro"],
  "synthesisMode": "best",
  "timeoutMs": 15000,
  "minResponses": 1,
  "judgeModel": "gemini-2.0-flash",
  "allowClientOverride": true,
  "streamingMode": "winner"
}
```

**Why this is the right #1 pick — and why the previous suggestion was wrong:**

The previously suggested "Smart Model Router" was **disqualified on two grounds**:
1. **Duplicate functionality** — BlacklistedAIProxy's core provider routing system already
   selects the best-fit LLM based on request context. A plugin that does the same thing adds
   zero net value.
2. **Invalid value framing** — routing to "cheaper" models is meaningless when every model is
   free. The entire premise of cost savings collapses.

The Ensemble Synthesizer is the **exact opposite**:
- It is only possible *because* all models are free (no one else can afford to call 4 frontier
  models per request)
- It adds a capability that does not exist in the core (multi-model fan-out + synthesis)
- It turns the product's core value proposition into a tangible, demonstrable feature
- Users can literally see 4 frontier AI responses side-by-side for one query

**Why it's the #1 recommendation:** See Section 10.

---

### Concept #2 — Semantic Cache

**Category:** optimization  
**Priority Slot:** 60 (runs before token-optimizer)  
**Estimated Impact:** Latency reduction 80–95% for semantically equivalent repeat queries; measurably
faster perceived response times for end users asking similar questions

**What it does:**
Extends the exact-match prompt cache (token-optimizer) with fuzzy similarity matching. Uses sentence embeddings to find cached responses that are semantically equivalent, even when the exact wording differs.

**Key Open-Source References:**
- GPTCache (zilliztech/GPTCache) — semantic cache architecture, cosine similarity matching
- semantic-router (aurelio-labs/semantic-router) — fast semantic routing
- LangChain SemanticSimilarityExampleSelector — embedding-based matching
- Chroma (chroma-core/chroma) — vector database for embedding storage
- Nomic Embed (nomic-ai/nomic-embed-text) — efficient local embeddings

**Technical Implementation:**
1. Embed each request's last user message using a lightweight local model
   (e.g., `all-MiniLM-L6-v2` via ONNX Runtime — no Python required)
2. Store embeddings + responses in a vector index (in-memory with HNSW)
3. On each request: compute embedding → search for nearest neighbors
4. If cosine similarity > threshold (default: 0.92) → return cached response
5. Dashboard: similarity threshold slider, cache visualizer

**Key Complexity:** Requires ONNX Runtime or calling an embedding endpoint. Two modes:
- `local` — uses a bundled ONNX model (~100 MB download on first use)
- `remote` — calls a configurable embedding endpoint (e.g., OpenAI `/embeddings`)

---

### Concept #3 — Conversation Memory Store

**Category:** ai-enhancement  
**Priority Slot:** 150  
**Estimated Impact:** Enables persistent, cross-session AI memory for all clients

**What it does:**
Injects a persistent memory summary into every AI request, enabling the AI to "remember" facts about each user across sessions without the client needing to manage context.

**Key Open-Source References:**
- MemGPT (cpacker/MemGPT) — hierarchical memory architecture
- mem0 (mem0ai/mem0) — user memory extraction and injection API
- LangMem (langchain-ai/langmem) — conversation memory distillation
- Zep (getzep/zep) — persistent memory service
- LangChain ConversationSummaryMemory — summarization-based memory

**Technical Implementation:**
1. After each request, extract key facts from the assistant's response using an NLP summarizer
2. Store per-user memory profiles in a SQLite database keyed by API key or IP
3. Before each request, inject a `<memory>` system message with relevant facts
4. Memory summarization every 10 turns to keep size bounded
5. User-configurable memory retention period (default: 30 days)
6. Admin dashboard: view/edit/clear memory per user

**Config Schema:**
```json
{
  "enabled": false,
  "maxMemoryTokens": 500,
  "retentionDays": 30,
  "summarizeEveryN": 10,
  "keyBy": "api_key"
}
```

---

### Concept #4 — Response Quality Guard

**Category:** security + ai-enhancement  
**Priority Slot:** 4000 (runs post-provider in hooks)  
**Estimated Impact:** Reduces hallucination delivery rate by 30–60%

**What it does:**
Evaluates AI responses for quality issues (hallucinations, harmful content, off-topic replies) and automatically retries with a corrective prompt or falls back to a safer model.

**Key Open-Source References:**
- promptfoo (promptfoo-dev/promptfoo) — LLM evaluation framework
- G-Eval (microsoft/promptbench) — LLM-based evaluation methodology
- DeepEval (confident-ai/deepeval) — assertion-based response testing
- RAGAS (explodinggradients/ragas) — RAG answer quality metrics
- Guardrails AI (guardrails-ai/guardrails) — output validation

**Technical Implementation:**
1. Quality dimensions evaluated (configurable):
   - Relevance: does the response address the question?
   - Factual consistency: does the response contradict the context?
   - Toxicity: does the response contain harmful content?
   - Hallucination score: does the response fabricate facts?
2. Evaluation method: heuristic checks first (< 1 ms), then optional LLM self-eval
3. Action on low quality: `retry` (re-request with correction prompt), `flag` (log only), `block` (return error)
4. Max retries: configurable (default: 1)
5. Quality score logged per request for analysis

---

### Concept #5 — RAG / Knowledge Base Injection

**Category:** ai-enhancement  
**Priority Slot:** 150 (after memory-store if present, before provider dispatch)  
**Estimated Impact:** Every user prompt answered with grounding from their own documents; eliminates
hallucinations on private/domain knowledge; works with all models simultaneously at zero extra cost

**The Core Insight:**
Every LLM in the pool answers questions based on its training data — which ends at a cut-off date
and contains nothing about your private documents, internal wikis, product manuals, or codebase.
RAG solves this by retrieving the most relevant chunks of *your* content and injecting them as
context before each request. Because all models are free, every user can get RAG-augmented answers
from GPT-4o, Claude, and Gemini simultaneously — this is only possible here.

**What it does:**
1. Accepts document uploads (PDF, Markdown, plain text, DOCX) via a dashboard panel
2. Chunks and embeds documents into a local vector store at ingest time
3. On each request: embeds the user's query → retrieves top-K most relevant chunks
4. Injects retrieved chunks as a `[CONTEXT]` block in the system message before the provider call
5. Works transparently with all models (no per-model configuration needed), including the
   Ensemble Synthesizer — all N models get the same RAG context injected

**Key Open-Source References:**
- LlamaIndex (run-llama/llama_index) — document ingestion pipeline, node chunking, query engine
- LangChain (langchain-ai/langchain) — RAG chain patterns, retriever interface
- Chroma (chroma-core/chroma) — embeddable local vector database, persistent collections
- Unstructured (Unstructured-IO/unstructured) — PDF/DOCX parsing and chunking strategies
- HuggingFace Transformers.js (xenova/transformers.js) — browser/Node-compatible embedding models
- FAISS (facebookresearch/faiss) — high-performance approximate nearest-neighbor search
- Nomic Embed (nomic-ai/nomic-embed-text) — efficient open-source embedding model

**Technical Implementation:**
1. **Ingest pipeline** (`rag-ingest.js`):
   - Accept file upload via `/api/plugins/rag/upload` (PDF, .md, .txt, .docx)
   - Parse to plain text (pdfjs-dist for PDF, mammoth for DOCX, native for text/markdown)
   - Chunk with a sliding window: configurable `chunkSize` (default: 512 tokens) and `chunkOverlap`
     (default: 64 tokens) to preserve cross-chunk context
   - Embed each chunk using a local embedding model (Transformers.js, no Python required)
   - Persist embeddings + raw chunk text in a SQLite-backed vector store (sqlite-vec or better-sqlite3
     with cosine similarity UDF)
   - Associate each document with an owner: `global` (all users) or a specific API key

2. **Retrieval middleware** (runs at priority 150):
   - Extract the last user message from `req.body.messages`
   - Embed query → nearest-neighbor search → top-K chunks (default K=4)
   - If similarity of best match < threshold (default: 0.65), skip injection (no irrelevant context)
   - Inject retrieved chunks as a system message:
     ```
     [RETRIEVED CONTEXT — use this to answer the user's question]
     --- Chunk from: document-name.pdf ---
     <chunk text>
     ---
     ```
   - Log which document + chunks were injected, similarity scores

3. **Dashboard panel** (`static/rag.html`):
   - Document library: upload, list, delete, view chunk count per document
   - Per-document scope toggle: available to all users vs. scoped to specific API key
   - Query tester: enter a query, see which chunks would be retrieved and their similarity scores
   - Retrieval stats: which documents are queried most, average similarity score per document

4. **No quota anywhere**: no document count limit, no query limit, no token budget —
   all models are free, so there is no cost to injecting context into every request

**Config Schema:**
```json
{
  "enabled": false,
  "chunkSize": 512,
  "chunkOverlap": 64,
  "topK": 4,
  "similarityThreshold": 0.65,
  "embeddingModel": "Xenova/all-MiniLM-L6-v2",
  "maxContextTokens": 2000,
  "injectPosition": "system",
  "allowUserUploads": true
}
```

**Why it fits this product specifically:**
- Zero cost to inject more context — all models are free, so larger context = better answers at $0
- Works with the Ensemble Synthesizer — all 4 models get identical RAG context, and their synthesis
  becomes grounded in your documents rather than hallucinated
- No vendor lock-in: uses local embeddings (Transformers.js) so no external embedding API is needed
- Completely additive — no overlap with any existing plugin or core feature

---

## 10. #1 Recommended Next Plugin: Multi-Model Ensemble Synthesizer

**Recommendation: Build the Multi-Model Ensemble Synthesizer as the next plugin.**

### Why This Plugin Above All Others?

This plugin exists **only** because of BlacklistedAIProxy's core promise of free access to all major
LLMs. No paid proxy can offer this — they'd be burning money on every request. Here, sending a
single prompt to GPT-4o, Claude 3.5 Sonnet, and Gemini 1.5 Pro in parallel costs the user **$0**.
That structural advantage is leveraged into a flagship quality feature no competitor can replicate.

| Criterion                      | Score (1–5) | Notes                                                      |
|--------------------------------|-------------|----------------------------------------------------------- |
| Net-new capability             | ★★★★★       | Nothing in the core or any existing plugin does this      |
| Unique to this product         | ★★★★★       | Only viable because all models are free                   |
| User value / wow factor        | ★★★★★       | Returning one best answer from 4 frontier AIs is visceral |
| Infrastructure fit             | ★★★★★       | Builds directly on existing provider pool architecture    |
| Implementation complexity      | ★★★★☆       | `Promise.allSettled` fan-out is straightforward           |
| Risk (graceful degradation)    | ★★★★★       | If N models fail, still returns the 1 that responded      |
| Differentiator vs competitors  | ★★★★★       | No other proxy product offers free ensemble synthesis     |

**Total Score: 34/35** — highest of all five concepts.

### Specific Features to Prioritize

1. **Fan-out engine** — parallel `Promise.allSettled` across N providers:
   - Share existing provider-pool connections (no re-auth overhead)
   - Per-provider hard timeout (default: 15 s)
   - Drop any provider that times out or errors; never block the response

2. **Synthesis modes** (configurable per-request via header or config default):
   - `best` — heuristic scorer (length, coherence, no-refusal markers) → return winner
   - `vote` — tokenize last sentence of each response → majority consensus answer
   - `merge` — construct a judge meta-prompt, call fastest available model as synthesizer
   - `all` — return structured `{responses: [...]}` JSON array for client-side comparison

3. **Streaming support**:
   - `best` and `vote`: buffer all responses, stream the winner back to client
   - `all`: stream as newline-delimited JSON (NDJSON), each model's response as it arrives

4. **Ensemble Dashboard** (`static/ensemble.html`):
   - Model selector: which models participate in ensemble
   - Live request log: per-model latency + score for every fanned-out request
   - Win-rate chart: which model wins most often across synthesis modes
   - Agreement rate: how often all N models give equivalent answers

5. **Override header**: `X-Ensemble-Mode: all` / `X-Ensemble-Models: gpt-4o,claude-3-5-sonnet`
   — lets power users customize ensemble per-request without config changes

### Key Design Decisions

**Does this conflict with the core provider routing?**  
No. Core routing selects *which provider account/endpoint* to use for a given model name.
The ensemble plugin runs *before* that, constructing N separate sub-requests each of which then
goes through normal provider routing independently.

**What if the user explicitly specifies a model in their request?**  
In `best`/`vote`/`merge` modes, the requested model is always included in the ensemble and its
response wins any tie. In `all` mode, the user gets the requested model's response labeled with
its name alongside others.

**Should it work with non-chat endpoints (completions, embeddings)?**  
Phase 1: chat completions only (highest-value, easiest to synthesize).
Phase 2: text completions. Phase 3: embeddings (average all N embedding vectors).

**Priority slot:** 300 — after token-optimizer (50) and universal-guard (9500), before provider
dispatch. Streaming fan-out returns through the normal response pipeline.

## 11. Changelog Policy

All plugins must follow these changelog practices:

1. **Semantic Versioning**: MAJOR.MINOR.PATCH
   - MAJOR: Breaking changes to API, config schema, or behavior
   - MINOR: New features, backward compatible
   - PATCH: Bug fixes, performance improvements, security patches

2. **Changelog Entry Format:**
   ```json
   {
     "version": "1.2.0",
     "date": "YYYY-MM-DD",
     "notes": "Brief description of all changes in this release."
   }
   ```

3. **Security Releases**: Increment PATCH and prefix notes with `[SECURITY]`.

4. **Deprecation Policy**: Deprecated features must be documented for at least one MINOR version before removal.

---

*This document is maintained by the BlacklistedAIProxy core team. For questions, open an issue in the GitHub repository.*

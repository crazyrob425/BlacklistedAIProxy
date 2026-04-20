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
10. [#1 Recommended Next Plugin: Smart Model Router](#10-1-recommended-next-plugin-smart-model-router)
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

The following five plugin concepts were selected by analyzing:
1. BlacklistedAIProxy's most-requested features
2. The top 50 AI infrastructure repositories on GitHub by stars
3. NadirClaw's architecture (token routing, cost optimization)
4. Common pain points reported in LiteLLM, OpenRouter, and similar proxy issues
5. Feature gaps in the current plugin ecosystem

Each concept combines the best practices from multiple open-source projects.

---

### Concept #1 — Smart Model Router ⭐ TOP PICK

**Category:** optimization  
**Priority Slot:** 200  
**Estimated Impact:** Cost reduction 30–70%, quality improvement 15–25%

**What it does:**
Automatically selects the cheapest AI model capable of handling each request's complexity. Simple requests (Q&A, short completions) are routed to cheap fast models (gemini-flash, gpt-4o-mini); complex requests (code generation, long analysis) are routed to premium models.

**Key Open-Source References:**
- NadirClaw (NadirRouter/NadirClaw) — tier-based model routing
- LiteLLM (BerriAI/litellm) — multi-provider routing, cost-aware dispatch
- RouteLLM (lm-sys/routellm) — ML-based routing, BERT classifier
- OpenRouter — quality-based routing heuristics
- Marvin (prefecthq/marvin) — task classification patterns

**Technical Implementation:**
1. Message complexity classifier (heuristic-based, < 1 ms):
   - Token count → `light` (< 500) / `medium` (500–2000) / `heavy` (> 2000)
   - Code detection (backticks, keywords) → `heavy`
   - Multi-step instruction detection → `medium` or `heavy`
   - Simple Q&A pattern → `light`
2. Tier mapping (user-configurable):
   - `light` → gemini-2.0-flash, gpt-4o-mini, claude-3-haiku
   - `medium` → gemini-1.5-pro, gpt-4o, claude-3-5-sonnet
   - `heavy` → gemini-2.5-pro, gpt-4, claude-3-5-opus
3. Override system: `x-model-tier: heavy` header bypasses routing
4. Per-request routing log: which tier was assigned and why
5. Cost tracking: dashboard showing savings vs always-using-premium

**Config Schema:**
```json
{
  "enabled": true,
  "defaultTier": "auto",
  "tiers": {
    "light":  { "models": ["gemini-2.0-flash", "gpt-4o-mini"] },
    "medium": { "models": ["gemini-1.5-pro", "gpt-4o"] },
    "heavy":  { "models": ["gemini-2.5-pro", "claude-3-5-sonnet"] }
  },
  "thresholds": { "lightMaxTokens": 500, "mediumMaxTokens": 2000 },
  "allowClientOverride": true
}
```

**Why it's the #1 recommendation:** See Section 10.

---

### Concept #2 — Semantic Cache

**Category:** optimization  
**Priority Slot:** 60 (runs before token-optimizer)  
**Estimated Impact:** Cost reduction 40–80% for similar (not identical) queries

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

### Concept #5 — Team Access Control & Multi-Tenancy

**Category:** security  
**Priority Slot:** 9800 (early, auth-adjacent)  
**Estimated Impact:** Enables enterprise team deployments with per-user policies

**What it does:**
Extends the single API key model to support multi-user teams with individual accounts, per-user rate limits, model access control, and audit logging.

**Key Open-Source References:**
- Casdoor (casdoor/casdoor) — open-source IAM
- Casbin (casbin/casbin) — RBAC/ABAC policy engine
- Permit.io policy patterns — fine-grained authorization
- OpenFGA (openfga/openfga) — relationship-based access control
- OWASP API Security Top 10 — authorization best practices

**Technical Implementation:**
1. User registry: SQLite table (id, username, api_key_hash, role, created_at)
2. Roles: `admin`, `power_user`, `basic_user`, `read_only`
3. Per-role policy:
   - Which models are accessible
   - Request rate limits (overrides global rate limiter)
   - Monthly token quota
4. Audit log: every request logged with (user, model, tokens, timestamp)
5. Admin panel: user management, key rotation, usage reports

---

## 10. #1 Recommended Next Plugin: Smart Model Router

**Recommendation: Build the Smart Model Router as the next plugin.**

### Why This Plugin Above All Others?

| Criterion                    | Score (1–5) | Notes                                              |
|------------------------------|-------------|--------------------------------------------------- |
| Immediate cost impact        | ★★★★★       | Users see dollar savings from the first request   |
| Implementation complexity    | ★★★★☆       | Heuristic classifier is straightforward; no ML    |
| User value                   | ★★★★★       | Broadest appeal — relevant to every user          |
| Infrastructure fit           | ★★★★★       | Integrates cleanly with existing provider pool    |
| Measurability                | ★★★★★       | Cost saved is directly calculable and displayable |
| Risk                         | ★★★★★       | Low — graceful degradation (pass original model) |
| Differentiator               | ★★★★★       | NadirClaw proved this concept; we can exceed it   |

**Total Score: 34/35** — highest of all five concepts.

### Specific Features to Prioritize

1. **Complexity Classifier** — heuristic-based, < 1 ms, no ML required:
   - Token count thresholds (configurable)
   - Code detection regex
   - Multi-step instruction keywords
   - Simple Q&A patterns

2. **Tier Configuration** — user-friendly YAML/JSON config:
   - Map tiers to actual provider model names
   - Support per-provider-type overrides

3. **Cost Dashboard** — extend token-optimizer.html or create router.html:
   - Tier distribution pie chart
   - Cost saved vs always-using premium
   - Per-tier average response quality score

4. **Override Mechanisms** — for power users:
   - `X-Model-Tier` header override
   - Per-model regex passthrough list (e.g., always route o1 requests directly)
   - Client-specified model respected if in allowed tier

5. **Quality Feedback Loop** (v2 feature):
   - Log response quality signals
   - Auto-adjust thresholds based on user feedback

### Key Design Decisions

**Should the router modify the `model` field in the request body?**  
Yes. The router middleware rewrites `body.model` to the tier-selected model before the provider routing phase. The original requested model is preserved in `config._routerOriginalModel` for logging and audit purposes.

**What if no provider supports the tier-selected model?**  
Fallback to the client's originally requested model. Never block a request due to routing failure.

**Should it work with streaming?**  
Yes — the model substitution happens before the provider call, so streaming works transparently.

**Priority:** 200 (after token-optimizer's cache check at 50, before security guards at 9000).

---

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

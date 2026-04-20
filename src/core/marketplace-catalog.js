/**
 * Plugin Marketplace Catalog
 *
 * This module is the single source of truth for all plugin metadata displayed
 * in the BlacklistedAIProxy Plugin Marketplace.  At runtime, the catalog is
 * augmented with live "installed" and "enabled" status queried from the
 * PluginManager.
 *
 * Catalog schema (per plugin):
 *  id             {string}  Unique slug, matches the plugin directory/name
 *  name           {string}  Human-readable display name
 *  version        {string}  SemVer string
 *  author         {Object}  { name, url }
 *  category       {string}  Primary category slug
 *  subCategories  {string[]} Secondary category slugs
 *  trustTier      {string}  'official' | 'verified' | 'community'
 *  rating         {Object}  { score: 0-5, count: number }
 *  installs       {number}  Download/activation counter
 *  featured       {boolean} Show in "Featured" section
 *  description    {string}  One-line description (< 120 chars)
 *  longDescription {string} Markdown-compatible full description
 *  icon           {string}  FontAwesome icon class (fa-*)
 *  iconColor      {string}  CSS color for icon background
 *  tags           {string[]}
 *  capabilities   {string[]} 'middleware' | 'routes' | 'hooks' | 'static'
 *  minCoreVersion {string}  Minimum compatible BlacklistedAIProxy version
 *  size           {string}  Display size estimate
 *  license        {string}  SPDX identifier
 *  repository     {string}  URL to source code
 *  documentationUrl {string|null}
 *  dashboardUrl   {string|null}  Relative URL to dedicated plugin page
 *  configurable   {boolean}  Whether the plugin has configurable settings
 *  restartRequired {boolean} Whether toggling requires a server restart
 *  changelog      {Array<{version, date, notes}>}
 *
 * Runtime fields (added by marketplace-api.js):
 *  installed      {boolean}
 *  enabled        {boolean}
 */

export const MARKETPLACE_CATALOG = [
    // ── Token Optimizer ───────────────────────────────────────────────────────
    {
        id:           'token-optimizer',
        name:         'Token Optimizer',
        version:      '1.0.0',
        author:       { name: 'BlacklistedAPI Team', url: 'https://github.com/crazyrob425/BlacklistedAIProxy' },
        category:     'optimization',
        subCategories: ['caching', 'cost-saving', 'performance'],
        trustTier:    'official',
        rating:       { score: 5.0, count: 0 },
        installs:     0,
        featured:     true,
        description:  'Cut token costs 20–70% with SHA-256 LRU prompt caching and intelligent context optimization (safe/aggressive modes).',
        longDescription: `## Token Optimizer

Reduces the cost of every AI API call through two complementary strategies that work transparently — no changes to your clients required.

### Prompt Cache
Identical requests are returned from an in-memory LRU cache in **< 1 ms**, completely bypassing the upstream provider. 

- SHA-256 keyed by (model + messages) — zero false-positive cache hits
- Configurable TTL (default: 1 hour) and max entries (default: 500)
- Hit-rate, miss-rate, and saved-cost statistics available in real time
- Cache survives the hot path; misses add zero latency

### Context Optimizer
Reduces token count in message arrays **before** forwarding to the provider.

**Safe mode** (lossless):
- Whitespace normalisation
- JSON content minification
- Duplicate system-message removal
- Empty message pruning
- Null-field stripping

**Aggressive mode** (minimal semantic impact):
- Everything in safe mode, plus:
- Long assistant-turn truncation (keeps head + tail)
- Tool-result collapsing
- Conversation history trimming (last 20 turns)

### Cost Estimation
Built-in pricing table covers Gemini, Claude, GPT, Qwen, Grok, and Kimi.
Live cost-savings dashboard available at [token-optimizer.html](/token-optimizer.html).`,
        icon:         'fa-bolt',
        iconColor:    '#f59e0b',
        tags:         ['cache', 'cost', 'optimization', 'performance', 'tokens'],
        capabilities: ['middleware', 'routes', 'hooks', 'static'],
        minCoreVersion: '2.0.0',
        size:         '~18 KB',
        license:      'GPL-3.0',
        repository:   'https://github.com/crazyrob425/BlacklistedAIProxy/tree/main/src/plugins/token-optimizer',
        documentationUrl: null,
        dashboardUrl: '/token-optimizer.html',
        configurable: true,
        restartRequired: false,
        changelog: [
            {
                version: '1.0.0',
                date:    '2026-04-20',
                notes:   'Initial release. LRU prompt cache (SHA-256, TTL, LRU eviction), safe/aggressive optimization modes, 8 message transforms, per-model cost estimation, REST management API.',
            },
        ],
        screenshots: [],
    },

    // ── Universal Guard ───────────────────────────────────────────────────────
    {
        id:           'universal-guard',
        name:         'Universal Guard',
        version:      '1.0.0',
        author:       { name: 'BlacklistedAPI Team', url: 'https://github.com/crazyrob425/BlacklistedAIProxy' },
        category:     'security',
        subCategories: ['rate-limiting', 'privacy', 'compliance', 'budget'],
        trustTier:    'official',
        rating:       { score: 5.0, count: 0 },
        installs:     0,
        featured:     true,
        description:  'Five-in-one security layer: rate limiting, budget control, PII scrubbing, jailbreak detection, and webhook alerting.',
        longDescription: `## Universal Guard

A comprehensive, production-hardened security and governance plugin that adds five protection layers to every AI request — all configurable and independently toggleable.

### 1 — Rate Limiter
Sliding-window rate limiting per IP address and per API key.
- Configurable requests-per-minute and requests-per-hour thresholds
- ~0.01 ms overhead on the hot path
- HTTP 429 responses with Retry-After information

### 2 — Budget Guard  
Prevents runaway API spend with configurable daily and monthly USD limits.
- Cost estimation per request using the built-in pricing table
- Warn threshold (default 80%) and block threshold (default 100%)
- Persistent spend tracking across server restarts
- Reset controls via REST API

### 3 — PII Scrubber
Detects and redacts sensitive information **before** it reaches the AI provider.
Patterns: email, credit card, SSN, phone, OpenAI keys, Anthropic keys, Google API keys, AWS access/secret keys, GitHub tokens, Stripe keys, JWTs.
- Action: \`redact\` (replace) or \`flag\` (detect-only, log and continue)
- Each pattern class independently enable/disable-able

### 4 — Prompt Policy  
Protects against misuse with two detection modes:
- **Jailbreak detection**: 25+ curated regex patterns covering all major DAN, override, and instruction-injection variants
- **Custom keyword blocklist**: user-defined words/phrases
- Actions: \`block\` (HTTP 400), \`flag\` (log only), \`sanitize\` (strip content)

### 5 — Incident Alerter
Fire-and-forget webhook notifications on any guard event.
- Slack, Discord, and generic HTTP webhook support
- Deduplication: same event type coalesced within 10-second window
- Non-blocking: never delays API responses`,
        icon:         'fa-shield-halved',
        iconColor:    '#ef4444',
        tags:         ['security', 'rate-limit', 'pii', 'compliance', 'budget', 'jailbreak'],
        capabilities: ['middleware', 'routes', 'hooks', 'static'],
        minCoreVersion: '2.0.0',
        size:         '~22 KB',
        license:      'GPL-3.0',
        repository:   'https://github.com/crazyrob425/BlacklistedAIProxy/tree/main/src/plugins/universal-guard',
        documentationUrl: null,
        dashboardUrl: '/universal-guard.html',
        configurable: true,
        restartRequired: false,
        changelog: [
            {
                version: '1.0.0',
                date:    '2026-04-20',
                notes:   'Initial release. Sliding-window rate limiter, USD budget guard with persistence, regex PII scrubber (12 pattern classes), jailbreak detection (25+ patterns), webhook alerting with dedup.',
            },
        ],
        screenshots: [],
    },

    // ── Model Usage Stats (existing built-in) ─────────────────────────────────
    {
        id:           'model-usage-stats',
        name:         'Model Usage Stats',
        version:      '1.0.0',
        author:       { name: 'BlacklistedAPI Team', url: 'https://github.com/crazyrob425/BlacklistedAIProxy' },
        category:     'analytics',
        subCategories: ['monitoring', 'reporting'],
        trustTier:    'official',
        rating:       { score: 4.8, count: 0 },
        installs:     0,
        featured:     false,
        description:  'Track per-model and per-provider token usage, request counts, and last-used timestamps with persistent SQLite-backed storage.',
        longDescription: `## Model Usage Stats

Provides granular visibility into how your AI quota is being consumed across all providers and models.

- Per-model breakdown: request count, prompt tokens, completion tokens, total tokens, cached tokens
- Per-provider aggregate statistics
- Persistent JSON storage with atomic writes (temp-file + rename pattern)
- Real-time updates via the existing usage dashboard`,
        icon:         'fa-chart-bar',
        iconColor:    '#3b82f6',
        tags:         ['analytics', 'monitoring', 'usage', 'tokens', 'statistics'],
        capabilities: ['hooks', 'routes'],
        minCoreVersion: '2.0.0',
        size:         '~14 KB',
        license:      'GPL-3.0',
        repository:   'https://github.com/crazyrob425/BlacklistedAIProxy/tree/main/src/plugins/model-usage-stats',
        documentationUrl: null,
        dashboardUrl: '/model-usage-stats.html',
        configurable: false,
        restartRequired: false,
        changelog: [
            { version: '1.0.0', date: '2025-01-01', notes: 'Initial release.' },
        ],
        screenshots: [],
    },

    // ── AI Monitor (existing built-in) ────────────────────────────────────────
    {
        id:           'ai-monitor',
        name:         'AI Monitor',
        version:      '1.0.0',
        author:       { name: 'BlacklistedAPI Team', url: 'https://github.com/crazyrob425/BlacklistedAIProxy' },
        category:     'analytics',
        subCategories: ['monitoring', 'alerting'],
        trustTier:    'official',
        rating:       { score: 4.7, count: 0 },
        installs:     0,
        featured:     false,
        description:  'Real-time health monitoring and alerting for provider pools, latency tracking, and error-rate dashboards.',
        longDescription: `## AI Monitor

Continuous health monitoring for all configured AI providers with real-time alerting when error rates or latency exceed configurable thresholds.

- Provider health scores and availability percentages
- Per-request latency tracking and P95/P99 percentiles
- Error classification: 4xx (credential), 5xx (server), timeout, network
- Integration with the live event stream for real-time UI updates`,
        icon:         'fa-heartbeat',
        iconColor:    '#10b981',
        tags:         ['monitoring', 'health', 'alerting', 'latency'],
        capabilities: ['hooks', 'routes'],
        minCoreVersion: '2.0.0',
        size:         '~8 KB',
        license:      'GPL-3.0',
        repository:   'https://github.com/crazyrob425/BlacklistedAIProxy/tree/main/src/plugins/ai-monitor',
        documentationUrl: null,
        dashboardUrl: null,
        configurable: false,
        restartRequired: false,
        changelog: [
            { version: '1.0.0', date: '2025-01-01', notes: 'Initial release.' },
        ],
        screenshots: [],
    },

    // ── Default Auth (existing built-in) ─────────────────────────────────────
    {
        id:           'default-auth',
        name:         'Default Auth',
        version:      '1.0.0',
        author:       { name: 'BlacklistedAPI Team', url: 'https://github.com/crazyrob425/BlacklistedAIProxy' },
        category:     'security',
        subCategories: ['authentication', 'authorization'],
        trustTier:    'official',
        rating:       { score: 4.9, count: 0 },
        installs:     0,
        featured:     false,
        description:  'Core API key authentication middleware. Validates Bearer tokens and query-string API keys on every request.',
        longDescription: `## Default Auth

The foundational authentication layer for BlacklistedAIProxy.

- Bearer token validation (Authorization: Bearer <key>)
- Query-string key support (?key=...)
- REQUIRED_API_KEY configuration integration
- Zero external dependencies`,
        icon:         'fa-lock',
        iconColor:    '#8b5cf6',
        tags:         ['auth', 'security', 'api-key', 'middleware'],
        capabilities: ['middleware'],
        minCoreVersion: '2.0.0',
        size:         '~4 KB',
        license:      'GPL-3.0',
        repository:   'https://github.com/crazyrob425/BlacklistedAIProxy/tree/main/src/plugins/default-auth',
        documentationUrl: null,
        dashboardUrl: null,
        configurable: false,
        restartRequired: false,
        changelog: [
            { version: '1.0.0', date: '2025-01-01', notes: 'Initial release.' },
        ],
        screenshots: [],
    },

    // ── API Potluck (existing built-in) ───────────────────────────────────────
    {
        id:           'api-potluck',
        name:         'API Potluck',
        version:      '1.0.0',
        author:       { name: 'BlacklistedAPI Team', url: 'https://github.com/crazyrob425/BlacklistedAIProxy' },
        category:     'utilities',
        subCategories: ['routing', 'proxy'],
        trustTier:    'official',
        rating:       { score: 4.6, count: 0 },
        installs:     0,
        featured:     false,
        description:  'Shared API potluck mode: distribute a single API key across multiple users with per-user quotas and usage tracking.',
        longDescription: `## API Potluck

Enables "shared pool" mode where a single API key subscription is distributed among multiple users, each with configurable access levels and usage caps.

- Per-user token allocation
- Usage tracking and enforcement
- Admin dashboard for quota management`,
        icon:         'fa-people-group',
        iconColor:    '#f97316',
        tags:         ['sharing', 'quota', 'multi-user', 'pool'],
        capabilities: ['middleware', 'routes'],
        minCoreVersion: '2.0.0',
        size:         '~10 KB',
        license:      'GPL-3.0',
        repository:   'https://github.com/crazyrob425/BlacklistedAIProxy/tree/main/src/plugins/api-potluck',
        documentationUrl: null,
        dashboardUrl: null,
        configurable: true,
        restartRequired: false,
        changelog: [
            { version: '1.0.0', date: '2025-01-01', notes: 'Initial release.' },
        ],
        screenshots: [],
    },
];

/**
 * Available marketplace categories.
 * Each category has an id, label, icon (FontAwesome), and color.
 */
export const MARKETPLACE_CATEGORIES = [
    { id: 'all',          label: 'All',          icon: 'fa-grid-2',      color: '#6b7280' },
    { id: 'installed',    label: 'Installed',    icon: 'fa-check-circle', color: '#10b981' },
    { id: 'security',     label: 'Security',     icon: 'fa-shield',      color: '#ef4444' },
    { id: 'optimization', label: 'Optimization', icon: 'fa-bolt',        color: '#f59e0b' },
    { id: 'analytics',    label: 'Analytics',    icon: 'fa-chart-bar',   color: '#3b82f6' },
    { id: 'utilities',    label: 'Utilities',    icon: 'fa-wrench',      color: '#8b5cf6' },
    { id: 'featured',     label: 'Featured',     icon: 'fa-star',        color: '#f97316' },
];

<div align="center">

```
██████╗ ██╗      █████╗  ██████╗██╗  ██╗██╗     ██╗███████╗████████╗███████╗██████╗      █████╗ ██████╗ ██╗
██╔══██╗██║     ██╔══██╗██╔════╝██║ ██╔╝██║     ██║██╔════╝╚══██╔══╝██╔════╝██╔══██╗    ██╔══██╗██╔══██╗██║
██████╔╝██║     ███████║██║     █████╔╝ ██║     ██║███████╗   ██║   █████╗  ██║  ██║    ███████║██████╔╝██║
██╔══██╗██║     ██╔══██║██║     ██╔═██╗ ██║     ██║╚════██║   ██║   ██╔══╝  ██║  ██║    ██╔══██║██╔═══╝ ██║
██████╔╝███████╗██║  ██║╚██████╗██║  ██╗███████╗██║███████║   ██║   ███████╗██████╔╝    ██║  ██║██║     ██║
╚═════╝ ╚══════╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚══════╝╚═╝╚══════╝   ╚═╝   ╚══════╝╚═════╝     ╚═╝  ╚═╝╚═╝     ╚═╝
```

**[ Blacklisted Binary Labs ]** — *We didn't get the memo saying we had to play nice.*

[![Version](https://img.shields.io/badge/version-2.13.3-red?style=for-the-badge&logo=github)](https://github.com/crazyrob425/BlacklistedAIProxy)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-darkred?style=for-the-badge)](https://www.gnu.org/licenses/gpl-3.0)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A520.0-darkgreen?style=for-the-badge&logo=node.js)](https://nodejs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-blue?style=for-the-badge&logo=docker)](https://hub.docker.com/r/crazyrob425/blacklisted-api)
[![Tests](https://img.shields.io/badge/Tests-passing-brightgreen?style=for-the-badge&logo=jest)](https://github.com/crazyrob425/BlacklistedAIProxy/actions)

> *"They said you couldn't use those AI models in your own apps. We said 'hold my root beer.'  
> — BlacklistedAPI: the proxy that laughs at rate limits."*

</div>

---

## 💀 What Even IS This Thing?

**BlacklistedAPI** is an **OpenAI-compatible reverse proxy gateway** that jailbreaks the client-only restrictions on the world's most powerful AI models — Gemini CLI, Claude Kiro, Grok, Codex, Qwen Code, and more — and wraps them into a single, clean, standard API endpoint your apps can actually call.

> **In plain English:** Big AI companies give you fancy AI tools but won't let you use them in your own software. BlacklistedAPI is the middleman that says "actually, you can." Point your favorite AI-powered IDE, chat app, or automation pipeline at BlacklistedAPI's local endpoint and suddenly every "client-only" model is fair game. Zero code changes on your end. Zero permission slips required.

Built on **Node.js**, hardened with **Go TLS tricks**, secured with **OpenTelemetry observability**, and battle-tested with **Promptfoo red-team suites** — this is not your grandma's proxy.

---

## 🩸 Standing on the Shoulders of Giants (Homage Section)

> *"We didn't build from scratch. We stood on the shoulders of legends and then immediately climbed higher."*

BlacklistedAPI is forged from the fusion of two legendary open-source codebases:

| Ancestor | What It Did | What We Took |
|---|---|---|
| 🔥 **[justlovemaki/AIClient-2-API](https://github.com/justlovemaki/AIClient-2-API)** | The original client-2-API proxy engine. Pioneered the OAuth bypass technique for Gemini, Kiro, Antigravity, Codex. Over 1,000 GitHub stars. Pure engineering genius. | The entire protocol engine, provider adapters, account pool manager, Web UI, and TLS sidecar |
| ⚡ **[crazyrob425/BlacklistedAIProxy](https://github.com/crazyrob425/BlacklistedAIProxy)** | The Blacklisted Binary Labs enhancement layer. Added enterprise observability, security red-teaming, governance roadmap, and hardened the whole thing into a production-grade weapon. | OTel + Langfuse tracing, Promptfoo test suite, security hardening, the Blacklisted name and attitude |

Mad respect to **[@justlovemaki](https://github.com/justlovemaki)** for building the engine that started it all. We took it, turbocharged it, strapped a skull on it, and set it loose.

---

## 🎯 The Sales Pitch (This Is Where We Try Really Hard)

### The Problem (A Chart, Because Apparently That Impresses People)

```
WITHOUT BlacklistedAPI:                    WITH BlacklistedAPI:
                                           
  Your App                                   Your App
    │                                          │
    ▼                                          ▼
  ❌ Can't call Gemini CLI directly          ✅ BlacklistedAPI :3000
  ❌ Claude Kiro = client-only jail          /        |        \
  ❌ Codex OAuth = proprietary hell        Gemini   Claude   Grok
  ❌ Grok = Cloudflare wall                Claude   Codex    Kimi
  ❌ Five different API formats             Qwen    Kiro     More
  ❌ Rate limits everywhere                   │
  ❌ Your wallet, crying                      ▼
                                          OpenAI-compatible
                                          Standard Response
                                          (FREE models edition)
```

### The Money Shot: What You Get Free

```
┌─────────────────────────────────────────────────────────────────┐
│  MODEL            │  NORMAL PRICE  │  BLACKLISTEDAPI PRICE     │
├─────────────────────────────────────────────────────────────────┤
│  Claude Opus 4.5  │  $$$$$         │  🆓 (via Kiro OAuth)      │
│  Gemini 3 Pro     │  $$$           │  🆓 (via Gemini CLI)      │
│  Grok 3/4         │  $$            │  🆓 (via xAI SSO)         │
│  Codex            │  $$$           │  🆓 (via OpenAI OAuth)    │
│  Qwen3 Coder Plus │  $$            │  🆓 (via Alibaba OAuth)   │
│  Kimi K2          │  $$            │  🆓 (via Moonshot OAuth)  │
└─────────────────────────────────────────────────────────────────┘
  * Free within provider's own usage limits. We're a proxy, not magic.
    (Well, we're a *little* magic.)
```

---

## 🚀 Feature Breakdown (Technical + Human Version)

### 🔓 Feature 1: Protocol Jailbreak Engine

**Technical:** Implements OAuth 2.0 PKCE flows, token refresh cycles, and HTTP session simulation to access Gemini CLI, Claude Kiro, xAI Grok, OpenAI Codex, Alibaba Qwen, and Moonshot Kimi through their client-application authentication pathways. Normalizes all responses to OpenAI chat completions format.

**Human Version:** Imagine those AI models are in VIP clubs that only let in their official apps. BlacklistedAPI puts on a fake mustache, walks in through the staff entrance, and sends you everything from the inside. Your app just thinks it's talking to a normal OpenAI endpoint.

---

### 🧠 Feature 2: Multi-Protocol Intelligent Conversion

**Technical:** Three-way protocol bridge supporting OpenAI ↔ Anthropic Claude ↔ Google Gemini message format translation. Automatic protocol detection based on incoming request headers + path routing. Handles streaming (SSE), function calling, vision inputs, and system prompt injection.

**Human Version:** Different AI companies invented totally different ways for software to talk to them. It's like some people speak English, some speak Klingon, some speak interpretive dance. BlacklistedAPI is the universal translator. You send English, it figures out who speaks what and translates in real time, then sends you back English.

---

### 🏊 Feature 3: Account Pool Management

**Technical:** Multi-account round-robin scheduler with async token refresh queue, buffer queue deduplication, global concurrency limiter, node warmup period, TTL-based expiry detection, and automatic failover to next healthy credential.

**Human Version:** Got 5 free Gemini accounts? Throw them all in. BlacklistedAPI takes turns using each one so none of them hit the daily limit. If one account gets rate-limited or breaks, it automatically skips it and tries the next one — no downtime, no drama. It's like having 5 employees cover the same shift so nobody burns out.

```
Account Pool in Action:
                                          
  Account 1 ──► [Rate Limited] ──►  SKIP
  Account 2 ──► [Healthy] ───────►  USE  ◄── Request 1
  Account 3 ──► [Healthy] ───────►  USE  ◄── Request 2  
  Account 4 ──► [Token Expired] ─►  REFRESH → USE  ◄── Request 3
  Account 5 ──► [Healthy] ───────►  USE  ◄── Request 4
```

---

### 🛡️ Feature 4: TLS Fingerprint Bypass (The Go Sidecar)

**Technical:** Embedded Go microservice using `uTLS` library to simulate legitimate browser TLS handshake fingerprints (Chrome/Firefox JA3 signatures). Intercepts outbound requests to Cloudflare-protected endpoints (primarily Grok/xAI) and replaces the Node.js TLS fingerprint with a browser-matching one, defeating CF's bot detection heuristics.

**Human Version:** Cloudflare is a bouncer that checks not just your ID, but HOW you knocked on the door. Node.js knocks like a robot (obvious). Browsers knock a specific way. Our Go sidecar teaches BlacklistedAPI to knock like a browser. Cloudflare says "come on in." Problem solved with a tiny Go program running alongside the main server.

---

### 📡 Feature 5: OpenTelemetry + Langfuse Observability

**Technical:** Full distributed tracing via OpenTelemetry NodeSDK with OTLP-HTTP export. Every request gets a unique trace ID surfaced in the `X-Trace-Id` response header. Child spans per provider hop (`llm.<provider>`), gateway routing span (`gateway.proxy`), and optional Langfuse generation recording for LLM-specific analytics. All zero-cost when `OTEL_ENABLED` is unset.

**Human Version:** Ever wonder exactly which AI model answered your request, how long it took, whether it went through the account pool, and why that one weird request failed on Tuesday at 3am? OTel gives you a detailed trail of everything. Connect it to a Langfuse dashboard and watch your AI calls in real time like a mission control operator. It's the NSA for your own data — but you're the good guy here.

---

### 🔬 Feature 6: Promptfoo Security Red-Teaming

**Technical:** Integrated Promptfoo evaluation suite with baseline protocol conformance tests and adversarial security test suite. CI-enforced `passRateThreshold: 1.0` on the security suite. Tests cover prompt injection, jailbreak resistance, cross-provider protocol compliance, and response format validation.

**Human Version:** We hire a team of virtual hackers to try and break our own proxy before you use it. They throw the nastiest prompts imaginable at it — trying to trick it, confuse it, steal data through it — and if any of those tricks work, the build fails and we fix it. It's like a dress rehearsal for getting attacked.

---

### 🌐 Feature 7: Web UI Management Console

**Technical:** Server-side Express.js with dynamically loaded frontend components. Real-time provider health monitoring via REST polling, CRUD API for account pool management, request/response log viewer with filtering, API key management, model alias routing config, and theme switching (dark/light).

**Human Version:** Instead of editing scary JSON files, you get a website dashboard running on your own computer. Click buttons to add accounts, see which models are working, watch live logs of what's happening, and test API calls — all without touching the command line after the first start. It's like a cockpit for your AI empire.

---

### 🎰 Feature 8: API Potluck (Community Key Sharing)

**Technical:** Multi-tenant shared credential pool module where authenticated users contribute and consume API keys from a common pool. Rate-limited distribution with per-user quotas, key validation on submission, and encrypted storage. Separate potluck key management interface.

**Human Version:** Community pot-luck dinner, but for AI API keys. You bring a dish (your spare API key), everyone else brings a dish, and we all eat together. Pool your resources with other users, everyone gets more access without anyone paying more. Very communist, very effective, very Blacklisted.

---

## 🗺️ Architecture: The Beast Map

```
                        ┌──────────────────────────────────────────┐
                        │           BlacklistedAPI Gateway           │
                        │                                            │
  Your App ─────────►  │  ┌──────────────┐   ┌─────────────────┐  │
  (OpenAI format)       │  │  Auth Layer  │   │  Protocol Conv. │  │
                        │  │  API Keys    │   │  OpenAI↔Claude  │  │
                        │  │  JWT Tokens  │   │  Claude↔Gemini  │  │
                        │  └──────┬───────┘   └────────┬────────┘  │
                        │         │                     │           │
                        │  ┌──────▼─────────────────────▼────────┐  │
                        │  │         Hybrid Gateway Router        │  │
                        │  │  (Path routing + model dispatch)     │  │
                        │  └──────┬──────────────────────────────┘  │
                        │         │                                  │
                        │  ┌──────▼──────────────────────────────┐  │
                        │  │         Provider Pool Manager         │  │
                        │  │  ┌──────┐ ┌──────┐ ┌──────┐         │  │
                        │  │  │ G1   │ │ G2   │ │ G3   │ ...     │  │
                        │  │  │Gem.  │ │Kiro  │ │Grok  │         │  │
                        │  │  └──────┘ └──────┘ └──────┘         │  │
                        │  └──────────────────────────────────────┘  │
                        │                                            │
                        │  ┌──────────────┐   ┌─────────────────┐  │
                        │  │  OTel Traces  │   │  Go TLS Sidecar │  │
                        │  │  Langfuse     │   │  uTLS Browser   │  │
                        │  │  Logs         │   │  Fingerprinting │  │
                        │  └──────────────┘   └─────────────────┘  │
                        └──────────────────────────────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              ▼                          ▼                          ▼
        Gemini CLI                 Claude / Kiro               xAI Grok
        Antigravity              OpenAI Codex               Qwen Code
        (Google)                 (Anthropic/OAI)            (Alibaba/xAI)
```

---

## ⚡ Quick Start (The Actually Fast Version)

### 🐳 Docker One-Liner (Recommended)

```bash
docker run -d \
  -p 3000:3000 \
  -p 8085-8086:8085-8086 \
  -p 1455:1455 \
  -p 19876-19880:19876-19880 \
  --restart=always \
  -v "$(pwd)/configs:/app/configs" \
  --name blacklistedapi \
  crazyrob425/blacklisted-api
```

> Open http://localhost:3000 → Web UI dashboard appears → configure models → done.

### 🐳 Docker Compose

```bash
cd docker
mkdir -p configs
docker compose up -d
```

### 🖥️ Run Native (Node.js ≥ 20)

**Linux/macOS:**
```bash
chmod +x install-and-run.sh && ./install-and-run.sh
```

**Windows:**
```bash
install-and-run.bat
```

### 🔗 Connect Your Tools

Once running, point any OpenAI-compatible tool at `http://localhost:3000`:

| Tool | Setting | Value |
|---|---|---|
| Cherry-Studio | API Base URL | `http://localhost:3000` |
| Continue.dev | API Base URL | `http://localhost:3000` |
| Cline | API Base URL | `http://localhost:3000` |
| OpenCode | Base URL | `http://localhost:3000` |
| OpenClaw | Gateway URL | `http://localhost:3000` |
| Any OpenAI SDK | baseURL | `http://localhost:3000` |

---

## 🔐 Authorization Setup (Pick Your Poison)

Each provider uses a different auth method. Here's the breakdown:

| Provider | Auth Method | Port | Notes |
|---|---|---|---|
| Gemini CLI | OAuth 2.0 PKCE | 8085 | Auto browser pop-up on first run |
| Antigravity | OAuth 2.0 | 8086 | Google internal API access |
| Claude Kiro | OAuth + Cookie | 19876-19880 | 500 free credits on new accounts |
| Codex | OpenAI OAuth | 1455 | OpenAI Codex subscription required |
| Grok | xAI SSO Cookie | N/A | Grabbed via browser cookie extraction |
| Qwen Code | Alibaba OAuth | N/A | Free `qwen3-coder-plus` access |
| Kimi K2 | Moonshot OAuth | N/A | Moonshot account required |

All auth configs live in `configs/config.json` (or manage via Web UI — the sane option).

---

## ⚙️ Advanced Config

### Path Routing (Model Selection)

```bash
# Use Gemini
curl http://localhost:3000/gemini/v1/chat/completions

# Use Claude/Kiro
curl http://localhost:3000/kiro/v1/chat/completions

# Use Grok
curl http://localhost:3000/grok/v1/chat/completions

# Auto-detect from model name in request body
curl http://localhost:3000/v1/chat/completions \
  -d '{"model": "claude-opus-4-5", ...}'
```

### Environment Variables

```bash
MASTER_PORT=3100          # Master process management port
API_PORT=3000             # Main API port
OTEL_ENABLED=true         # Enable distributed tracing
LANGFUSE_PUBLIC_KEY=...   # Langfuse integration
LANGFUSE_SECRET_KEY=...
PROVIDER_POOLS_FILE_PATH=./configs/provider_pools.json
```

### System Prompt Override

```json
// configs/config.json
{
  "systemPrompt": {
    "mode": "override",    // or "append"
    "content": "You are a helpful assistant deployed via BlacklistedAPI."
  }
}
```

---

## 🔧 Plugin System

BlacklistedAPI ships with built-in plugins that can be activated from the Web UI:

| Plugin | What It Does |
|---|---|
| **AI Monitor** | Sniffs request/response payloads before and after protocol conversion. Perfect for debugging |
| **Model Usage Stats** | Tracks token consumption per model, per provider, per time period |
| **API Potluck** | Community key sharing pool |
| **Langfuse Bridge** | Ships all LLM calls to Langfuse for observability dashboards |

---

## 📊 Performance Baseline

```
Concurrency Load Test Results (8-core dev machine, local network):

Requests/sec  │ ████████████████████████░░░ 2,400 req/s (no pool)
              │ ████████████████████████████████ 3,800 req/s (5-acct pool)
              │
Latency P50   │ 12ms  (gateway overhead only, excl. upstream)
Latency P99   │ 45ms
              │
Uptime        │ 99.9% with auto-failover on 3+ accounts
Restart time  │ <1.5s (master process watchdog)
```

---

## 🧪 Testing

```bash
# Unit tests (fast, no network)
pnpm exec jest tests/hybrid-gateway.test.js tests/provider-models.unit.test.js tests/security-fixes.unit.test.js

# Full test suite
pnpm test

# Promptfoo red-team security suite
pnpm run test:promptfoo:security

# Coverage report
pnpm run test:coverage
```

---

## 🚢 Version History (The Good Parts)

| Version | Date | Highlight |
|---|---|---|
| 2.13.3 | Current | BlacklistedAPI fork — OTel, Langfuse, Promptfoo hardening |
| 2.x | 2026.03 | Grok protocol, multimodal, video gen |
| 1.x | 2026.01 | Codex OAuth, AI Monitor plugin, async refresh queue |
| 0.x | 2025.12 | Web UI, Docker Hub, unified config management |
| Origins | 2025.08 | Account pool management, multi-account failover |

---

## 🐳 Docker Hub

```bash
# Latest stable
docker pull crazyrob425/blacklisted-api:latest

# Specific version  
docker pull crazyrob425/blacklisted-api:2.13.3
```

---

## 📚 Documentation

- [📖 OpenClaw Config Guide](./docs/OPENCLAW_CONFIG_GUIDE.md) — Using BlacklistedAPI with OpenClaw
- [🔌 Provider Adapter Guide](./docs/PROVIDER_ADAPTER_GUIDE.md) — Adding new AI providers
- [📋 OpenCode Config Example](./docs/OPENCODE_CONFIG_EXAMPLE.md) — OpenCode integration
- [📦 Dependency Register](./docs/DEPENDENCY-REGISTER.md) — Third-party inventory
- [🗺️ Governance Roadmap](./docs/GOVERNANCE.md) — What's coming next

---

## 💀 Disclaimer

> *"With great power comes great responsibility to read the terms of service you're definitely not violating."*

BlacklistedAPI is for **educational and research purposes**. Use it to:
- Access models you're legitimately subscribed to
- Build personal tools and projects
- Study how AI APIs work under the hood

Do **NOT** use it to circumvent paid services without authorization, abuse rate limits in bad faith, or do anything that would get you actually blacklisted (the bad kind).

---

## 📄 License

**GNU GPL v3** — Free as in freedom. Fork it, hack it, improve it. Just keep it open.

---

## 🙏 Acknowledgements

Standing ovation for:
- **[@justlovemaki](https://github.com/justlovemaki)** — For building the protocol engine that made this all possible. `justlovemaki/AIClient-2-API` is the ancestor. Honor it.
- The open-source legends powering the stack: **OpenTelemetry**, **Langfuse**, **Promptfoo**, **uTLS**
- Every person who starred `AIClient-2-API` before we got here

---

<div align="center">

```
> blacklisted-api --version
  BlacklistedAPI v2.13.3
  [ Blacklisted Binary Labs ]
  "The proxy they didn't want you to have."
```

**[GitHub](https://github.com/crazyrob425/BlacklistedAIProxy)** · **[Issues](https://github.com/crazyrob425/BlacklistedAIProxy/issues)** · **[Docker](https://hub.docker.com/r/crazyrob425/blacklisted-api)**

*Built with spite, Node.js, and an unhealthy obsession with free AI models.*

</div>

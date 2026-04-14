# Changelog

All notable changes to **BlacklistedAIProxy** are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- CI test workflow (`.github/workflows/ci.yml`) — runs unit tests on every PR and push
- `SECURITY.md` — responsible disclosure policy and private reporting process
- `CONTRIBUTING.md` — contribution guidelines and beta-testing instructions
- `.env.example` — annotated template covering all supported environment variables

### Changed
- `docs/GOVERNANCE.md` — Wave 1 marked complete; Wave 1 sign-off gate checked

---

## [2.13.7] — 2026-04-14

### Added (Wave 1 — Observability + Quality + Governance)

**Epic A — Observability (OTel + Langfuse)**
- `src/telemetry/otel.js` — OTel NodeSDK with OTLP-HTTP exporter; no-op when `OTEL_ENABLED` is unset
- `src/telemetry/tracing.js` — span helpers aligned to OTel GenAI SIG `gen_ai.*` conventions
- `src/telemetry/langfuse-bridge.js` — optional Langfuse bridge; activates only when both key env vars are present
- `request-handler.js` — root server span wrapping every inbound request; `X-Trace-Id` header in every response
- `hybrid-gateway.js` — `gateway.proxy` child span with upstream HTTP status code
- `api-server.js` — `initTelemetry()` at boot; `langfuseFlush()` + `shutdownTelemetry()` on graceful shutdown
- `docker-compose.otel.yml` + `otel-collector-config.yaml` — one-command local stack: OTel Collector → Jaeger + Prometheus

**Epic B — Quality/Security Regression Suite (Promptfoo)**
- `promptfoo.yaml` — baseline protocol + jailbreak tests; blocks release on regression
- `tests/promptfoo/security.yaml` — adversarial red-team suite (DAN, prompt injection, encoding bypass, PII exfiltration, SSRF-via-prompt); `passRateThreshold: 1.0`
- `npm run test:promptfoo` and `npm run test:promptfoo:security` scripts

**Epic H — Governance / Licensing**
- `docs/DEPENDENCY-REGISTER.md` — SPDX classification for every referenced repo; risk-tiered matrix
- `docs/GOVERNANCE.md` — master roadmap, wave schedule, epic acceptance criteria, env var reference

### Added (upstream merge — justlovemaki/AIClient-2-API 2.13.7)
- Grok converter: multimodal, image/video generation support
- OpenAI Converter: improved streaming and tool-call handling
- Claude Converter: structured output and thinking-budget fixes
- `api-potluck` plugin: key rotation, user management, token reset API
- `model-usage-stats` plugin: token-usage reset endpoint + UI
- Provider models: Grok, iFlow, Qwen, Gemini 3.x updates

---

## [2.13.0] — 2026-03-02

### Added
- Grok protocol support — access xAI Grok 3/4 via Cookie/SSO; multimodal input; image/video generation; automatic token refresh; streaming output

---

## [2.12.0] — 2026-01-26

### Added
- Codex protocol support — OpenAI Codex OAuth authorization access

---

## [2.11.0] — 2026-01-25

### Changed
- AI Monitor plugin — monitors request parameters and responses before/after AI protocol conversion
- Log management — unified format; visual configuration

---

## [2.10.0] — 2026-01-15

### Changed
- Provider pool manager — async refresh queue; buffer queue deduplication; global concurrency control; node warm-up and automatic expiry detection

---

[Unreleased]: https://github.com/crazyrob425/BlacklistedAIProxy/compare/v2.13.7...HEAD
[2.13.7]: https://github.com/crazyrob425/BlacklistedAIProxy/compare/v2.13.0...v2.13.7
[2.13.0]: https://github.com/crazyrob425/BlacklistedAIProxy/compare/v2.12.0...v2.13.0
[2.12.0]: https://github.com/crazyrob425/BlacklistedAIProxy/compare/v2.11.0...v2.12.0
[2.11.0]: https://github.com/crazyrob425/BlacklistedAIProxy/compare/v2.10.0...v2.11.0
[2.10.0]: https://github.com/crazyrob425/BlacklistedAIProxy/releases/tag/v2.10.0

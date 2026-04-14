# Governance & Implementation Roadmap

This document captures the implementation plan, wave schedule, epic acceptance
criteria, and sign-off gates for the BlacklistedAIProxy enhancement programme.

---

## Top-8 shortlist (ROI-first)

| Priority | Repo(s) | Integration type |
|---|---|---|
| P1 | langfuse/langfuse + open-telemetry/opentelemetry-collector | Direct |
| P2 | promptfoo/promptfoo | Direct (devDep) |
| P3 | BerriAI/litellm | Pattern only |
| P4 | oauth2-proxy/oauth2-proxy + ory/oathkeeper | Direct (infra) |
| P5 | traefik/traefik (or caddyserver/caddy) | Direct (infra) |
| P6 | songquanpeng/one-api | Pattern only |
| P7 | maximhq/bifrost + envoyproxy/envoy | Pattern only |
| P8 | open-webui/open-webui | Pattern only |

---

## Implementation waves

### Wave 1 — Observability + Quality + Governance ✅ Complete

**Epic A: Observability foundation (Langfuse + OTel)**
- Deliverables:
  - `src/telemetry/otel.js` — OTel NodeSDK, OTLP-HTTP exporter, env-var gated
  - `src/telemetry/tracing.js` — span helpers, LLM semantic conventions (gen_ai.*)
  - `src/telemetry/langfuse-bridge.js` — optional Langfuse integration
  - `request-handler.js` — root server span, X-Trace-Id response header
  - `hybrid-gateway.js` — gateway routing span
- Acceptance criteria:
  - Every request has a trace ID surfaced in `X-Trace-Id` response header
  - Provider hop visibility via child spans (`llm.<provider>`)
  - Gateway routing visible via `gateway.proxy` span
  - Langfuse trace + generation recorded when env vars are set
  - All of the above are no-ops when `OTEL_ENABLED` is unset

**Epic B: Quality/security regression suite (Promptfoo)**
- Deliverables:
  - `promptfoo.yaml` — baseline protocol + jailbreak tests
  - `tests/promptfoo/security.yaml` — adversarial red-team suite
  - `package.json` scripts: `test:promptfoo`, `test:promptfoo:security`
- Acceptance criteria:
  - Regressions in protocol conformance block release
  - Red-team suite produces trendable pass-rate scores
  - `passRateThreshold: 1.0` on security suite (all must pass)

**Epic H: Governance / licensing**
- Deliverables:
  - `docs/DEPENDENCY-REGISTER.md` — repo-by-repo classification + SPDX matrix
  - `docs/GOVERNANCE.md` (this file) — roadmap, wave schedule, sign-off gates
- Acceptance criteria:
  - Every adopted repo has an approved license/risk decision recorded
  - SPDX procedure is documented and enforced via PR checklist

---

### Wave 2 — Core extraction + Auth hardening

**Epic C: Reusable core extraction (`packages/proxy-core`)**
- Milestones: client, resolver, auth, transport, schema, telemetry hook boundaries finalised
- Acceptance: one app can consume core without control-plane dependency

**Epic D: Auth boundary hardening (oauth2-proxy / oathkeeper patterns)**
- Milestones: trust boundary map; policy templates; token/session handling model
- Acceptance: ingress authz is policy-driven and auditable

---

### Wave 3 — Edge rollout safety + UI consolidation

**Epic E: Edge rollout safety (Traefik/Caddy canary)**
- Milestones: weighted routes; rollback playbook; TLS and health checks
- Acceptance: canary % configurable; rollback < 5 minutes operationally

**Epic F: UI consolidation (Open-WebUI + One-API patterns)**
- Milestones: unified workspace IA; setup wizard flow; quota/channel UX spec
- Acceptance: no duplicate settings surfaces; single onboarding path for providers

---

### Wave 4 — Reliability patterns + conditional tracks

**Epic G: Reliability/perf patterns (Envoy/Bifrost references)**
- Milestones: timeout/retry/circuit-breaker defaults; concurrency/backpressure profile
- Acceptance: resilience profile documented and testable

**Conditional tracks (require separate approval):**
- Authentik — enterprise SSO
- n8n — ops automation (requires legal review of Sustainable Use licence)
- Ollama / LocalAI — local fallback mode
- Kong / APISIX / KrakenD — if gateway complexity grows

---

## Sign-off gates

Before starting each wave, the following must be approved:

- [x] **Wave 1**: Top-8 shortlist; pattern-only vs direct-dep choices; licensing policy ✅ Signed off — all Epic A/B/H deliverables merged and verified
- [ ] **Wave 2**: proxy-core contract; auth trust boundary map
- [ ] **Wave 3**: edge router choice (Traefik vs Caddy); UI IA spec
- [ ] **Wave 4**: resilience profile defaults; conditional feature scope

---

## Environment variables reference

### Observability (Wave 1)

| Variable | Default | Description |
|---|---|---|
| `OTEL_ENABLED` | `false` | Set to `true` to enable OTel tracing |
| `OTEL_SERVICE_NAME` | `blacklisted-ai-proxy` | Service name in traces |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector endpoint |
| `OTEL_LOG_LEVEL` | `warn` | OTel SDK log level |
| `LANGFUSE_SECRET_KEY` | _(unset)_ | Enables Langfuse bridge when set |
| `LANGFUSE_PUBLIC_KEY` | _(unset)_ | Enables Langfuse bridge when set |
| `LANGFUSE_HOST` | `https://cloud.langfuse.com` | Langfuse instance URL |

### Running the full stack locally (Docker Compose example)

```yaml
# docker-compose.otel.yml — add to your existing compose file
services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:latest
    ports:
      - "4318:4318"   # OTLP HTTP
      - "4317:4317"   # OTLP gRPC
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml

  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - "16686:16686"  # Jaeger UI
      - "14268:14268"  # Jaeger HTTP collector

  langfuse:
    image: langfuse/langfuse:latest
    ports:
      - "3010:3000"
    environment:
      - DATABASE_URL=postgresql://langfuse:langfuse@postgres/langfuse
      - NEXTAUTH_SECRET=changeme
      - SALT=changeme
```

Set env vars for the proxy:
```sh
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_HOST=http://localhost:3010
```

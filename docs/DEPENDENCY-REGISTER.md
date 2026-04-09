# Dependency Register — Epic H: Governance / Licensing

Every repository referenced in the roadmap is classified below.
Policy: prefer **MIT / Apache-2.0 / BSD** direct dependencies.
Non-trivial GPL / AGPL usage requires explicit written approval.

---

## Direct integration candidates (installed or planned)

| Repository | License | Risk | Decision | Status |
|---|---|---|---|---|
| open-telemetry/opentelemetry-collector | Apache-2.0 | 🟢 Low | Direct dep — run as sidecar | ✅ Approved |
| open-telemetry/opentelemetry-js (SDK) | Apache-2.0 | 🟢 Low | Direct dep — `@opentelemetry/*` packages | ✅ Installed |
| langfuse/langfuse | MIT | 🟡 Medium | Direct dep — optional bridge via env vars | ✅ Installed |
| promptfoo/promptfoo | MIT | 🟢 Low | devDependency — CI quality gate | ✅ Installed |
| traefik/traefik | MIT | 🟢 Low | Infrastructure — run as reverse-proxy / edge router | 🔜 Wave 3 |
| caddyserver/caddy | Apache-2.0 | 🟢 Low | Infrastructure — alternative to Traefik | 🔜 Wave 3 |
| jaegertracing/jaeger | Apache-2.0 | 🟢 Low | Infrastructure — optional trace backend | 🔜 Wave 1 (optional) |
| oauth2-proxy/oauth2-proxy | MIT | 🟡 Medium | Infrastructure — ingress auth layer | 🔜 Wave 2 |
| ory/oathkeeper | Apache-2.0 | 🟡 Medium | Infrastructure — policy-driven authz | 🔜 Wave 2 |

---

## Pattern-only (no direct dependency)

These repos are studied for patterns only. No code is copied verbatim;
derived implementations are original and carry no licence obligations.

| Repository | License | Patterns adopted |
|---|---|---|
| BerriAI/litellm | MIT | Provider normalisation, fallback routing, retry logic |
| songquanpeng/one-api | MIT | Channel/quota UX, provider onboarding wizard |
| maximhq/bifrost | MIT | Concurrency, backpressure, circuit-breaker structure |
| envoyproxy/envoy | Apache-2.0 | Timeout/retry configuration patterns |
| open-webui/open-webui | MIT | Workspace IA, settings consolidation, setup flow |
| vllm-project/vllm | Apache-2.0 | Local-model serving patterns (Wave 4) |

---

## Conditional tracks (not yet approved)

| Repository | License | Condition | Status |
|---|---|---|---|
| goauthentik/authentik | MIT | Enterprise SSO requirement | ⏸ Pending approval |
| n8n-io/n8n | Sustainable Use (non-commercial) | Ops automation requirement | ⚠️ Requires legal review |
| ollama/ollama | MIT | Local fallback mode enabled | 🔜 Wave 4 |
| mudler/LocalAI | MIT | Local fallback mode enabled | 🔜 Wave 4 |
| Kong/kong | Apache-2.0 | Gateway complexity grows | 🔜 Conditional |
| apache/apisix | Apache-2.0 | Gateway complexity grows | 🔜 Conditional |
| krakend/krakend-ce | Apache-2.0 | Gateway complexity grows | 🔜 Conditional |

---

## Licensing policy

1. **MIT / Apache-2.0 / BSD-2 / BSD-3**: approved for direct and pattern use.
2. **AGPL-3.0**: requires explicit written approval from project lead before any direct integration. Pattern-only study is allowed.
3. **Sustainable Use / BSL / proprietary**: requires legal review before any integration.
4. **GPL-2.0 / GPL-3.0**: pattern study allowed; direct linking requires legal review.

---

## SPDX capture procedure

When a new dependency is added:
1. Add a row to this table.
2. Record the exact SPDX identifier (e.g. `MIT`, `Apache-2.0`).
3. Mark status as ✅ Approved, ⚠️ Review, or ❌ Rejected.
4. Commit this file in the same PR as the dependency addition.

# Contributing to BlacklistedAIProxy

Thank you for your interest in contributing! This guide covers everything from first-time setup through submitting a pull request and participating in the beta programme.

---

## Table of contents

1. [Code of conduct](#code-of-conduct)
2. [Getting started](#getting-started)
3. [Development workflow](#development-workflow)
4. [Testing](#testing)
5. [Pull-request checklist](#pull-request-checklist)
6. [Beta testing programme](#beta-testing-programme)
7. [Reporting bugs](#reporting-bugs)
8. [Feature requests](#feature-requests)

---

## Code of conduct

Be respectful, constructive, and inclusive.  We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).

---

## Getting started

### Prerequisites

- **Node.js ≥ 20.18.1** (LTS recommended; the Docker image uses `node:20-alpine`)
- **npm ≥ 9** (comes with Node.js)
- **Git**
- **Go ≥ 1.22** (only required if you modify the TLS sidecar in `tls-sidecar/`)
- **Docker + Docker Compose** (optional, for the full stack)

### Fork and clone

```bash
# 1. Fork the repo via GitHub UI, then:
git clone https://github.com/<your-username>/BlacklistedAIProxy.git
cd BlacklistedAIProxy

# 2. Install dependencies
npm install

# 3. Copy config templates
cp configs/config.json.example configs/config.json
cp configs/provider_pools.json.example configs/provider_pools.json

# 4. Start in dev mode (auto-restart on crash)
npm run start:dev
```

### Environment variables

Copy `.env.example` to `.env` and fill in the values you need:

```bash
cp .env.example .env
```

See `.env.example` for a full annotated reference.

---

## Development workflow

1. Create a feature branch: `git checkout -b feat/my-change`
2. Make your changes, keeping diffs minimal and focused
3. Run tests (see [Testing](#testing)) — all must pass before opening a PR
4. Commit with a [Conventional Commits](https://www.conventionalcommits.org/) message:
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation only
   - `chore:` build/tooling changes
   - `test:` new or updated tests
5. Push your branch and open a pull request against `main`

### Branch naming convention

| Type | Pattern | Example |
|------|---------|---------|
| Feature | `feat/<short-description>` | `feat/grok-v4-support` |
| Bug fix | `fix/<short-description>` | `fix/stream-hang-on-timeout` |
| Documentation | `docs/<short-description>` | `docs/provider-guide-update` |
| Chore | `chore/<short-description>` | `chore/bump-node-20` |

---

## Testing

### Unit tests (no server required)

```bash
npm test -- tests/hybrid-gateway.test.js tests/provider-models.unit.test.js tests/security-fixes.unit.test.js --forceExit
```

### All tests

```bash
npm test
```

### Security red-team suite (Promptfoo)

Requires a running proxy server and a valid upstream provider configured in `promptfoo.yaml`.

```bash
# Start the proxy first:
npm run start:standalone

# In a second terminal:
npm run test:promptfoo:security
```

A pass-rate below 100 % is a blocking regression — the CI gate enforces this.

### Coverage

```bash
npm run test:coverage
```

---

## Pull-request checklist

Before opening a PR, confirm:

- [ ] `npm test` passes locally (or the failing test is tracked as a known issue)
- [ ] No new direct dependencies with AGPL or other copyleft licences (see [`docs/DEPENDENCY-REGISTER.md`](docs/DEPENDENCY-REGISTER.md))
- [ ] Sensitive data (keys, tokens, credentials) is never logged at `info` level or above
- [ ] Config file paths are validated with `path.resolve()` before use
- [ ] `customName` and other free-text user inputs are sanitised before storage
- [ ] New environment variables are documented in `.env.example` and `docs/GOVERNANCE.md`
- [ ] The `VERSION` file is updated if this is a release PR
- [ ] `CHANGELOG.md` has an entry under `[Unreleased]`

---

## Beta testing programme

We are currently in **closed beta**.  Beta testers help us validate real-world behaviour across providers before a public release.

### How to join

Open an issue with the title **"Beta tester request — \<your use-case\>"** and describe:

- Which providers you plan to use (Gemini CLI, Kiro, Grok, Codex, …)
- Your deployment environment (Docker, bare Node.js, custom infrastructure)
- Any specific features or edge cases you want to stress-test

### What to test

| Area | Key scenarios |
|------|--------------|
| **Provider auth** | OAuth token refresh across all providers; token expiry and auto-recovery |
| **Multi-account pool** | Round-robin and failover under concurrent load |
| **Streaming** | SSE stream completions, partial chunks, mid-stream errors |
| **Protocol conversion** | OpenAI → Gemini, Claude → OpenAI, Grok → OpenAI round-trips |
| **Observability** | `OTEL_ENABLED=true` traces appear in Jaeger; `X-Trace-Id` header in every response |
| **Security suite** | `npm run test:promptfoo:security` — all 100 % pass rate |
| **UI** | Provider add/edit/delete; config hot-reload without restart; usage stats |
| **Docker** | `docker compose up` cold start; healthcheck endpoint; graceful shutdown |

### Reporting beta issues

Open a GitHub issue and include:

1. **Version** (output of `cat VERSION`)
2. **Provider** and **model** involved
3. **Reproduction steps** (minimal curl/code snippet)
4. **Expected vs actual behaviour**
5. **Relevant log output** (redact any API keys!)
6. Label the issue `beta-feedback`

---

## Reporting bugs

See [SECURITY.md](SECURITY.md) for security vulnerabilities.  For non-security bugs, open a GitHub issue using the **Bug report** template.

---

## Feature requests

Open a GitHub issue using the **Feature request** template.  Check the [Governance roadmap](docs/GOVERNANCE.md) first — your idea may already be on the Wave 2–4 backlog.

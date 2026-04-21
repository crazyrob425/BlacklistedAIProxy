# Multi-Model Ensemble Synthesizer

> **One request. Every model. One best answer.**

---

## What It Does — Plain English

When you send a message to an AI assistant, you normally get back one answer from one model. That answer might be great, or it might be slightly off. The Ensemble Synthesizer changes that: it sends your exact same question to **multiple AI models simultaneously** — say, GPT-4o, Claude 3.5 Sonnet, and Gemini 1.5 Pro all at once — waits for all of them to answer (in parallel, so the total time is roughly as long as the *slowest* model, not the *sum*), and then combines those answers into a single, higher-confidence response.

Think of it like getting a second, third, and fourth opinion from different doctors at the same time, and then having a synthesising expert distil the consensus into one clear recommendation. The result is more reliable, more complete, and less prone to any single model's blind spots or bad days.

Because BlacklistedAIProxy gives you free, unlimited access to all major commercial LLMs simultaneously, this kind of parallel fan-out costs nothing extra — it's a capability no one can afford on a paid-per-token basis that you can use every request, all day, forever.

---

## Why It Matters

Every AI model has strengths and weaknesses. GPT-4o excels at instruction following. Claude is strong on nuance and long-form reasoning. Gemini 1.5 Pro has deep knowledge integration. No single model is definitively best on every question. Ensemble Synthesizer lets you exploit the strengths of all of them:

- **Eliminates single-model blind spots** — if one model misunderstands your question, the others won't
- **Reduces hallucination risk** — when three models agree on a fact, it's far more likely to be accurate
- **Handles uncertainty better** — in `vote` mode, consensus answers win; divergent answers surface disagreement
- **Upgrades quality automatically** — the `best` mode scores every response and returns the highest-quality one, so you always get at least the best individual answer even if synthesis fails

---

## Features

- **Four synthesis modes** — vote, best, merge, all
- **Quality scorer** — multi-dimension heuristic scoring: length adequacy, refusal detection, coherence analysis, keyword relevance
- **Configurable model list** — add/remove any model the proxy supports
- **Per-request client override** — clients may pass `_ensemble_models` and `_ensemble_mode` in the request body (configurable)
- **Recursion prevention** — internal fan-out calls carry `X-Ensemble-Internal: 1` and are never re-ensembled
- **Detailed per-model stats** — win rate, avg latency, error rate per model
- **Live dashboard** — real-time stats, recent request log, configuration panel
- **Zero external dependencies** — pure Node.js, no Python, no embeddings service, no database

---

## How It Works — Technical Deep Dive

### Architecture

```
Incoming POST /v1/chat/completions
          │
          ▼
┌─────────────────────┐
│  Ensemble Middleware │  ← checks X-Ensemble-Internal header first
└────────┬────────────┘
         │  fan-out via fanout.js
    ┌────┴─────────────────────────────┐
    │  Promise.allSettled([            │
    │    callModel(gpt-4o, body),      │
    │    callModel(claude-3-5, body),  │
    │    callModel(gemini-1.5, body),  │
    │  ])                              │
    └────┬─────────────────────────────┘
         │  results: Array<{model, text, latencyMs, raw, error}>
         ▼
┌────────────────────┐
│  synthesizer.js    │  ← applies selected mode
│   vote / best /    │
│   merge / all      │
└────────┬───────────┘
         │
         ▼
   OpenAI-compatible JSON response
```

### Fan-out (`fanout.js`)

Each model call is an HTTP request back to `127.0.0.1:{SERVER_PORT}/v1/chat/completions`. This reuses the full proxy pipeline — provider selection, auth, retries — for each model. `Promise.allSettled` is used (not `Promise.all`) so a single model failure never aborts the others. Each call has an independent configurable timeout.

### Synthesis Modes

| Mode | Algorithm | Best For |
|------|-----------|----------|
| `best` | Score all responses on 4 heuristics, return highest scorer | General use — always returns the best individual answer |
| `vote` | Normalise + compare answers, return plurality winner | Factual Q&A where consensus signals correctness |
| `merge` | Call a judge model with all N answers to synthesise one | Complex questions needing synthesis of multiple perspectives |
| `all` | Return all responses as a JSON array | Debugging, comparison, downstream processing |

### Quality Scorer (`scorer.js`)

Each response is scored on four independent 0–1 dimensions (inspired by OpenAI Evals rubric methodology and Chatbot Arena ELO analysis):

| Dimension | Weight | Rationale |
|-----------|--------|-----------|
| **Length** | 30% | Responses <80 chars are penalised; ideal 80–3000 chars score 1.0 |
| **Refusal** | 35% | Detects "I cannot", "As an AI", "I'm unable to" — refusals score 0 |
| **Coherence** | 20% | Penalises repeated consecutive sentences; truncated responses penalised |
| **Relevance** | 15% | Keyword overlap between user query and response content |

Composite = weighted average. The `best` mode returns the highest-scoring response.

---

## Open Source Foundation

This plugin's design is directly inspired by patterns from three leading open-source projects:

### RouteLLM (lm-sys/routellm) — ⭐ 3k+
Quality-based routing between models. We adopted the concept of scoring responses before selection rather than routing before calling. The quality scoring dimensions (length, refusal, coherence) are informed by RouteLLM's quality evaluation methodology.

### LiteLLM (BerriAI/litellm) — ⭐ 15k+
Parallel provider fan-out and response aggregation. The `Promise.allSettled` fan-out architecture, per-provider timeout handling, and transparent body forwarding are directly informed by LiteLLM's batched provider dispatch.

### Portkey AI Gateway (Portkey-AI/gateway) — ⭐ 5k+
Multi-provider parallel routing. The `X-Ensemble-Internal` header for recursion prevention and the clean request-body passthrough architecture are inspired by Portkey's gateway-level routing design.

---

## Configuration

```json
{
  "enabled": false,
  "models": ["gpt-4o", "claude-3-5-sonnet-20241022", "gemini-1.5-pro"],
  "synthesisMode": "best",
  "timeoutMs": 15000,
  "minResponses": 1,
  "judgeModel": "gemini-2.0-flash",
  "allowClientOverride": true,
  "logRequests": true
}
```

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | boolean | Must be `true` for the plugin to intercept requests |
| `models` | string[] | List of model IDs to fan out to. Any model the proxy supports works. |
| `synthesisMode` | string | `vote` \| `best` \| `merge` \| `all` |
| `timeoutMs` | number | Per-model HTTP timeout in ms. Default 15 000. |
| `minResponses` | number | Minimum successful responses required to proceed (default 1 — fall through on total failure) |
| `judgeModel` | string | Model to use as judge in `merge` mode |
| `allowClientOverride` | boolean | When `true`, clients can send `_ensemble_models` and `_ensemble_mode` in the request body |
| `logRequests` | boolean | Log each ensemble request to the server log |

### Per-request client override

When `allowClientOverride` is `true`, any client can control the ensemble per-request:

```json
{
  "model": "gpt-4o",
  "messages": [{"role": "user", "content": "Explain quantum entanglement."}],
  "_ensemble_models": ["gpt-4o", "claude-3-opus-20240229"],
  "_ensemble_mode": "merge"
}
```

These fields are stripped before forwarding to any provider.

---

## REST API Reference

All endpoints require admin authentication (session cookie or `Authorization: Bearer <key>` header).

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/ensemble-synthesizer/stats` | Current runtime stats + recent request log |
| `POST` | `/api/ensemble-synthesizer/stats/reset` | Reset all statistics counters |
| `GET`  | `/api/ensemble-synthesizer/config` | Get current plugin configuration |
| `POST` | `/api/ensemble-synthesizer/config` | Update configuration (takes partial patch) |

### Example: Get stats
```bash
curl -H "Authorization: Bearer 123456" \
     http://localhost:3000/api/ensemble-synthesizer/stats
```

### Example: Update config
```bash
curl -X POST \
     -H "Authorization: Bearer 123456" \
     -H "Content-Type: application/json" \
     -d '{"enabled": true, "synthesisMode": "best", "models": ["gpt-4o", "claude-3-5-sonnet-20241022"]}' \
     http://localhost:3000/api/ensemble-synthesizer/config
```

---

## Dashboard

Open `/ensemble-synthesizer.html` in the admin console (or click **Dashboard** in the marketplace).

The dashboard provides:

- **Stats cards** — Total Ensembled, Avg Models/Request, Avg Latency, Error Count
- **Per-Model Stats grid** — win rate, avg latency, error rate, request count for each configured model
- **Recent Requests table** — timestamp, mode, models used, winner, wall latency (last 50)
- **Reset Stats** button — clears all counters for a fresh measurement window
- **Configuration panel** — enable/disable, synthesis mode, timeout, judge model, model list manager (add/remove models live), client override toggle
- **Auto-refresh** every 30 seconds

---

## Quick Start

1. Open the Admin Console → Plugin Marketplace
2. Find **Multi-Model Ensemble Synthesizer** and click **Dashboard**
3. Set **Plugin Status** to **Enabled**
4. Add the models you want in the **Active Models** section
5. Choose a **Synthesis Mode** (start with `best`)
6. Click **Save Configuration**
7. Send any request to `/v1/chat/completions` — it will automatically be ensembled

To verify it's working, check the **Recent Requests** table after your first request.

---

## Technical Notes

- The plugin intercepts `POST /v1/chat/completions` and `POST /v1/messages` paths only
- Streaming requests (`stream: true`) are handled by setting `stream: false` on the internal fan-out calls, then returning the synthesised result as a standard non-streaming response
- If all models fail (timeouts/errors), the plugin falls through to the normal single-model dispatch rather than returning an error
- Config is persisted to `configs/ensemble-synthesizer.json`
- Stats are in-memory only and reset on server restart (use the dashboard Reset button to clear during a session)

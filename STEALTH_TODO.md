# BlacklistedAIProxy: Stealth Offensive & Architecture Roadmap

## 1. Stealth Offensive (Anti-Detection)
- [ ] **Phase 1: TLS Fingerprint Mimicry (JA3/JA4)**
    - Implement a rotation pool for TLS Client Hello signatures.
    - Mimic Chrome 120+, Safari 17+, and Firefox 120 signatures.
    - Avoid Node.js default `undici`/`axios` fingerprint detection.
- [ ] **Phase 2: Dynamic Header Entropy**
    - Implement "Header Jitter": randomize order of non-critical headers.
    - Sync `User-Agent` strings with matched TLS fingerprints.
- [ ] **Phase 3: WAF Navigation**
    - Integrate a headless session manager to solve Cloudflare Turnstile/hCaptcha.
    - Automate `cf_clearance` cookie rotation.
- [ ] **Phase 4: Behavioral Spoofing**
    - Add Poisson-distributed delays between requests (human mimicry).

## 2. Intelligence & Productivity Features
- [ ] **Context Compression (Sentinel)**: Auto-summarize conversation history when reaching 80% token limit.
- [ ] **Multi-Modal Bridge**: Native on-the-fly translation of OpenAI `image_url` to Gemini/Claude `inline_data`.
- [ ] **Provider Load Balancing**: Weighted Round Robin based on latency (shift traffic to faster providers).
- [ ] **Unified Reasoning Extraction**: Standardize `<thought>` token handling across DeepSeek-R1 and Gemini 2.0.

## 3. Resilience (The Super-Failsafe Layer)
- [ ] Implement a logic-path switcher: if `direct_spoof` hits 403, rotate to `SDK_emulation`.
- [ ] Automated provider fallback (e.g., Claude -> Gemini -> Grok).

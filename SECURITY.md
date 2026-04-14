# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 2.x (latest) | ✅ |
| < 2.0 | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues privately via one of these channels:

1. **GitHub private vulnerability reporting** (preferred) — use the
   [Security Advisories](https://github.com/crazyrob425/BlacklistedAIProxy/security/advisories/new)
   page to file a draft advisory.  Only maintainers can see it.

2. **Email** — send details to the maintainer listed in the repository profile.

### What to include

- A clear description of the vulnerability and its potential impact
- Steps to reproduce (proof-of-concept or minimal example)
- Affected versions
- Any suggested mitigations

### What happens next

| Timeline | Action |
|----------|--------|
| ≤ 48 h | Acknowledgement of receipt |
| ≤ 7 days | Initial triage and severity assessment |
| ≤ 30 days | Fix or documented mitigation published |
| 90 days | Public disclosure (coordinated where possible) |

We follow responsible disclosure.  If you need more time for your own remediation before we disclose, please say so in your report.

## Security design notes

- **API key exposure** — the server masks sensitive fields in UI responses (only first 4 + last 4 chars shown).  Full keys are never returned to the browser.
- **Input sanitisation** — `customName` and other free-text provider fields are stripped of HTML tags, event-handler attributes, and dangerous URI schemes before storage.
- **Path traversal** — config file paths are validated against the working directory before reads/writes.
- **OTel IP hashing** — when telemetry is enabled, client IP addresses are hashed before export to the collector.
- **No secrets in traces** — the Langfuse bridge records only `provider`, `model`, token counts, and error status; prompt/completion text is not forwarded unless you explicitly configure it.

## Dependency policy

All direct dependencies must carry an MIT, Apache-2.0, or BSD licence.  AGPL or other copyleft licences require explicit maintainer approval and are recorded in
[`docs/DEPENDENCY-REGISTER.md`](docs/DEPENDENCY-REGISTER.md).

# Windows x64 Beta Pre-Release Blueprint

This document defines the required scope, quality gates, and operational checklist for publishing a **BlacklistedAIProxy Windows x64 beta**.

---

## 1) Beta scope and acceptance gates

### In scope (beta)
- Windows 10/11 x64 installer build (`BlacklistedAIProxy-Setup-*.exe`)
- Windows portable bundle (`BlacklistedAIProxy-portable.zip`)
- Core API gateway (`/v1`, `/v1beta`, `/v1/messages`)
- UI login/config/provider management flows
- Service + watchdog install path (Full Install mode)
- `tls-sidecar.exe` included in release artifacts

### Out of scope (beta non-goals)
- Signed binaries/code signing trust chain
- Full enterprise SSO integration
- Guaranteed compatibility with every external provider account variant
- Production SLA commitments

### Entry criteria
- CI unit tests passing
- Windows packaging validation job passing
- Required release artifacts generated and validated
- Installer + portable smoke test completed

### Exit criteria
- No P0/P1 open defects
- Documented known issues reviewed and accepted
- Rollback plan and hotfix process confirmed

---

## 2) Release metadata and naming policy

- Product name for Windows distribution: **BlacklistedAIProxy**
- Version source of truth: `VERSION`
- Windows artifact naming:
  - `BlacklistedAIProxy-Setup-<version>-win-x64.exe`
  - `BlacklistedAIProxy-<version>-windows-x64.zip`
  - `BlacklistedAIProxy-portable.zip`
- Installer metadata must derive from workflow-provided version values.

---

## 3) Build/test script integrity policy

- `npm run test:unit` and `npm run test:integration` must resolve to valid scripts.
- `npm run test:summary` must return non-zero if any test suite fails.
- Release documentation and workflows use **npm-first** commands for consistency.

---

## 4) Windows artifact hardening requirements

- `tls-sidecar/tls-sidecar.exe` is a required build artifact.
- Workflow must fail on missing required assets before compile.
- Workflow must validate non-empty output for:
  - Installer `.exe`
  - Checksum `.sha256`
  - Portable `.zip`

---

## 5) Windows QA matrix (required smoke coverage)

| Area | Windows 10 x64 | Windows 11 x64 |
|---|---|---|
| Full install/uninstall | ✅ Required | ✅ Required |
| Portable launch/exit cleanup | ✅ Required | ✅ Required |
| Service boot persistence | ✅ Required | ✅ Required |
| Watchdog recovery | ✅ Required | ✅ Required |
| First-run UI login flow | ✅ Required | ✅ Required |
| `/health` endpoint | ✅ Required | ✅ Required |

---

## 6) Release gating

Required gates before beta publish:
- CI unit tests pass
- Windows packaging validation job passes
- Installer workflow artifact validation passes
- Promptfoo security suite run in release-candidate validation environment with configured upstream credentials

---

## 7) Security and operational hardening checklist

- [ ] Default credentials replaced before public beta deployment
- [ ] API keys masked in UI/log outputs
- [ ] Config/file-path safety controls verified
- [ ] Update-check behavior validated with/without proxy
- [ ] Incident rollback process tested for failed release

---

## 8) Distribution readiness checklist

- [ ] Release notes include known limitations
- [ ] SHA-256 checksum published with verification instructions
- [ ] Minimum requirements documented (Windows 10/11 x64, admin for Full mode)
- [ ] Unsigned binary risk disclosure included until code signing is in place

### Checksum verification commands

PowerShell:
```powershell
Get-FileHash .\BlacklistedAIProxy-Setup-<version>-win-x64.exe -Algorithm SHA256
```

Compare the output hash with the published `.sha256` asset value.

---

## 9) Feedback and support loop

- Beta issues should use the `beta-feedback` label.
- Triage SLA target:
  - Acknowledge: ≤ 48 hours
  - Initial triage: ≤ 7 days
  - Fix/mitigation target: ≤ 30 days
- Hotfix cadence: as-needed patch releases using semantic beta tags (e.g., `vX.Y.Z-beta.N`).

---

## 10) Final go/no-go checklist

- [ ] All release gates green
- [ ] Installer and portable validation complete on Win10/Win11 x64
- [ ] Versioning and artifact naming consistent
- [ ] Security/rollback checklist completed
- [ ] Beta communication published (release notes, known issues, support path)

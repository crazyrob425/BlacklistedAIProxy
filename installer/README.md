# BlacklistedAIProxy Windows Installer

This directory contains everything needed to build the Windows installer for
**BlacklistedAIProxy** using [Inno Setup 6](https://jrsoftware.org/isinfo.php).

---

## Directory structure

```
installer/
├── BlacklistedProxy.iss        # Main Inno Setup script — compile this
├── legal/
│   └── FullLegalTerms.rtf     # Complete legal agreement (RTF)
├── scripts/
│   ├── watchdog.js             # Self-healing watchdog service (Node.js)
│   ├── service-setup.js        # Service install/remove helper (Node.js)
│   └── bug-reporter.ps1        # GitHub issue reporter (PowerShell)
├── portable/
│   ├── launcher.ps1            # Portable mode launcher (PowerShell)
│   └── launcher.bat            # Portable mode launcher wrapper (.bat)
└── assets/
    ├── WizardImage.bmp         # 164×314 left-panel banner (24-bit BMP)
    ├── WizardSmallImage.bmp    # 55×55 top-right icon (24-bit BMP)
    ├── SetupIcon.ico           # Installer icon
    └── README.md               # Asset generation instructions
```

---

## Build prerequisites

| Prerequisite | Version | Notes |
|---|---|---|
| Inno Setup 6 | ≥ 6.3.0 | `choco install innosetup` or https://jrsoftware.org |
| Node.js | ≥ 20.x | For `npm ci --omit=dev` |
| NSSM | 2.24 x64 | Auto-downloaded by the CI workflow |
| Node.js portable zip | 20.x win-x64 | Auto-downloaded by the CI workflow |

---

## Manual build steps

1. **Install production dependencies** (from the repo root):
   ```powershell
   npm ci --omit=dev
   ```

2. **Download NSSM** and extract `nssm.exe` (64-bit) to:
   ```
   build\nssm\nssm.exe
   ```

3. **Download Node.js portable** zip and extract to:
   ```
   build\node\
   ```
   Download from: `https://nodejs.org/dist/v20.x.x/node-v20.x.x-win-x64.zip`

4. **Generate bitmap assets** (optional — installer uses defaults if absent):
   See `installer/assets/README.md` for PowerShell one-liners.

5. **Compile the installer**:
   ```powershell
   & "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\BlacklistedProxy.iss
   ```
   Output: `installer\Output\BlacklistedAIProxy-Setup-*.exe`

---

## Automated build (GitHub Actions)

The workflow `.github/workflows/build-windows-installer.yml` handles all of the
above automatically and publishes the result as a GitHub Release.

To trigger a manual build:
1. Go to **Actions → Build Windows Installer & Beta Release**
2. Click **Run workflow**
3. Choose whether to mark as pre-release
4. Optionally add release notes

See also: [`docs/WINDOWS_BETA_PRE_RELEASE.md`](../docs/WINDOWS_BETA_PRE_RELEASE.md) for beta scope, QA gates, and go/no-go criteria.

To trigger an automated release, push a version tag:
```bash
git tag v2.13.7-beta.1
git push origin v2.13.7-beta.1
```

---

## Install modes

| Mode | Default dir | Service | Autorun | Traces on exit |
|---|---|---|---|---|
| **Full Install** | `%ProgramFiles%\BlacklistedAIProxy` | ✅ Windows Service | ✅ Auto-start at boot | Stays installed |
| **Portable** | First removable drive found | ❌ None | ❌ None | ✅ All removed |

### Full Install details
- Installs `BlacklistedAIProxy` Windows service via NSSM
- Installs `BlacklistedAIProxyWatchdog` service (self-healing)
- Both services start at boot without requiring a user login
- Service recovery: automatic restart after 5-second delay on crash
- Start Menu group + optional Desktop shortcut
- Uninstaller registered in Programs & Features

### Portable mode details
- Default directory: first removable drive found (D:, E:, etc.) or `D:\BlacklistedAIProxy`
- No registry writes, no Windows services, no autorun entries
- `Launch BlacklistedAIProxy.bat` → `launcher.ps1`:
  - Extracts app + bundled Node.js to `%TEMP%\bap_<randomid>\`
  - Starts the proxy in the foreground
  - On exit (any reason), deletes the temp directory completely
  - No trace remains on the host PC

---

## Legal documents

`legal/FullLegalTerms.rtf` contains:
1. Beta Software License and Disclaimer
2. End User License Agreement (GPL v3 Supplement)
3. Terms of Service
4. AI System Usage Agreement & API Spoofing Warning
5. Privacy Policy
6. Hold Harmless and Indemnification Agreement
7. Third-Party Services Disclaimer
8. Acceptable Use Policy
9. Disclaimer of Warranties
10. Limitation of Liability
11. Governing Law and Dispute Resolution
12. Miscellaneous Provisions

The installer's License wizard page displays this document. Users must scroll
through the entire document and click "I Agree" to proceed with installation.

---

## Checksum verification (recommended)

After downloading `BlacklistedAIProxy-Setup-*.exe` and `.sha256`:

```powershell
Get-FileHash .\BlacklistedAIProxy-Setup-<version>-win-x64.exe -Algorithm SHA256
```

Confirm the hash matches the published `.sha256` release asset.

## BlacklistedAIProxy <version> — Windows Beta Release

> ⚠️ **BETA SOFTWARE** — pre-release quality; use in non-production environments.

### Included artifacts
- `BlacklistedAIProxy-Setup-<version>-win-x64.exe`
- `BlacklistedAIProxy-Setup-<version>-win-x64.exe.sha256`
- `BlacklistedAIProxy-portable.zip`

### Minimum requirements
- Windows 10/11 x64
- Administrator privileges (Full Install mode)
- Internet connectivity for configured upstream providers

### Installation modes
- **Full Install**: Windows service + watchdog + boot autostart
- **Portable**: no service install, no autorun

### Known limitations (beta)
- Binary is currently unsigned (SmartScreen warnings may appear)
- Provider-specific behavior may vary by account state and upstream policy

### Upgrade path
1. Download new installer build.
2. Run installer and choose upgrade in place.
3. Verify service health: `http://localhost:3000/health`.

### Rollback instructions
1. Stop and uninstall current beta build from Apps & Features.
2. Reinstall previous known-good beta release.
3. Restore `configs` backup and restart service.

### Checksum verification
```powershell
Get-FileHash .\BlacklistedAIProxy-Setup-<version>-win-x64.exe -Algorithm SHA256
```
Compare the output against the published `.sha256` asset.

### Support / feedback
- Open issue with `beta-feedback` label
- Include version, install mode, repro steps, expected vs actual behavior, and redacted logs

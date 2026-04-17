# BlacklistedAIProxy Beta Installer - Build Instructions

## Quick Start (Windows 10/11)

### Step 1: Install Prerequisites (5 minutes)

**Node.js 20+**
- Download: https://nodejs.org/en/download
- Install with default options
- Verify: `node --version` in Command Prompt

**Go 1.22+**
- Download: https://golang.org/dl/
- Install with default options
- Verify: `go version` in Command Prompt

### Step 2: Run Automated Build (10-15 minutes)

1. Open **Command Prompt as Administrator**
   - Press `Win + R`, type `cmd`, press `Ctrl+Shift+Enter`

2. Navigate to project directory:
   ```cmd
   cd C:\path\to\BlacklistedAIProxy
   ```

3. Run the build script:
   ```cmd
   build-full-automated.bat
   ```

4. **Wait** for the build to complete (15-20 minutes)
   - Downloads tools (Inno Setup, NSSM, Node.js)
   - Builds tls-sidecar (Go)
   - Installs npm dependencies
   - Compiles Windows installer
   - Tests the installer

### Step 3: Deploy (Optional)

**Test locally:**
```cmd
Output\BlacklistedAIProxy-Setup-2.13.7-beta.1-win-x64.exe
```

**Upload to GitHub:**
```cmd
gh release create v2.13.7-beta.1 --prerelease Output\BlacklistedAIProxy-Setup-2.13.7-beta.1-win-x64.exe
```

## What Gets Built

- **Installer:** `Output\BlacklistedAIProxy-Setup-2.13.7-beta.1-win-x64.exe` (~150 MB)
- **Portable ZIP:** `build\BlacklistedAIProxy-portable.zip` (~300 MB)
- **TLS Sidecar:** `tls-sidecar.exe` (Go binary)

## Troubleshooting

**"Node.js not found"**
- Install from https://nodejs.org/
- Restart Command Prompt after install

**"Go not found"**
- Install from https://golang.org/dl/
- Restart Command Prompt after install

**"Administrator privileges required"**
- Right-click Command Prompt → Run as Administrator

**"Inno Setup installation failed"**
- Download manually: https://jrsoftware.org/isdl.php
- Install as Administrator
- Re-run the script

**"NSSM download failed"**
- Download manually: https://github.com/nssm-community/nssm/releases
- Extract `nssm.exe` (64-bit) to: `build\nssm\nssm.exe`
- Re-run the script

## Manual Build (Advanced)

If the automated script fails:

1. Download Inno Setup 6.3.3 manually: https://jrsoftware.org/isdl.php
2. Download NSSM and extract to `build\nssm\`
3. Run:
   ```cmd
   npm ci --no-optional
   cd tls-sidecar && go build -o tls-sidecar.exe . && cd ..
   copy tls-sidecar\tls-sidecar.exe tls-sidecar.exe
   "C:\Program Files (x86)\Inno Setup 6\iscc.exe" installer\BlacklistedProxy.iss
   ```

## Output

On success, you'll see:
```
╔════════════════════════════════════════════════════════════════╗
║                    BUILD COMPLETE                             ║
╚════════════════════════════════════════════════════════════════╝

Version:    2.13.7-beta.1
Platform:   Windows x64
File:       BlacklistedAIProxy-Setup-2.13.7-beta.1-win-x64.exe
Size:       ~150 MB
Location:   Output\BlacklistedAIProxy-Setup-2.13.7-beta.1-win-x64.exe
```

## Support

For issues, check:
- GitHub Issues: https://github.com/crazyrob425/BlacklistedAIProxy/issues
- Script logs in Command Prompt output

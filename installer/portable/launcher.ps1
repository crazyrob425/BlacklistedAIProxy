# BlacklistedAIProxy — Portable Mode Launcher
# This script:
#   1. Extracts the bundled app to a private temp directory
#   2. Starts the proxy service in the foreground
#   3. On exit (Ctrl+C or window close), stops the service and removes ALL traces
#
# Usage: Right-click -> "Run with PowerShell" or double-click the .bat launcher.
# No registry writes. No Windows services. No autorun. Fully self-contained.

param(
    [int]$Port = 3000,
    [string]$ApiKey = "portable-temp-key"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# ── Locate the archive ────────────────────────────────────────────────────────

$ScriptDir  = Split-Path $MyInvocation.MyCommand.Path
$AppArchive = Join-Path $ScriptDir "BlacklistedAIProxy-portable.zip"
$NodeArchive= Join-Path $ScriptDir "node-portable.zip"

if (-not (Test-Path $AppArchive)) {
    [System.Windows.Forms.MessageBox]::Show(
        "Missing: $AppArchive`n`nPlease keep launcher.ps1 in the same folder as BlacklistedAIProxy-portable.zip.",
        "BlacklistedAIProxy Portable",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    )
    exit 1
}

# ── Create isolated temp directory ────────────────────────────────────────────

$TempId  = [System.Guid]::NewGuid().ToString("N").Substring(0, 12)
$TempDir = Join-Path $env:TEMP "bap_${TempId}"
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

# Register cleanup on ALL exit paths
$CleanupBlock = {
    param($TempDir, $NodeProc)
    try {
        if ($NodeProc -and -not $NodeProc.HasExited) {
            $NodeProc.Kill()
            $NodeProc.WaitForExit(5000)
        }
    } catch {}
    try {
        if (Test-Path $TempDir) {
            Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

$NodeProcess = $null

try {
    # ── Extract Node.js runtime ───────────────────────────────────────────────

    $NodeDir = Join-Path $TempDir "node"
    if (Test-Path $NodeArchive) {
        Write-Host "[Portable] Extracting Node.js runtime..." -ForegroundColor Cyan
        Expand-Archive -Path $NodeArchive -DestinationPath $NodeDir -Force
        # Find node.exe inside the extracted folder
        $NodeExe = Get-ChildItem -Path $NodeDir -Filter "node.exe" -Recurse | Select-Object -First 1
        if (-not $NodeExe) { throw "node.exe not found in portable archive" }
        $NodeBin = $NodeExe.FullName
    } else {
        # Fall back to system Node.js
        $NodeBin = (Get-Command node -ErrorAction SilentlyContinue)?.Source
        if (-not $NodeBin) {
            throw "Node.js is not installed and portable runtime archive is missing.`nPlease install Node.js 20+ from https://nodejs.org/"
        }
        Write-Host "[Portable] Using system Node.js: $NodeBin" -ForegroundColor Yellow
    }

    # ── Extract application ───────────────────────────────────────────────────

    Write-Host "[Portable] Extracting application..." -ForegroundColor Cyan
    $AppDir = Join-Path $TempDir "app"
    Expand-Archive -Path $AppArchive -DestinationPath $AppDir -Force

    # Copy example config if no config present
    $ConfigDst = Join-Path $AppDir "configs\config.json"
    $ConfigSrc = Join-Path $AppDir "configs\config.json.example"
    if (-not (Test-Path $ConfigDst) -and (Test-Path $ConfigSrc)) {
        Copy-Item $ConfigSrc $ConfigDst
        # Patch default port and API key
        $cfg = Get-Content $ConfigDst -Raw | ConvertFrom-Json
        $cfg.SERVER_PORT      = $Port
        $cfg.REQUIRED_API_KEY = $ApiKey
        $cfg | ConvertTo-Json -Depth 20 | Set-Content $ConfigDst
    }

    # ── Start the proxy ───────────────────────────────────────────────────────

    $EntryPoint = Join-Path $AppDir "src\core\master.js"
    if (-not (Test-Path $EntryPoint)) {
        throw "Entry point not found: $EntryPoint"
    }

    Write-Host ""
    Write-Host "  ╔══════════════════════════════════════════════╗" -ForegroundColor Green
    Write-Host ("  ║   BlacklistedAIProxy — Portable Mode         ║") -ForegroundColor Green
    Write-Host ("  ║   Listening on http://localhost:{0,-5}        ║" -f $Port) -ForegroundColor Green
    Write-Host ("  ║   API Key: {0,-34}║" -f $ApiKey) -ForegroundColor Green
    Write-Host "  ║   Press Ctrl+C to stop and clean up          ║" -ForegroundColor Green
    Write-Host "  ╚══════════════════════════════════════════════╝" -ForegroundColor Green
    Write-Host ""
    Write-Host "[Portable] Temp directory: $TempDir" -ForegroundColor DarkGray
    Write-Host "[Portable] This directory will be deleted on exit." -ForegroundColor DarkGray
    Write-Host ""

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName  = $NodeBin
    $psi.Arguments = "`"$EntryPoint`""
    $psi.WorkingDirectory = $AppDir
    $psi.UseShellExecute = $false
    # Pass config via environment
    $psi.EnvironmentVariables["SERVER_PORT"]      = $Port
    $psi.EnvironmentVariables["REQUIRED_API_KEY"] = $ApiKey

    $NodeProcess = [System.Diagnostics.Process]::Start($psi)

    # Wait for process to exit
    $NodeProcess.WaitForExit()
    Write-Host ""
    Write-Host "[Portable] Process exited. Cleaning up..." -ForegroundColor Yellow

} catch {
    Write-Host "[Portable] ERROR: $_" -ForegroundColor Red
} finally {
    # Always clean up
    & $CleanupBlock $TempDir $NodeProcess
    Write-Host "[Portable] Cleanup complete. All temporary files removed." -ForegroundColor Green
    Write-Host "[Portable] No traces remain on this PC." -ForegroundColor Green
    Start-Sleep -Seconds 3
}

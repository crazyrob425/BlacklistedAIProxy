# BlacklistedAIProxy — Bug Reporter
# Opens a GitHub issue pre-filled with system information.
# Launched from the Start Menu shortcut or by the installer's "Report a Bug" button.

param(
    [string]$InstallDir = (Split-Path $MyInvocation.MyCommand.Path)
)

$GITHUB_ISSUES_URL = "https://github.com/crazyrob425/BlacklistedAIProxy/issues/new"
$GITHUB_LABELS     = "bug,beta-feedback"

# ── Collect system info ───────────────────────────────────────────────────────

$osInfo      = (Get-CimInstance Win32_OperatingSystem).Caption
$nodeVersion = try { (& node --version 2>&1).Trim() } catch { "Not found" }
$appVersion  = try { (Get-Content (Join-Path $InstallDir "VERSION") -Raw).Trim() } catch { "Unknown" }
$logPath     = Join-Path $InstallDir "logs"

# Read last 50 lines of the service log (redact sensitive patterns)
$logSnippet = ""
$serviceLog = Join-Path $logPath "service.log"
if (Test-Path $serviceLog) {
    $lines = Get-Content $serviceLog -Tail 50 -ErrorAction SilentlyContinue
    if ($lines) {
        # Redact common sensitive patterns
        $redacted = $lines | ForEach-Object {
            $_ -replace '(?i)(api[_-]?key|token|secret|password|clearance|credentials)\s*[=:]\s*\S+', '$1=REDACTED' `
               -replace 'sk-[A-Za-z0-9\-_]{10,}', 'sk-REDACTED' `
               -replace 'Bearer [A-Za-z0-9\-_\.]{10,}', 'Bearer REDACTED'
        }
        $logSnippet = $redacted -join "`n"
    }
}

# ── Build issue body ──────────────────────────────────────────────────────────

$issueBody = @"
## Bug Report — BlacklistedAIProxy Beta

### Environment
| Field | Value |
|---|---|
| App Version | $appVersion |
| OS | $osInfo |
| Node.js | $nodeVersion |
| Install Path | (redacted — add if needed) |

### What happened?
<!-- Describe the bug clearly. What did you expect vs what actually happened? -->

### Steps to reproduce
1. 
2. 
3. 

### Expected behavior
<!-- What should have happened? -->

### Actual behavior
<!-- What actually happened? -->

### Log excerpt (last 50 lines — please review before submitting)
``````
$logSnippet
``````

### Additional context
<!-- Screenshots, config snippets (with keys redacted), etc. -->

---
*Submitted via built-in bug reporter — BlacklistedAIProxy v$appVersion*
"@

# ── URL-encode body and open browser ─────────────────────────────────────────

Add-Type -AssemblyName System.Web
$encodedTitle = [System.Web.HttpUtility]::UrlEncode("Bug: [describe the issue here]")
$encodedBody  = [System.Web.HttpUtility]::UrlEncode($issueBody)
$encodedLabels= [System.Web.HttpUtility]::UrlEncode($GITHUB_LABELS)

$url = "${GITHUB_ISSUES_URL}?title=${encodedTitle}&body=${encodedBody}&labels=${encodedLabels}"

Write-Host "Opening GitHub Issues page in your browser..."
Write-Host "URL: $GITHUB_ISSUES_URL"
Write-Host ""
Write-Host "IMPORTANT: Please review the pre-filled form and:"
Write-Host "  - Remove any sensitive information (API keys, tokens, passwords)"
Write-Host "  - Add a clear description of the bug"
Write-Host "  - Attach any relevant screenshots"
Write-Host ""
Write-Host "A GitHub account is required to submit the report."

Start-Process $url

# Keep window open briefly so user can read the message
Start-Sleep -Seconds 5

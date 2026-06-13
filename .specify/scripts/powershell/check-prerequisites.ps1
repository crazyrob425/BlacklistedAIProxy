# Check prerequisites and return feature paths
# Usage: .\check-prerequisites.ps1 [-Json] [-RequireTasks] [-IncludeTasks] [-PathsOnly]

param(
    [switch]$Json,
    [switch]$RequireTasks,
    [switch]$IncludeTasks,
    [switch]$PathsOnly
)

. (Join-Path $PSScriptRoot "common.ps1")

try {
    $paths = Get-FeaturePaths
    
    # Validate required files
    if (-not (Test-Path $paths.FEATURE_SPEC)) {
        throw "spec.md not found. Run /specify first."
    }
    
    if (-not $PathsOnly) {
        if (-not (Test-Path $paths.IMPL_PLAN)) {
            throw "plan.md not found. Run /plan first."
        }
        
        if ($RequireTasks -and -not (Test-Path $paths.TASKS)) {
            throw "tasks.md not found. Run /tasks first."
        }
    }
    
    # Build available docs list
    $docs = @()
    if (Test-Path $paths.RESEARCH) { $docs += "research.md" }
    if (Test-Path $paths.DATA_MODEL) { $docs += "data-model.md" }
    if ((Test-Path $paths.CONTRACTS_DIR) -and (Get-ChildItem $paths.CONTRACTS_DIR -ErrorAction SilentlyContinue)) {
        $docs += "contracts/"
    }
    if (Test-Path $paths.QUICKSTART) { $docs += "quickstart.md" }
    if ($IncludeTasks -and (Test-Path $paths.TASKS)) { $docs += "tasks.md" }
    
    # Output
    if ($Json) {
        $output = @{
            FEATURE_DIR = $paths.FEATURE_DIR
            FEATURE_SPEC = $paths.FEATURE_SPEC
            IMPL_PLAN = $paths.IMPL_PLAN
            TASKS = $paths.TASKS
            AVAILABLE_DOCS = $docs
        }
        $output | ConvertTo-Json -Compress
    } else {
        Write-Output "FEATURE_DIR: $($paths.FEATURE_DIR)"
        Write-Output "Available documents:"
        Test-FileExists $paths.RESEARCH "research.md"
        Test-FileExists $paths.DATA_MODEL "data-model.md"
        Test-DirHasFiles $paths.CONTRACTS_DIR "contracts/"
        Test-FileExists $paths.QUICKSTART "quickstart.md"
        if ($IncludeTasks) {
            Test-FileExists $paths.TASKS "tasks.md"
        }
    }
} catch {
    if ($Json) {
        @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
    } else {
        Write-Error $_.Exception.Message
    }
    exit 1
}

# Common PowerShell functions for Specify scripts

function Get-RepoRoot {
    $currentDir = Get-Location
    while ($currentDir) {
        if (Test-Path (Join-Path $currentDir ".specify")) {
            return $currentDir
        }
        $parent = Split-Path $currentDir -Parent
        if ($parent -eq $currentDir) { break }
        $currentDir = $parent
    }
    throw "Not in a Specify repository (no .specify directory found)"
}

function Get-FeaturePaths {
    param(
        [string]$FeatureOverride = $null
    )
    
    $repoRoot = Get-RepoRoot
    $specsDir = Join-Path $repoRoot ".specify\specs"
    
    # Check if we have Git
    $hasGit = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
    $currentBranch = ""
    $featureDir = ""
    
    if ($hasGit) {
        Push-Location $repoRoot
        try {
            $gitCheck = git rev-parse --git-dir 2>$null
            if ($LASTEXITCODE -eq 0) {
                $currentBranch = git rev-parse --abbrev-ref HEAD 2>$null
                
                # Extract feature number from branch (e.g., 001-feature-name)
                if ($currentBranch -match '^(\d{3})') {
                    $featureNum = $matches[1]
                    $featureDir = Get-ChildItem $specsDir -Directory | 
                        Where-Object { $_.Name -match "^$featureNum-" } | 
                        Select-Object -First 1 -ExpandProperty FullName
                }
            }
        } finally {
            Pop-Location
        }
    }
    
    # Fallback: Use SPECIFY_FEATURE env var or most recent directory
    if (-not $featureDir) {
        if ($FeatureOverride) {
            $featureDir = Join-Path $specsDir $FeatureOverride
        } elseif ($env:SPECIFY_FEATURE) {
            $featureDir = Join-Path $specsDir $env:SPECIFY_FEATURE
        } else {
            $featureDir = Get-ChildItem $specsDir -Directory | 
                Sort-Object CreationTime -Descending | 
                Select-Object -First 1 -ExpandProperty FullName
        }
    }
    
    if (-not $featureDir -or -not (Test-Path $featureDir)) {
        throw "No active feature found. Run /specify first."
    }
    
    return @{
        REPO_ROOT = $repoRoot
        SPECS_DIR = $specsDir
        CURRENT_BRANCH = $currentBranch
        HAS_GIT = $hasGit
        FEATURE_DIR = $featureDir
        FEATURE_SPEC = Join-Path $featureDir "spec.md"
        IMPL_PLAN = Join-Path $featureDir "plan.md"
        TASKS = Join-Path $featureDir "tasks.md"
        RESEARCH = Join-Path $featureDir "research.md"
        DATA_MODEL = Join-Path $featureDir "data-model.md"
        QUICKSTART = Join-Path $featureDir "quickstart.md"
        CONTRACTS_DIR = Join-Path $featureDir "contracts"
    }
}

function Test-FileExists {
    param([string]$Path, [string]$Description)
    if (Test-Path -Path $Path -PathType Leaf) {
        Write-Output "  ✓ $Description"
        return $true
    } else {
        Write-Output "  ✗ $Description"
        return $false
    }
}

function Test-DirHasFiles {
    param([string]$Path, [string]$Description)
    if ((Test-Path -Path $Path) -and (Get-ChildItem -Path $Path -ErrorAction SilentlyContinue | Select-Object -First 1)) {
        Write-Output "  ✓ $Description"
        return $true
    } else {
        Write-Output "  ✗ $Description"
        return $false
    }
}

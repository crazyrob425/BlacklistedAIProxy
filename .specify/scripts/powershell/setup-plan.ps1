# Setup plan file for active feature
# Usage: .\setup-plan.ps1 [-Json]

param(
    [switch]$Json
)

. (Join-Path $PSScriptRoot "common.ps1")

try {
    $paths = Get-FeaturePaths
    
    # Validate spec exists
    if (-not (Test-Path $paths.FEATURE_SPEC)) {
        throw "spec.md not found. Run /specify first."
    }
    
    # Copy plan template if exists
    $templatePath = Join-Path $paths.REPO_ROOT ".specify\templates\plan-template.md"
    if ((Test-Path $templatePath) -and -not (Test-Path $paths.IMPL_PLAN)) {
        Copy-Item $templatePath $paths.IMPL_PLAN
    } elseif (-not (Test-Path $paths.IMPL_PLAN)) {
        # Create basic plan file
        @"
# Implementation Plan

**Date**: $(Get-Date -Format "yyyy-MM-dd")

## Summary

[Plan summary]

## Technical Context

[Technical details]
"@ | Out-File -FilePath $paths.IMPL_PLAN -Encoding UTF8
    }
    
    # Output result
    if ($Json) {
        @{
            FEATURE_SPEC = $paths.FEATURE_SPEC
            IMPL_PLAN = $paths.IMPL_PLAN
            SPECS_DIR = $paths.FEATURE_DIR
            BRANCH = $paths.CURRENT_BRANCH
            HAS_GIT = $paths.HAS_GIT
        } | ConvertTo-Json -Compress
    } else {
        Write-Output "FEATURE_SPEC: $($paths.FEATURE_SPEC)"
        Write-Output "IMPL_PLAN: $($paths.IMPL_PLAN)"
        Write-Output "BRANCH: $($paths.CURRENT_BRANCH)"
    }
} catch {
    if ($Json) {
        @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
    } else {
        Write-Error $_.Exception.Message
    }
    exit 1
}

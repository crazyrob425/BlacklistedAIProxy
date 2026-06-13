# Create new feature branch and directory structure
# Usage: .\create-new-feature.ps1 -FeatureName "user-auth" [-Json]

param(
    [Parameter(Mandatory=$true)]
    [string]$FeatureName,
    [switch]$Json
)

. (Join-Path $PSScriptRoot "common.ps1")

try {
    $repoRoot = Get-RepoRoot
    $specsDir = Join-Path $repoRoot ".specify\specs"
    
    # Ensure specs directory exists
    if (-not (Test-Path $specsDir)) {
        New-Item -ItemType Directory -Path $specsDir -Force | Out-Null
    }
    
    # Get next feature number
    $existingFeatures = Get-ChildItem $specsDir -Directory | 
        Where-Object { $_.Name -match '^\d{3}-' } | 
        ForEach-Object { [int]($_.Name.Substring(0, 3)) } | 
        Sort-Object -Descending
    
    $nextNumber = if ($existingFeatures) { $existingFeatures[0] + 1 } else { 1 }
    $featureNumber = "{0:D3}" -f $nextNumber
    $featureDirName = "$featureNumber-$FeatureName"
    $featureDir = Join-Path $specsDir $featureDirName
    
    # Create feature directory
    New-Item -ItemType Directory -Path $featureDir -Force | Out-Null
    
    # Check for Git and create branch
    $hasGit = $null -ne (Get-Command git -ErrorAction SilentlyContinue)
    $branchCreated = $false
    $currentBranch = ""
    
    if ($hasGit) {
        Push-Location $repoRoot
        try {
            $gitCheck = git rev-parse --git-dir 2>$null
            if ($LASTEXITCODE -eq 0) {
                # Create and checkout new branch
                git checkout -b $featureDirName 2>$null
                if ($LASTEXITCODE -eq 0) {
                    $branchCreated = $true
                    $currentBranch = $featureDirName
                }
            }
        } finally {
            Pop-Location
        }
    }
    
    # Copy template
    $templatePath = Join-Path $repoRoot ".specify\templates\spec-template.md"
    $specPath = Join-Path $featureDir "spec.md"
    
    if (Test-Path $templatePath) {
        Copy-Item $templatePath $specPath
    } else {
        # Create basic spec file
        @"
# Feature Specification: $FeatureName

**Branch**: ``$featureDirName`` | **Date**: $(Get-Date -Format "yyyy-MM-dd")

## Overview

[Feature description]

## Functional Requirements

### FR-001: [Requirement Name]
[Description]

## Success Criteria

- [ ] Criterion 1
- [ ] Criterion 2
"@ | Out-File -FilePath $specPath -Encoding UTF8
    }
    
    # Output result
    if ($Json) {
        @{
            FEATURE_DIR = $featureDir
            FEATURE_NUMBER = $featureNumber
            FEATURE_NAME = $featureDirName
            BRANCH_CREATED = $branchCreated
            CURRENT_BRANCH = $currentBranch
            SPEC_PATH = $specPath
        } | ConvertTo-Json -Compress
    } else {
        Write-Output "Created feature: $featureDirName"
        Write-Output "Feature directory: $featureDir"
        if ($branchCreated) {
            Write-Output "Git branch created: $currentBranch"
        } else {
            Write-Output "Git branch not created (no Git repo or Git not available)"
        }
        Write-Output "Spec file: $specPath"
    }
} catch {
    if ($Json) {
        @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
    } else {
        Write-Error $_.Exception.Message
    }
    exit 1
}

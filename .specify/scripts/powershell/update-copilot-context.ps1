# Update COPILOT.md context file with current project tech stack
# Usage: .\update-copilot-context.ps1

. (Join-Path $PSScriptRoot "common.ps1")

try {
    $paths = Get-FeaturePaths
    $contextFile = Join-Path $paths.REPO_ROOT "COPILOT.md"
    
    # Read plan.md to extract tech stack
    $techStack = @()
    if (Test-Path $paths.IMPL_PLAN) {
        $planContent = Get-Content $paths.IMPL_PLAN -Raw
        
        # Extract technologies mentioned in plan
        if ($planContent -match '(?s)## Technical Context.*?(?=##|$)') {
            $techSection = $matches[0]
            $techStack = $techSection -split '\n' | 
                Where-Object { $_ -match '[-*]\s*(.+)' } | 
                ForEach-Object { $matches[1].Trim() }
        }
    }
    
    # Create or update COPILOT.md
    $contextContent = @"
# GitHub Copilot Context

**Last Updated**: $(Get-Date -Format "yyyy-MM-dd HH:mm:ss")

## Project Overview

This is a Spec-Driven Development project using the specdriven methodology.

## Active Feature

- **Directory**: $($paths.FEATURE_DIR)
- **Branch**: $($paths.CURRENT_BRANCH)

## Technology Stack

"@
    
    if ($techStack.Count -gt 0) {
        $contextContent += ($techStack | ForEach-Object { "- $_" }) -join "`n"
    } else {
        $contextContent += "- [No tech stack information available yet]"
    }
    
    $contextContent += @"


## Development Guidelines

Follow the constitution at `.specify/memory/constitution.md` for all development decisions.

## Available Documents

"@
    
    # List available documents
    $docs = @(
        @{ Path = $paths.FEATURE_SPEC; Name = "spec.md" },
        @{ Path = $paths.IMPL_PLAN; Name = "plan.md" },
        @{ Path = $paths.TASKS; Name = "tasks.md" },
        @{ Path = $paths.RESEARCH; Name = "research.md" },
        @{ Path = $paths.DATA_MODEL; Name = "data-model.md" },
        @{ Path = $paths.QUICKSTART; Name = "quickstart.md" }
    )
    
    foreach ($doc in $docs) {
        if (Test-Path $doc.Path) {
            $contextContent += "- [$($doc.Name)]($($doc.Path -replace '\\', '/'))`n"
        }
    }
    
    # Write context file
    $contextContent | Out-File -FilePath $contextFile -Encoding UTF8
    
    Write-Output "Updated COPILOT.md context file"
} catch {
    Write-Error $_.Exception.Message
    exit 1
}

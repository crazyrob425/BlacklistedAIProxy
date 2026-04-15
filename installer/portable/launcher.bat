@echo off
:: BlacklistedAIProxy — Portable Launcher Wrapper
:: This .bat file launches launcher.ps1 with the correct PowerShell execution policy.
:: Double-click this file to start BlacklistedAIProxy in portable mode.

title BlacklistedAIProxy Portable

echo.
echo  ===============================================
echo   BlacklistedAIProxy - Portable Mode Launcher
echo   blacklistedbinary.com
echo  ===============================================
echo.

:: Check if PowerShell is available
where powershell >nul 2>&1
if errorlevel 1 (
    echo ERROR: PowerShell is required but was not found.
    echo Please install PowerShell 5.1 or later.
    pause
    exit /b 1
)

:: Launch the PowerShell script, bypassing execution policy for this session only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1"

:: If PowerShell exits with an error, show it
if errorlevel 1 (
    echo.
    echo The launcher encountered an error. See messages above.
    pause
)

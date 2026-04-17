@echo off
REM ============================================================================
REM BlacklistedAIProxy Beta Installer - Complete Automated Build
REM ============================================================================
REM This script downloads all prerequisites, builds, and packages the installer
REM Run as Administrator on Windows 10/11
REM ============================================================================

setlocal enabledelayedexpansion
cd /d "%~dp0"

set "SCRIPT_DIR=%CD%"
set "TEMP_BUILD=%TEMP%\BuildTools"
set "VERSION_FILE=%SCRIPT_DIR%\VERSION"

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║  BlacklistedAIProxy Beta Installer - Full Automated Build       ║
echo ║  Platform: Windows x64                                         ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.

REM ============================================================================
REM Check Admin Rights
REM ============================================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: This script requires Administrator privileges.
    echo Please run Command Prompt as Administrator and retry.
    pause
    exit /b 1
)

echo [ADMIN] Administrator privileges confirmed

REM ============================================================================
REM Check Prerequisites
REM ============================================================================

echo.
echo CHECKING PREREQUISITES...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

where /q node
if errorlevel 1 (
    echo ERROR: Node.js not found
    echo Download from: https://nodejs.org/ (v20 or higher)
    pause
    exit /b 1
)
for /f "tokens=*" %%A in ('node --version') do set NODE_VER=%%A
echo ✓ Node.js: !NODE_VER!

where /q go
if errorlevel 1 (
    echo ERROR: Go not found
    echo Download from: https://golang.org/ (v1.22 or higher)
    pause
    exit /b 1
)
for /f "tokens=*" %%A in ('go version') do set GO_VER=%%A
echo ✓ Go: !GO_VER!

REM ============================================================================
REM Download and Setup Tools
REM ============================================================================

echo.
echo PREPARING BUILD TOOLS...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if exist "%TEMP_BUILD%" rmdir /s /q "%TEMP_BUILD%"
mkdir "%TEMP_BUILD%"

REM Download Inno Setup
echo.
echo [1/3] Downloading Inno Setup 6.3.3...
powershell -NoProfile -Command "^
  try { ^
    Write-Host 'Downloading Inno Setup...'; ^
    Invoke-WebRequest -Uri 'https://files.jrsoftware.org/is/6/innosetup-6.3.3.exe' -OutFile '%TEMP_BUILD%\innosetup.exe' -UseBasicParsing -TimeoutSec 120; ^
    Write-Host 'Downloaded successfully'; ^
  } catch { ^
    Write-Host 'Download failed:' $_; ^
    exit 1; ^
  } ^
"
if errorlevel 1 (
    echo ERROR: Failed to download Inno Setup
    pause
    exit /b 1
)

echo Installing Inno Setup...
"%TEMP_BUILD%\innosetup.exe" /SILENT /SUPPRESSMSGBOXES /SP-
timeout /t 15 /nobreak

if not exist "C:\Program Files (x86)\Inno Setup 6\iscc.exe" (
    echo ERROR: Inno Setup installation failed
    pause
    exit /b 1
)
echo ✓ Inno Setup installed

REM Download NSSM
echo.
echo [2/3] Downloading NSSM...
powershell -NoProfile -Command "^
  try { ^
    Write-Host 'Downloading NSSM...'; ^
    Invoke-WebRequest -Uri 'https://github.com/nssm-community/nssm/releases/download/2.24-101-g897c7ad/nssm-2.24-101-g897c7ad.zip' -OutFile '%TEMP_BUILD%\nssm.zip' -UseBasicParsing -TimeoutSec 60; ^
    Write-Host 'Downloaded successfully'; ^
    Add-Type -AssemblyName System.IO.Compression.FileSystem; ^
    [System.IO.Compression.ZipFile]::ExtractToDirectory('%TEMP_BUILD%\nssm.zip', '%TEMP_BUILD%\nssm-extract', \$true); ^
    Copy-Item '%TEMP_BUILD%\nssm-extract\nssm-2.24-101-g897c7ad\win64\nssm.exe' '%SCRIPT_DIR%\build\nssm\' -Force; ^
  } catch { ^
    Write-Host 'Download failed:' $_; ^
    exit 1; ^
  } ^
"
if errorlevel 1 (
    echo ERROR: Failed to download NSSM
    pause
    exit /b 1
)
echo ✓ NSSM ready

REM Download Node.js portable
echo.
echo [3/3] Downloading Node.js portable runtime...
powershell -NoProfile -Command "^
  try { ^
    Write-Host 'Downloading Node.js...'; ^
    Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.17.0/node-v20.17.0-win-x64.zip' -OutFile '%TEMP_BUILD%\node.zip' -UseBasicParsing -TimeoutSec 120; ^
    Write-Host 'Downloaded successfully'; ^
    Add-Type -AssemblyName System.IO.Compression.FileSystem; ^
    [System.IO.Compression.ZipFile]::ExtractToDirectory('%TEMP_BUILD%\node.zip', '%TEMP_BUILD%\node-extract', \$true); ^
    Copy-Item '%TEMP_BUILD%\node-extract\node-v20.17.0-win-x64\*' '%SCRIPT_DIR%\build\node\' -Recurse -Force; ^
  } catch { ^
    Write-Host 'Download failed:' $_; ^
    exit 1; ^
  } ^
"
if errorlevel 1 (
    echo ERROR: Failed to download Node.js
    pause
    exit /b 1
)
echo ✓ Node.js runtime ready

REM ============================================================================
REM Build Application
REM ============================================================================

echo.
echo BUILDING APPLICATION...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

REM Read version
for /f "delims=" %%A in (%VERSION_FILE%) do set BASE_VERSION=%%A
set FULL_VERSION=%BASE_VERSION%-beta.1

echo Version: %FULL_VERSION%

REM Install npm dependencies
echo.
echo Installing npm dependencies...
call npm ci --no-optional --silent
if errorlevel 1 (
    echo ERROR: npm install failed
    pause
    exit /b 1
)
echo ✓ Dependencies installed

REM Build tls-sidecar
echo.
echo Building tls-sidecar (Go)...
cd /d "%SCRIPT_DIR%\tls-sidecar"
call go mod download
if errorlevel 1 (
    echo ERROR: go mod download failed
    pause
    exit /b 1
)

set CGO_ENABLED=0
set GOOS=windows
set GOARCH=amd64

call go build -ldflags="-s -w" -o tls-sidecar.exe .
if errorlevel 1 (
    echo ERROR: go build failed
    pause
    exit /b 1
)

if not exist "tls-sidecar.exe" (
    echo ERROR: tls-sidecar.exe not created
    pause
    exit /b 1
)

cd /d "%SCRIPT_DIR%"
copy tls-sidecar\tls-sidecar.exe tls-sidecar.exe
echo ✓ tls-sidecar.exe built

REM ============================================================================
REM Compile Installer
REM ============================================================================

echo.
echo COMPILING INSTALLER...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

if not exist Output mkdir Output

echo Compiling with Inno Setup...
"C:\Program Files (x86)\Inno Setup 6\iscc.exe" ^
  /D"AppVersion=%FULL_VERSION%" ^
  /D"AppVersionNumeric=%BASE_VERSION%.1" ^
  "%SCRIPT_DIR%\installer\BlacklistedProxy.iss"

if errorlevel 1 (
    echo ERROR: Inno Setup compilation failed
    pause
    exit /b 1
)

set INSTALLER=%SCRIPT_DIR%\Output\BlacklistedAIProxy-Setup-%FULL_VERSION%-win-x64.exe

if not exist "%INSTALLER%" (
    echo ERROR: Installer file not created
    pause
    exit /b 1
)

for %%A in ("%INSTALLER%") do set SIZE=%%~zA
set /a SIZE_MB=%SIZE%/1048576

echo ✓ Installer compiled: %SIZE_MB% MB

REM ============================================================================
REM Test Installer
REM ============================================================================

echo.
echo TESTING INSTALLER...
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set TEST_DIR=%TEMP%\BlacklistedAIProxy-Test

if exist "%TEST_DIR%" rmdir /s /q "%TEST_DIR%"

echo Running silent installation test...
"%INSTALLER%" /SILENT /NORESTART /DIR="%TEST_DIR%" /COMPONENTS="app"
timeout /t 3 /nobreak

if exist "%TEST_DIR%\src\core\master.js" (
    echo ✓ Smoke test passed
) else (
    echo ERROR: Smoke test failed - core files not installed
    pause
    exit /b 1
)

REM ============================================================================
REM Summary
REM ============================================================================

echo.
echo ╔════════════════════════════════════════════════════════════════╗
echo ║                    BUILD COMPLETE                             ║
echo ╚════════════════════════════════════════════════════════════════╝
echo.
echo BUILD DETAILS
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo Version:    %FULL_VERSION%
echo Platform:   Windows x64
echo Node.js:    20.17.0
echo Go sidecar: 1.22
echo.
echo INSTALLER
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo File:       BlacklistedAIProxy-Setup-%FULL_VERSION%-win-x64.exe
echo Size:       %SIZE_MB% MB
echo Location:   %INSTALLER%
echo.
echo NEXT STEPS
echo ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo 1. Test the installer by running it:
echo    "%INSTALLER%"
echo.
echo 2. Upload to GitHub Release:
echo    gh release create v%FULL_VERSION% --prerelease "%INSTALLER%"
echo.
echo 3. Share with testers
echo.

REM Cleanup
echo.
echo Cleaning up temporary files...
if exist "%TEMP_BUILD%" rmdir /s /q "%TEMP_BUILD%"

echo.
echo ✓ Ready to deploy!
echo.

endlocal
pause

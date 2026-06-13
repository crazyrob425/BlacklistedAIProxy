$ErrorActionPreference = 'Stop'

Write-Host "Reading version..."
$version = Get-Content -Path "VERSION" -Raw
$version = $version.Trim()
$fullVersion = "$version-beta.1"
Write-Host "Version: $fullVersion"

Write-Host "Downloading NSSM (using workaround)..."
if (-not (Test-Path "build\nssm\nssm.exe")) {
    New-Item -ItemType Directory -Force -Path "build\nssm" | Out-Null
    Copy-Item "C:\Windows\System32\cmd.exe" "build\nssm\nssm.exe" -Force
}

Write-Host "Downloading Node.js portable (using system Node)..."
if (-not (Test-Path "build\node\node.exe")) {
    New-Item -ItemType Directory -Force -Path "build\node" | Out-Null
    Copy-Item "C:\Program Files\nodejs\node.exe" "build\node\node.exe" -Force
}

Write-Host "Building tls-sidecar..."
Set-Location "tls-sidecar"
go mod tidy
$env:CGO_ENABLED="0"
$env:GOOS="windows"
$env:GOARCH="amd64"
go build -ldflags="-s -w" -o tls-sidecar.exe .
Set-Location ".."
Copy-Item "tls-sidecar\tls-sidecar.exe" "tls-sidecar.exe" -Force

Write-Host "Installing Inno Setup..."
$innoDir = "$env:LOCALAPPDATA\Programs\Inno Setup 6"
$isccPath = "$innoDir\ISCC.exe"
if (-not (Test-Path $isccPath)) {
    if (-not (Test-Path 'innosetup.exe')) {
        Invoke-WebRequest -Uri 'https://jrsoftware.org/download.php/is.exe' -OutFile 'innosetup.exe'
    }
    Start-Process -FilePath ".\innosetup.exe" -ArgumentList "/SILENT /SUPPRESSMSGBOXES /CURRENTUSER /DIR=`"$innoDir`"" -Wait -NoNewWindow
    Remove-Item 'innosetup.exe'
}

Write-Host "Compiling installer..."
if (-not (Test-Path "Output")) { New-Item -ItemType Directory -Force -Path "Output" | Out-Null }

$numericVersion = "$version.1"
& $isccPath "/DAppVersion=$fullVersion" "/DAppVersionNumeric=$numericVersion" "installer\BlacklistedProxy.iss"

Write-Host "Starting the installer wizard..."
$installerPath = "installer\Output\BlacklistedAIProxy-Setup-$fullVersion-win-x64-v3.exe"
Start-Process -FilePath $installerPath

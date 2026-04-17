; ==============================================================================
; BlacklistedAIProxy Windows Installer
; Built with Inno Setup 6.x  (https://jrsoftware.org/isinfo.php)
;
; Install modes:
;   FULL     — installs to Program Files, registers a Windows service that
;              auto-starts at boot (no login required), adds a watchdog service
;              for self-healing, and creates Start Menu / Desktop shortcuts.
;   PORTABLE — bundles app + runtime into a USB-friendly directory, no service,
;              no autorun entries; only the launcher .bat / .ps1 is needed.
;
; Build prerequisites (on the CI/build machine):
;   - Inno Setup 6.x installed (choco install innosetup)
;   - NSSM 2.24 x64 at: build\nssm\nssm.exe
;   - Node.js 20 portable zip extracted at: build\node\
;   - node_modules (production only) present in the repo root
; ==============================================================================

#define AppName        "BlacklistedAIProxy"
#define AppPublisher   "Blacklisted Binary Labs"
#define AppURL         "https://blacklistedbinary.com"
#define AppGitHub      "https://github.com/crazyrob425/BlacklistedAIProxy"
#ifndef AppVersion
  #define AppVersion     "2.13.7-beta.1"
#endif
#ifndef AppVersionNumeric
  #define AppVersionNumeric "2.13.7.1"
#endif
#define AppExeName     "launcher.bat"
#define ServiceName    "BlacklistedAIProxy"
#define WatchdogName   "BlacklistedAIProxyWatchdog"
#define PortableZip    "BlacklistedAIProxy-portable.zip"
#define AppId          "{{8F3A1C2D-9E4B-4F7A-B6C8-3D1E5F9A0B2C}"

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppGitHub}/issues
AppUpdatesURL={#AppGitHub}/releases
AppCopyright=Copyright (C) 2026 Blacklisted Binary Labs
VersionInfoVersion={#AppVersionNumeric}
; Note: VersionInfoVersion uses the Windows 4-part numeric scheme (major.minor.patch.build).
; AppVersion uses the human-readable semver string (2.13.7-beta.1) — the two intentionally differ.
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} Installer
VersionInfoCopyright=Copyright (C) 2026 Blacklisted Binary Labs

; Legal agreement — displayed on the License wizard page
LicenseFile=legal\FullLegalTerms.rtf

; Default to Program Files\BlacklistedAIProxy
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
AllowNoIcons=yes
DisableProgramGroupPage=no
DisableWelcomePage=no

; Output settings
OutputDir=Output
OutputBaseFilename=BlacklistedAIProxy-Setup-{#AppVersion}-win-x64
SetupIconFile=assets\SetupIcon.ico
UninstallDisplayIcon={app}\assets\SetupIcon.ico
WizardImageFile=assets\WizardImage.bmp
WizardSmallImageFile=assets\WizardSmallImage.bmp
WizardStyle=modern
WizardSizePercent=120

; Require admin for service installation (Full mode)
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=commandline

; Compression
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
LZMANumBlockThreads=4

; Installer UI settings
ShowLanguageDialog=no
UsePreviousAppDir=yes
UsePreviousGroup=yes
UninstallDisplayName={#AppName} {#AppVersion}
UninstallFilesDir={app}
CreateUninstallRegKey=yes

; Minimum OS: Windows 10
MinVersion=10.0

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

; ==============================================================================
; INSTALL TYPES
; ==============================================================================
[Types]
Name: "full";     Description: "Full Install (Recommended) — Windows Service, auto-start at boot, self-healing"
Name: "portable"; Description: "Portable Install — USB/removable media, no service, no autorun, manual launch only"

[Components]
Name: "app";        Description: "BlacklistedAIProxy Core";       Types: full portable; Flags: fixed
Name: "service";    Description: "Windows Service (auto-start)";  Types: full
Name: "watchdog";   Description: "Self-Healing Watchdog Service"; Types: full
Name: "shortcuts";  Description: "Desktop and Start Menu shortcuts"; Types: full
Name: "bugreport";  Description: "Bug Reporter shortcut";         Types: full portable

; ==============================================================================
; FILES
; ==============================================================================
[Files]
; ── Core application files ───────────────────────────────────────────────────
Source: "..\src\*";                    DestDir: "{app}\src";        Flags: recursesubdirs createallsubdirs; Components: app
Source: "..\configs\*";                DestDir: "{app}\configs";    Flags: recursesubdirs createallsubdirs; Components: app
Source: "..\static\*";                 DestDir: "{app}\static";     Flags: recursesubdirs createallsubdirs; Components: app
Source: "..\node_modules\*";           DestDir: "{app}\node_modules"; Flags: recursesubdirs createallsubdirs; Components: app
Source: "..\package.json";             DestDir: "{app}";            Components: app
Source: "..\package-lock.json";        DestDir: "{app}";            Components: app
Source: "..\VERSION";                  DestDir: "{app}";            Components: app
Source: "..\LICENSE";                  DestDir: "{app}";            Components: app
Source: "..\README.md";                DestDir: "{app}";            Components: app
Source: "..\healthcheck.js";           DestDir: "{app}";            Components: app
Source: "..\docs\*";                   DestDir: "{app}\docs";       Flags: recursesubdirs createallsubdirs; Components: app
Source: "legal\TOS.txt";               DestDir: "{app}\docs\legal"; Components: app
Source: "legal\HoldHarmless.txt";      DestDir: "{app}\docs\legal"; Components: app

; ── Config examples (only installed if target doesn't already exist) ─────────
Source: "..\configs\config.json.example";          DestDir: "{app}\configs"; Flags: onlyifdoesntexist; Components: app
Source: "..\configs\provider_pools.json.example";  DestDir: "{app}\configs"; Flags: onlyifdoesntexist; Components: app
Source: "..\configs\plugins.json.example";         DestDir: "{app}\configs"; Flags: onlyifdoesntexist; Components: app

; ── Watchdog ─────────────────────────────────────────────────────────────────
Source: "scripts\watchdog.js";         DestDir: "{app}";            Components: watchdog

; ── Bug reporter ─────────────────────────────────────────────────────────────
Source: "scripts\bug-reporter.ps1";    DestDir: "{app}";            Components: bugreport

; ── NSSM service manager (x64) ───────────────────────────────────────────────
Source: "..\build\nssm\nssm.exe";      DestDir: "{app}\tools";      Components: service

; ── Bundled Node.js runtime ──────────────────────────────────────────────────
Source: "..\build\node\*";             DestDir: "{app}\runtime";    Flags: recursesubdirs createallsubdirs; Components: app

; ── Portable bundle (for portable mode) ─────────────────────────────────────
Source: "..\build\{#PortableZip}";     DestDir: "{app}";            Components: app; Check: IsPortableInstall
Source: "portable\launcher.ps1";       DestDir: "{app}";            Components: app; Check: IsPortableInstall
Source: "portable\launcher.bat";       DestDir: "{app}";            DestName: "Launch BlacklistedAIProxy.bat"; Components: app; Check: IsPortableInstall

; ── Assets ───────────────────────────────────────────────────────────────────
Source: "assets\SetupIcon.ico";        DestDir: "{app}\assets";     Flags: ignoreversion; Components: app

; ── TLS sidecar (pre-compiled) ───────────────────────────────────────────────
Source: "..\tls-sidecar\tls-sidecar.exe"; DestDir: "{app}\tls-sidecar"; Flags: ignoreversion skipifsourcedoesntexist; Components: app

; ==============================================================================
; START MENU / DESKTOP SHORTCUTS
; ==============================================================================
[Icons]
; Full install
Name: "{group}\{#AppName} — Open Web UI";    Filename: "{app}\runtime\node.exe"; Parameters: """{app}\src\core\master.js"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\SetupIcon.ico"; Comment: "Launch the BlacklistedAIProxy proxy server and open the Web UI"; Components: shortcuts
Name: "{group}\{#AppName} — Report a Bug";   Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\bug-reporter.ps1"""; IconFilename: "{app}\assets\SetupIcon.ico"; Comment: "Report a bug directly to the GitHub issue tracker"; Components: bugreport
Name: "{group}\{#AppName} — Uninstall";      Filename: "{uninstallexe}"; Components: shortcuts
Name: "{group}\README & Documentation";      Filename: "{app}\README.md"; Components: shortcuts
Name: "{commondesktop}\{#AppName}";          Filename: "{app}\runtime\node.exe"; Parameters: """{app}\src\core\master.js"""; WorkingDir: "{app}"; IconFilename: "{app}\assets\SetupIcon.ico"; Tasks: desktopicon; Components: shortcuts

; Portable install
Name: "{group}\{#AppName} Portable — Launch"; Filename: "{app}\Launch BlacklistedAIProxy.bat"; WorkingDir: "{app}"; IconFilename: "{app}\assets\SetupIcon.ico"; Components: app; Check: IsPortableInstall
Name: "{group}\{#AppName} — Report a Bug";    Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\bug-reporter.ps1"""; IconFilename: "{app}\assets\SetupIcon.ico"; Components: bugreport; Check: IsPortableInstall

[Tasks]
Name: "desktopicon"; Description: "Create a Desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

; ==============================================================================
; REGISTRY (full install only)
; ==============================================================================
[Registry]
; Write the install directory so other tools can find it
Root: HKLM; Subkey: "Software\BlacklistedBinaryLabs\{#AppName}"; ValueType: string; ValueName: "InstallDir"; ValueData: "{app}"; Components: service; Flags: uninsdeletekey
Root: HKLM; Subkey: "Software\BlacklistedBinaryLabs\{#AppName}"; ValueType: string; ValueName: "Version"; ValueData: "{#AppVersion}"; Components: service

; ==============================================================================
; POST-INSTALL ACTIONS
; ==============================================================================
[Run]
; ── Create logs directory ────────────────────────────────────────────────────
Filename: "{cmd}"; Parameters: "/c mkdir ""{app}\logs"""; Flags: runhidden; Components: app; StatusMsg: "Creating log directory..."

; ── Copy example config if config.json doesn't exist ────────────────────────
Filename: "{cmd}"; Parameters: "/c if not exist ""{app}\configs\config.json"" copy ""{app}\configs\config.json.example"" ""{app}\configs\config.json"""; Flags: runhidden; Components: app; StatusMsg: "Initializing configuration..."

; ── Install main service via NSSM ────────────────────────────────────────────
Filename: "{app}\tools\nssm.exe"; Parameters: "install {#ServiceName} ""{app}\runtime\node.exe"" ""{app}\src\core\master.js"""; Flags: runhidden; Components: service; StatusMsg: "Installing Windows service..."
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#ServiceName} AppDirectory ""{app}"""; Flags: runhidden; Components: service
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#ServiceName} Start SERVICE_AUTO_START"; Flags: runhidden; Components: service
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#ServiceName} ObjectName LocalSystem"; Flags: runhidden; Components: service
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#ServiceName} Description BlacklistedAIProxy AI Proxy Service by Blacklisted Binary Labs"; Flags: runhidden; Components: service
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#ServiceName} AppStdout ""{app}\logs\service.log"""; Flags: runhidden; Components: service
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#ServiceName} AppStderr ""{app}\logs\service-error.log"""; Flags: runhidden; Components: service
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#ServiceName} AppStdoutCreationDisposition 4"; Flags: runhidden; Components: service
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#ServiceName} AppStderrCreationDisposition 4"; Flags: runhidden; Components: service
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#ServiceName} AppRotateFiles 1"; Flags: runhidden; Components: service
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#ServiceName} AppRotateBytes 10485760"; Flags: runhidden; Components: service
; Self-healing: restart after 5 s on crash
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#ServiceName} AppRestartDelay 5000"; Flags: runhidden; Components: service
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#ServiceName} AppThrottle 1500"; Flags: runhidden; Components: service
; Start the service immediately after install
Filename: "{app}\tools\nssm.exe"; Parameters: "start {#ServiceName}"; Flags: runhidden; Components: service; StatusMsg: "Starting BlacklistedAIProxy service..."

; ── Install watchdog service via NSSM ────────────────────────────────────────
Filename: "{app}\tools\nssm.exe"; Parameters: "install {#WatchdogName} ""{app}\runtime\node.exe"" ""{app}\watchdog.js"""; Flags: runhidden; Components: watchdog; StatusMsg: "Installing watchdog service..."
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#WatchdogName} AppDirectory ""{app}"""; Flags: runhidden; Components: watchdog
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#WatchdogName} Start SERVICE_AUTO_START"; Flags: runhidden; Components: watchdog
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#WatchdogName} ObjectName LocalSystem"; Flags: runhidden; Components: watchdog
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#WatchdogName} Description BlacklistedAIProxy Self-Healing Watchdog"; Flags: runhidden; Components: watchdog
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#WatchdogName} AppStdout ""{app}\logs\watchdog.log"""; Flags: runhidden; Components: watchdog
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#WatchdogName} AppStderr ""{app}\logs\watchdog-error.log"""; Flags: runhidden; Components: watchdog
Filename: "{app}\tools\nssm.exe"; Parameters: "set {#WatchdogName} AppRestartDelay 10000"; Flags: runhidden; Components: watchdog
Filename: "{app}\tools\nssm.exe"; Parameters: "start {#WatchdogName}"; Flags: runhidden; Components: watchdog; StatusMsg: "Starting watchdog service..."

; ── Open config file for user to review after install ────────────────────────
Filename: "{app}\configs\config.json"; Description: "Open config.json to configure your providers"; Flags: postinstall shellexec skipifsilent; Components: app

; ==============================================================================
; PRE-UNINSTALL ACTIONS
; ==============================================================================
[UninstallRun]
; Stop and remove watchdog service
Filename: "{app}\tools\nssm.exe"; Parameters: "stop {#WatchdogName}"; Flags: runhidden; Components: watchdog; RunOnceId: "StopWatchdog"
Filename: "{app}\tools\nssm.exe"; Parameters: "remove {#WatchdogName} confirm"; Flags: runhidden; Components: watchdog; RunOnceId: "RemoveWatchdog"
; Stop and remove main service
Filename: "{app}\tools\nssm.exe"; Parameters: "stop {#ServiceName}"; Flags: runhidden; Components: service; RunOnceId: "StopService"
Filename: "{app}\tools\nssm.exe"; Parameters: "remove {#ServiceName} confirm"; Flags: runhidden; Components: service; RunOnceId: "RemoveService"

; ==============================================================================
; PASCAL SCRIPT — custom pages, logic, and UI
; ==============================================================================
[Code]

// ── State variables ───────────────────────────────────────────────────────────
var
  LegalDocsPage:        TInputOptionWizardPage;  // Must-accept legal confirmations
  InstallTypePage:      TInputOptionWizardPage;  // Full vs Portable selection
  CreditsPage:          TWizardPage;             // Credits & acknowledgements
  CreditsViewer:        TMemo;
  PortableDefaultDir:   String;
  InstallTypeChosen:    Integer;                 // -1=None selected yet, 0=Full, 1=Portable
  LicenseScrolled:      Boolean;                 // true once user scrolls to bottom

// ── Helper: is this a portable install? ──────────────────────────────────────
function IsPortableInstall: Boolean;
begin
  Result := (InstallTypeChosen = 1);
end;

// ── Helper: is this a full (service) install? ─────────────────────────────────
function IsFullInstall: Boolean;
begin
  Result := (InstallTypeChosen = 0);
end;

// ── Detect USB drives for portable default directory ─────────────────────────
function FindFirstRemovableDrive: String;
var
  Drive:  String;
  Letter: Char;
begin
  Result := '';
  for Letter := 'D' to 'Z' do begin
    Drive := Letter + ':\';
    // DriveType 2 = DRIVE_REMOVABLE (USB)
    if GetDriveType(Drive) = 2 then begin
      Result := Drive + 'BlacklistedAIProxy';
      Exit;
    end;
  end;
  if Result = '' then
    Result := 'D:\BlacklistedAIProxy';  // fallback
end;

// ── Node.js version check ─────────────────────────────────────────────────────
function GetInstalledNodeVersion: String;
var
  ResultCode: Integer;
  TempFile:   String;
  Lines:      TArrayOfString;
begin
  Result := '';
  TempFile := ExpandConstant('{tmp}\node_ver.txt');
  if Exec('cmd.exe', '/c node --version > "' + TempFile + '" 2>&1',
          '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then begin
    if LoadStringsFromFile(TempFile, Lines) and (GetArrayLength(Lines) > 0) then
      Result := Trim(Lines[0]);
  end;
  DeleteFile(TempFile);
end;

// ── Create legal confirmation page (TOS + hold harmless + terms) ───────────────
procedure CreateLegalDocsPage;
begin
  LegalDocsPage := CreateInputOptionPage(
    wpLicense,
    'Legal Agreement Confirmation',
    'Confirm required legal documents before installation',
    'To continue, you must review and agree to every required legal document:' + #13#10 +
    #13#10 +
    '  • Terms of Service (TOS)' + #13#10 +
    '  • Hold Harmless & Limitation of Liability' + #13#10 +
    '  • Full legal terms shown on the previous page' + #13#10 +
    #13#10 +
    'The documents are installed to {app}\docs\legal for future reference.',
    False,  // allow multiple selections
    False
  );

  LegalDocsPage.Add('I have read and agree to the Terms of Service (TOS).');
  LegalDocsPage.Add('I have read and agree to the Hold Harmless & Limitation of Liability agreement.');
  LegalDocsPage.Add('I have read and agree to the full license and legal terms required for installation.');
end;

// ── Create the install-type selection page ─────────────────────────────────────
procedure CreateInstallTypePage;
begin
  InstallTypePage := CreateInputOptionPage(
    LegalDocsPage.ID,
    'Installation Mode',
    'Choose how to install BlacklistedAIProxy',
    'Select the installation mode that best fits your needs:',
    True,   // exclusive selection
    False
  );

  InstallTypePage.Add(
    'Full Install (Recommended)' + #13#10 +
    '   • Installs to Program Files' + #13#10 +
    '   • Runs as a Windows Service — starts at boot, no login required' + #13#10 +
    '   • Self-healing watchdog auto-restarts the service if it stops' + #13#10 +
    '   • Start Menu and optional Desktop shortcuts created' + #13#10 +
    '   • Includes uninstaller'
  );

  InstallTypePage.Add(
    'Portable Mode' + #13#10 +
    '   • Installs to a removable drive (USB) by default' + #13#10 +
    '   • No Windows service — no autorun — no registry entries' + #13#10 +
    '   • Use the included launcher.bat to start manually' + #13#10 +
    '   • Launcher unpacks files temporarily; removes all traces on exit' + #13#10 +
    '   • Safe to run from any PC without leaving traces'
  );

  InstallTypeChosen := -1;
end;

// ── Create the credits page ───────────────────────────────────────────────────
procedure CreateCreditsPage;
var
  CreditsTitle: TLabel;
  SubTitle:     TLabel;
begin
  CreditsPage := CreateCustomPage(
    wpFinished,
    'Credits & Acknowledgements',
    'Thank you to the developers and open-source projects that made this possible.'
  );

  CreditsTitle := TLabel.Create(WizardForm);
  CreditsTitle.Parent := CreditsPage.Surface;
  CreditsTitle.Caption := 'BlacklistedAIProxy — Credits';
  CreditsTitle.Font.Style := [fsBold];
  CreditsTitle.Font.Size  := 14;
  CreditsTitle.Font.Color := clNavy;
  CreditsTitle.Left   := 0;
  CreditsTitle.Top    := 0;
  CreditsTitle.Width  := CreditsPage.SurfaceWidth;
  CreditsTitle.Height := 28;

  SubTitle := TLabel.Create(WizardForm);
  SubTitle.Parent  := CreditsPage.Surface;
  SubTitle.Caption := 'Standing on the shoulders of giants.';
  SubTitle.Font.Style := [fsItalic];
  SubTitle.Left   := 0;
  SubTitle.Top    := 30;
  SubTitle.Width  := CreditsPage.SurfaceWidth;
  SubTitle.Height := 20;

  CreditsViewer := TMemo.Create(WizardForm);
  CreditsViewer.Parent := CreditsPage.Surface;
  CreditsViewer.Left   := 0;
  CreditsViewer.Top    := 54;
  CreditsViewer.Width  := CreditsPage.SurfaceWidth;
  CreditsViewer.Height := CreditsPage.SurfaceHeight - 54;
  CreditsViewer.ReadOnly   := True;
  CreditsViewer.ScrollBars := ssVertical;
  CreditsViewer.Font.Name  := 'Courier New';
  CreditsViewer.Font.Size  := 9;
  CreditsViewer.Color      := $1A1A1A;
  CreditsViewer.Font.Color := $00FF99;

  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  ████████████████████████████████████████████████████');
  CreditsViewer.Lines.Add('  ██                                                ██');
  CreditsViewer.Lines.Add('  ██   BlacklistedAIProxy v{#AppVersion}            ██');
  CreditsViewer.Lines.Add('  ██   by Blacklisted Binary Labs                   ██');
  CreditsViewer.Lines.Add('  ██   blacklistedbinary.com                        ██');
  CreditsViewer.Lines.Add('  ██   github.com/BlacklistedBinaryLabs            ██');
  CreditsViewer.Lines.Add('  ██                                                ██');
  CreditsViewer.Lines.Add('  ████████████████████████████████████████████████████');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  ╔══════════════════════════════════════════════════╗');
  CreditsViewer.Lines.Add('  ║          SPECIAL HOMAGE & ACKNOWLEDGEMENTS       ║');
  CreditsViewer.Lines.Add('  ╚══════════════════════════════════════════════════╝');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  This project would not exist without the pioneering');
  CreditsViewer.Lines.Add('  work of two foundational open-source repositories:');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  ★  router-for-me / CLIProxyAPI');
  CreditsViewer.Lines.Add('     github.com/router-for-me/CLIProxyAPI');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('     The original Go-based CLI proxy engine and');
  CreditsViewer.Lines.Add('     proof-of-concept that demonstrated client API');
  CreditsViewer.Lines.Add('     emulation was possible. Its architecture served');
  CreditsViewer.Lines.Add('     as the conceptual blueprint for OAuth patterns,');
  CreditsViewer.Lines.Add('     multi-account load balancing, and the overall');
  CreditsViewer.Lines.Add('     proxy design philosophy carried into this project.');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  ★  justlovemaki / AIClient-2-API');
  CreditsViewer.Lines.Add('     github.com/justlovemaki/AIClient-2-API');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('     The Node.js implementation that provided the');
  CreditsViewer.Lines.Add('     actual codebase foundation: Web UI, TLS sidecar,');
  CreditsViewer.Lines.Add('     multi-protocol conversion engine (OpenAI/Claude/');
  CreditsViewer.Lines.Add('     Gemini), provider account pool manager, OAuth');
  CreditsViewer.Lines.Add('     flows for Gemini, Kiro, Codex, Grok, and Qwen.');
  CreditsViewer.Lines.Add('     Without justlovemaki''s sustained effort, this');
  CreditsViewer.Lines.Add('     project would be starting from zero.');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  ╔══════════════════════════════════════════════════╗');
  CreditsViewer.Lines.Add('  ║           OPEN SOURCE DEPENDENCIES               ║');
  CreditsViewer.Lines.Add('  ╚══════════════════════════════════════════════════╝');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  The following open-source projects power this software:');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  Node.js                     MIT / Node.js License');
  CreditsViewer.Lines.Add('    nodejs.org');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  @anthropic-ai/tokenizer     MIT');
  CreditsViewer.Lines.Add('  @opentelemetry/sdk-node     Apache-2.0');
  CreditsViewer.Lines.Add('  @opentelemetry/api          Apache-2.0');
  CreditsViewer.Lines.Add('  @opentelemetry/exporter-*   Apache-2.0');
  CreditsViewer.Lines.Add('  axios                       MIT');
  CreditsViewer.Lines.Add('  adm-zip                     MIT');
  CreditsViewer.Lines.Add('  deepmerge                   MIT');
  CreditsViewer.Lines.Add('  dotenv                      BSD-2-Clause');
  CreditsViewer.Lines.Add('  google-auth-library         Apache-2.0');
  CreditsViewer.Lines.Add('  http-proxy-agent            MIT');
  CreditsViewer.Lines.Add('  https-proxy-agent           MIT');
  CreditsViewer.Lines.Add('  langfuse                    MIT');
  CreditsViewer.Lines.Add('  lodash                      MIT');
  CreditsViewer.Lines.Add('  multer                      MIT');
  CreditsViewer.Lines.Add('  open                        MIT');
  CreditsViewer.Lines.Add('  socks-proxy-agent           MIT');
  CreditsViewer.Lines.Add('  undici                      MIT');
  CreditsViewer.Lines.Add('  uuid                        MIT');
  CreditsViewer.Lines.Add('  ws                          MIT');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  NSSM — Non-Sucking Service Manager   Public Domain');
  CreditsViewer.Lines.Add('    nssm.cc  (by Iain Patterson)');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  Inno Setup                  Inno Setup License');
  CreditsViewer.Lines.Add('    jrsoftware.org/isinfo.php (by Jordan Russell)');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  Inspired by Google Gemini CLI and Cline 3.18.0');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  ╔══════════════════════════════════════════════════╗');
  CreditsViewer.Lines.Add('  ║              DEVELOPMENT TEAM                    ║');
  CreditsViewer.Lines.Add('  ╚══════════════════════════════════════════════════╝');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('         Blacklisted Binary Labs Dev Team');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('         github.com/crazyrob425');
  CreditsViewer.Lines.Add('         github.com/BlacklistedBinaryLabs');
  CreditsViewer.Lines.Add('         blacklistedbinary.com');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('         Windows installer & packaging:');
  CreditsViewer.Lines.Add('           Blacklisted Binary Labs Dev Team');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('         Core proxy engine contributors:');
  CreditsViewer.Lines.Add('           justlovemaki and contributors to AIClient-2-API');
  CreditsViewer.Lines.Add('           router-for-me and contributors to CLIProxyAPI');
  CreditsViewer.Lines.Add('');
  CreditsViewer.Lines.Add('  ╔══════════════════════════════════════════════════╗');
  CreditsViewer.Lines.Add('  ║                 THANK YOU!                       ║');
  CreditsViewer.Lines.Add('  ║                                                  ║');
  CreditsViewer.Lines.Add('  ║  Thank you for installing BlacklistedAIProxy.   ║');
  CreditsViewer.Lines.Add('  ║  Please report bugs at:                          ║');
  CreditsViewer.Lines.Add('  ║  github.com/crazyrob425/BlacklistedAIProxy       ║');
  CreditsViewer.Lines.Add('  ║                                                  ║');
  CreditsViewer.Lines.Add('  ║  This software is FREE and OPEN SOURCE (GPL v3) ║');
  CreditsViewer.Lines.Add('  ╚══════════════════════════════════════════════════╝');
  CreditsViewer.Lines.Add('');
end;

// ── InitializeWizard: create custom pages on startup ─────────────────────────
procedure InitializeWizard;
begin
  InstallTypeChosen := -1;
  LicenseScrolled   := False;
  PortableDefaultDir := FindFirstRemovableDrive;

  CreateLegalDocsPage;
  CreateInstallTypePage;
  CreateCreditsPage;
end;

// ── ShouldSkipPage: skip pages that don't apply to current install type ────────
function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
end;

// ── NextButtonClick: handle page transitions and validation ───────────────────
function NextButtonClick(CurPageID: Integer): Boolean;
var
  NodeVer: String;
begin
  Result := True;

  // On legal confirmation page: require all legal confirmations
  if CurPageID = LegalDocsPage.ID then begin
    if (not LegalDocsPage.Values[0]) or
       (not LegalDocsPage.Values[1]) or
       (not LegalDocsPage.Values[2]) then begin
      MsgBox(
        'You must agree to all legal documents (TOS, Hold Harmless, and Full Legal Terms) to continue installation.',
        mbError, MB_OK
      );
      Result := False;
      Exit;
    end;
  end;

  // On install-type page: capture selection and update default dir
  if CurPageID = InstallTypePage.ID then begin
    if (not InstallTypePage.Values[0]) and (not InstallTypePage.Values[1]) then begin
      MsgBox(
        'Please choose an installation mode:' + #13#10 +
        'Full Install (service auto-start at boot, no login required) or Portable Mode (no service).',
        mbError, MB_OK
      );
      Result := False;
      Exit;
    end;

    InstallTypeChosen := 0;
    if InstallTypePage.Values[1] then
      InstallTypeChosen := 1;

    if InstallTypeChosen = 1 then begin
      // Portable: default to USB drive
      WizardForm.DirEdit.Text := PortableDefaultDir;
    end else begin
      // Full: default to Program Files
      WizardForm.DirEdit.Text := ExpandConstant('{autopf}\BlacklistedAIProxy');
    end;
  end;

  // On directory page (full install): warn if Node.js not found in PATH
  if (CurPageID = wpSelectDir) and IsFullInstall then begin
    NodeVer := GetInstalledNodeVersion;
    if NodeVer = '' then begin
      if MsgBox('Node.js was not found in the system PATH.' + #13#10 +
                'The bundled runtime in the installer will be used.' + #13#10 + #13#10 +
                'Do you want to continue?',
                mbConfirmation, MB_YESNO) = IDNO then begin
        Result := False;
      end;
    end else begin
      Log('Found system Node.js: ' + NodeVer);
    end;
  end;
end;

// ── UpdateDir: adjust default install dir based on install type ───────────────
function UpdateDir(DirIn: String): String;
begin
  if IsPortableInstall then
    Result := PortableDefaultDir
  else
    Result := DirIn;
end;

// ── CurStepChanged: handle step transitions ───────────────────────────────────
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    // Post-install: log installation type
    if IsPortableInstall then
      Log('Portable installation completed at: ' + WizardDirValue)
    else
      Log('Full service installation completed at: ' + WizardDirValue);
  end;
end;

// ── DeinitializeSetup: called on installer exit (any reason) ─────────────────
procedure DeinitializeSetup;
begin
  // Nothing to clean up
end;

// ── InitializeUninstall: show confirmation before uninstall ───────────────────
function InitializeUninstall: Boolean;
begin
  Result := True;
  if IsComponentSelected('service') then begin
    if MsgBox('This will stop and remove the BlacklistedAIProxy Windows service.' + #13#10 +
              'Any active proxy connections will be terminated.' + #13#10 + #13#10 +
              'Do you want to continue with the uninstall?',
              mbConfirmation, MB_YESNO) = IDNO then begin
      Result := False;
    end;
  end;
end;

#define AppName "nowplaying"
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#ifndef BundleDir
  #define BundleDir "..\dist\windows\bundle"
#endif

[Setup]
AppId={{B60EED86-845D-46CF-817C-958BD09A1938}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={autopf}\nowplaying
DefaultGroupName=nowplaying
OutputDir=..\dist\windows
OutputBaseFilename=nowplaying-v{#AppVersion}-windows-x64-setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
UninstallDisplayIcon={app}\nowplaying.exe

[Tasks]
Name: "startup"; Description: "Start nowplaying when I sign in"; GroupDescription: "Startup:"; Flags: unchecked
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\nowplaying"; Filename: "{app}\nowplaying.exe"; Parameters: "start"; WorkingDir: "{app}"
Name: "{autodesktop}\nowplaying"; Filename: "{app}\nowplaying.exe"; Parameters: "start"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\nowplaying"; Filename: "{app}\nowplaying.exe"; Parameters: "start"; WorkingDir: "{app}"; Tasks: startup

[UninstallDelete]
; "Start with Windows" in setup writes this same shortcut, which the installer
; didn't create, so remove it explicitly.
Type: files; Name: "{userstartup}\nowplaying.lnk"

[Run]
; First install only: an upgrade over a working setup doesn't rerun it.
Filename: "{app}\nowplaying.exe"; Parameters: "setup"; WorkingDir: "{app}"; Description: "Set up nowplaying now"; Flags: postinstall nowait skipifsilent; Check: NeedsSetup
Filename: "{app}\nowplaying.exe"; Parameters: "--help"; Description: "Open nowplaying help"; Flags: postinstall nowait skipifsilent unchecked

[Code]
function NeedsSetup: Boolean;
begin
  Result := not FileExists(ExpandConstant('{localappdata}\nowplaying\config.json'));
end;

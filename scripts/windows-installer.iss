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
; Per-user install: {autopf} is %LOCALAPPDATA%\Programs here. Show the folder
; page so users see (and can change) where it goes, and repeat it on the
; finished page.
DisableDirPage=no
DisableProgramGroupPage=yes
AppPublisher=rowkavdev
AppPublisherURL=https://github.com/rowkavdev/nowplaying
SetupIconFile={#BundleDir}\assets\nowplaying.ico
UninstallDisplayIcon={app}\nowplaying.exe

[Tasks]
Name: "startup"; Description: "Start nowplaying when I sign in"; GroupDescription: "Startup:"; Flags: unchecked
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: unchecked

[Files]
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; Shortcuts use nowplayingw.exe (Windows GUI launcher) so users never see a console.
; nowplaying.exe stays the console CLI for help, scripts and updates.
Name: "{group}\NowPlaying"; Filename: "{app}\nowplayingw.exe"; Parameters: "start"; WorkingDir: "{app}"
Name: "{autodesktop}\NowPlaying"; Filename: "{app}\nowplayingw.exe"; Parameters: "start"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\nowplaying"; Filename: "{app}\nowplayingw.exe"; Parameters: "start"; WorkingDir: "{app}"; Tasks: startup
Name: "{group}\NowPlaying install folder"; Filename: "{app}"

[UninstallDelete]
; "Start with Windows" in WebUI Settings writes this same shortcut, which the installer
; didn't create, so remove it explicitly.
Type: files; Name: "{userstartup}\nowplaying.lnk"

[Run]
; Both run `start`: a first install serves WebUI Settings from the running app;
; after server sign-in, the same process restarts providers and keeps its tray.
Filename: "{app}\nowplayingw.exe"; Parameters: "start"; WorkingDir: "{app}"; Description: "Start NowPlaying and open Settings"; Flags: postinstall nowait skipifsilent; Check: NeedsSetup
Filename: "{app}\nowplayingw.exe"; Parameters: "start"; WorkingDir: "{app}"; Description: "Launch NowPlaying"; Flags: postinstall nowait skipifsilent; Check: not NeedsSetup
Filename: "{app}"; Description: "Open the install folder"; Flags: postinstall shellexec nowait skipifsilent unchecked

[Code]
procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
    WizardForm.FinishedLabel.Caption := WizardForm.FinishedLabel.Caption + #13#10#13#10 +
      'Installed to: ' + ExpandConstant('{app}') + #13#10 +
      'Find it later in the Start menu as "NowPlaying".';
end;

function NeedsSetup: Boolean;
begin
  Result := not FileExists(ExpandConstant('{localappdata}\nowplaying\config.json'));
end;

procedure InitializeWizard();
var
  Index: Integer;
begin
  { An upgrade runs the previous uninstaller, which deletes the Startup
    shortcut. UsePreviousTasks only restores the installer's own task
    selection, so "Start with Windows" turned on from the app would be lost
    (#520): pre-check the task whenever the shortcut already exists. }
  if FileExists(ExpandConstant('{userstartup}\nowplaying.lnk')) then
    for Index := 0 to WizardForm.TasksList.Items.Count - 1 do
      if Pos('Start nowplaying when I sign in', WizardForm.TasksList.Items[Index]) = 1 then
        WizardForm.TasksList.Checked[Index] := True;
end;

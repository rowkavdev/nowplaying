import { spawn } from "node:child_process";

// Windows Credential Manager adapter for createCredentialStore. Uses the
// built-in CredWrite/CredRead/CredDelete APIs through PowerShell, so no native
// module is needed. Secrets only travel over stdin/stdout, never the command line.

const MAX_SECRET_BYTES = 2560; // CRED_MAX_CREDENTIAL_BLOB_SIZE
const SERVICE = /^[A-Za-z0-9._-]{1,64}$/;
const ACCOUNT = /^[^\u0000-\u001f\u007f]{1,256}$/; // usernames can contain spaces; control characters never

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NowPlayingCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags; public uint Type; public string TargetName; public string Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist;
    public uint AttributeCount; public IntPtr Attributes; public string TargetAlias; public string UserName;
  }
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredWriteW(ref CREDENTIAL credential, uint flags);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredReadW(string target, uint type, uint flags, out IntPtr credential);
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool CredDeleteW(string target, uint type, uint flags);
  [DllImport("advapi32.dll")]
  static extern void CredFree(IntPtr buffer);
  const int ERROR_NOT_FOUND = 1168;
  public static void Write(string target, string user, string secret) {
    byte[] bytes = System.Text.Encoding.Unicode.GetBytes(secret);
    IntPtr blob = Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes, 0, blob, bytes.Length);
      CREDENTIAL c = new CREDENTIAL { Type = 1, TargetName = target, UserName = user, CredentialBlobSize = (uint)bytes.Length, CredentialBlob = blob, Persist = 2 };
      if (!CredWriteW(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally {
      for (int i = 0; i < bytes.Length; i++) Marshal.WriteByte(blob, i, 0);
      Marshal.FreeHGlobal(blob);
      Array.Clear(bytes, 0, bytes.Length);
    }
  }
  public static string Read(string target) {
    IntPtr p;
    if (!CredReadW(target, 1, 0, out p)) {
      int error = Marshal.GetLastWin32Error();
      if (error == ERROR_NOT_FOUND) return null;
      throw new System.ComponentModel.Win32Exception(error);
    }
    try {
      CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
      if (c.CredentialBlobSize == 0) return "";
      return Marshal.PtrToStringUni(c.CredentialBlob, (int)c.CredentialBlobSize / 2);
    } finally { CredFree(p); }
  }
  public static bool Delete(string target) {
    if (CredDeleteW(target, 1, 0)) return true;
    int error = Marshal.GetLastWin32Error();
    if (error == ERROR_NOT_FOUND) return false;
    throw new System.ComponentModel.Win32Exception(error);
  }
}
'@
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
switch ($request.op) {
  'set' { [NowPlayingCred]::Write($request.target, $request.user, [string]$request.secret); $result = @{ ok = $true } }
  'get' { $result = @{ ok = $true; secret = [NowPlayingCred]::Read($request.target) } }
  'delete' { $result = @{ ok = $true; deleted = [NowPlayingCred]::Delete($request.target) } }
  default { throw 'unknown operation' }
}
[Console]::Out.Write(($result | ConvertTo-Json -Compress))
`;

export const WINDOWS_CREDENTIAL_SCRIPT = SCRIPT;

export function runPowerShell(input, { timeoutMs = 20000, spawnProcess = spawn } = {}) {
  const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawnProcess("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const out = [];
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill?.(); finish(new Error("Credential Manager timed out")); }, timeoutMs);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", () => {}); // never surface stderr: it could echo input
    child.on("error", () => finish(new Error("Credential Manager is unavailable")));
    child.on("close", (code) => {
      if (code !== 0) return finish(new Error("Credential Manager request failed"));
      try { finish(null, JSON.parse(Buffer.concat(out).toString("utf8").replace(/^\uFEFF/, ""))); }
      catch { finish(new Error("Credential Manager returned an invalid response")); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

export function createWindowsCredentialAdapter({ run = runPowerShell } = {}) {
  if (typeof run !== "function") throw new TypeError("run must be a function");
  const target = (service, account) => {
    if (typeof service !== "string" || typeof account !== "string" || !SERVICE.test(service) || !ACCOUNT.test(account)) throw new TypeError("credential target is invalid");
    return `${service}:${account}`;
  };
  return Object.freeze({
    async setPassword(service, account, secret) {
      if (typeof secret !== "string" || !secret) throw new TypeError("credential secret is required");
      if (Buffer.byteLength(secret, "utf16le") > MAX_SECRET_BYTES) throw new RangeError("credential secret is too large");
      const result = await run({ op: "set", target: target(service, account), user: account, secret });
      if (result?.ok !== true) throw new Error("Credential Manager request failed");
    },
    async getPassword(service, account) {
      const result = await run({ op: "get", target: target(service, account) });
      if (result?.ok !== true) throw new Error("Credential Manager request failed");
      return typeof result.secret === "string" ? result.secret : null;
    },
    async deletePassword(service, account) {
      const result = await run({ op: "delete", target: target(service, account) });
      if (result?.ok !== true) throw new Error("Credential Manager request failed");
      return result.deleted === true;
    },
  });
}

import { createLinuxCredentialAdapter } from "./linux-credential-adapter.js";
import { createMacosCredentialAdapter } from "./macos-credential-adapter.js";
import { createWindowsCredentialAdapter } from "./windows-credential-adapter.js";

// Picks the OS keychain for createCredentialStore (#215): Credential Manager
// on Windows, the Keychain on macOS, the Secret Service on Linux.
export function createPlatformCredentialAdapter({ platform = process.platform } = {}) {
  if (platform === "win32") return createWindowsCredentialAdapter();
  if (platform === "darwin") return createMacosCredentialAdapter();
  if (platform === "linux") return createLinuxCredentialAdapter();
  throw new Error(`NowPlaying can't store sign-ins on ${platform} yet`);
}

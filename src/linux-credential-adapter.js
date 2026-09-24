import { spawn } from "node:child_process";

// Linux Secret Service adapter for createCredentialStore (#215): GNOME
// Keyring, KWallet or any other Secret Service provider, through libsecret's
// `secret-tool`. Only the service and account names go on the command line;
// the secret travels over stdin and stdout, and stderr is never shown.

const MAX_SECRET_BYTES = 4096;
const SERVICE = /^[A-Za-z0-9._-]{1,64}$/;
const ACCOUNT = /^[^\u0000-\u001f\u007f]{1,256}$/;

export function runSecretTool(args, { input = "", timeoutMs = 20000, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawnProcess("secret-tool", args, { shell: false, stdio: ["pipe", "pipe", "pipe"] }); }
    catch { reject(new Error("Secret Service is unavailable")); return; }
    const out = [];
    let stderrBytes = 0;
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill?.(); finish(new Error("Secret Service timed out")); }, timeoutMs);
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => { stderrBytes += chunk.length; }); // counted, never shown
    child.on("error", () => finish(new Error("Secret Service is unavailable (install libsecret-tools)")));
    child.on("close", (code) => finish(null, { code, stdout: Buffer.concat(out).toString("utf8"), stderr: stderrBytes > 0 }));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

export function createLinuxCredentialAdapter({ run = runSecretTool } = {}) {
  if (typeof run !== "function") throw new TypeError("run must be a function");
  const attributes = (service, account) => {
    if (typeof service !== "string" || typeof account !== "string" || !SERVICE.test(service) || !ACCOUNT.test(account)) throw new TypeError("credential target is invalid");
    return ["service", service, "account", account];
  };
  async function lookup(service, account) {
    const result = await run(["lookup", ...attributes(service, account)]);
    if (result?.code === 0) return result.stdout;
    // secret-tool exits 1 with no output when nothing matches.
    if (result?.code === 1 && !result.stdout && !result.stderr) return null;
    throw new Error("Secret Service request failed");
  }
  return Object.freeze({
    async setPassword(service, account, secret) {
      if (typeof secret !== "string" || !secret) throw new TypeError("credential secret is required");
      if (Buffer.byteLength(secret) > MAX_SECRET_BYTES) throw new RangeError("credential secret is too large");
      const result = await run(["store", `--label=NowPlaying (${account})`, ...attributes(service, account)], { input: secret });
      if (result?.code !== 0) throw new Error("Secret Service request failed");
    },
    getPassword: lookup,
    async deletePassword(service, account) {
      const existing = await lookup(service, account);
      if (existing === null) return false;
      const result = await run(["clear", ...attributes(service, account)]);
      if (result?.code !== 0) throw new Error("Secret Service request failed");
      return true;
    },
  });
}

// End to end for #373: a Windows install checks GitHub, downloads the Windows
// bundle zip, verifies it against SHA256SUMS and swaps it in.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutoUpdater } from "../src/auto-updater.js";
import { installVerifiedUpdate } from "../src/update-install.js";

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

// Minimal stored (uncompressed) zip, enough for tar/unzip to read.
function makeZip(files) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const nameBuf = Buffer.from(name);
    const data = Buffer.from(text);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(data.length, 20); header.writeUInt32LE(data.length, 24); header.writeUInt16LE(nameBuf.length, 28); header.writeUInt32LE(offset, 42);
    parts.push(local, nameBuf, data);
    central.push(header, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralBuf.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, centralBuf, end]));
}

const bundle = (version, extra = {}) => ({
  "nowplaying.exe": "launcher",
  "nowplayingw.exe": "gui launcher",
  "runtime/node.exe": "node",
  "app/package.json": JSON.stringify({ name: "nowplaying", version }),
  "app/build-info.json": JSON.stringify({ version, channel: "stable" }),
  "app/src/index.js": `export const version = "${version}";`,
  ...extra,
});

const API = "https://api.github.com/repos/o/r";
function fakeGitHub(zip, { tarball = new Uint8Array([9]) } = {}) {
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const sums = `${sha(tarball)}  nowplaying-v0.3.0.tar.gz\n${sha(zip)}  nowplaying-v0.3.0-windows-x64.zip\n`;
  const assets = { [`${API}/releases/assets/1`]: tarball, [`${API}/releases/assets/2`]: zip, [`${API}/releases/assets/3`]: new TextEncoder().encode(sums) };
  const requested = [];
  const fetchImpl = async (url) => {
    requested.push(url);
    if (url === `${API}/releases`) {
      return { ok: true, status: 200, json: async () => [{ tag_name: "v0.3.0", prerelease: false, draft: false, html_url: "https://github.com/o/r/releases/tag/v0.3.0", assets: [
        { name: "nowplaying-v0.3.0.tar.gz", url: `${API}/releases/assets/1` },
        { name: "nowplaying-v0.3.0-windows-x64.zip", url: `${API}/releases/assets/2` },
        { name: "SHA256SUMS", url: `${API}/releases/assets/3` },
      ] }] };
    }
    const body = assets[url];
    if (!body) return { ok: false, status: 404 };
    return { ok: true, url, arrayBuffer: async () => body.slice().buffer };
  };
  return { fetchImpl, requested };
}

async function oldInstall() {
  const root = await mkdtemp(join(tmpdir(), "nowplaying-win-e2e-"));
  const target = join(root, "NowPlaying");
  await mkdir(join(target, "app"), { recursive: true });
  await writeFile(join(target, "nowplaying.exe"), "old launcher");
  await writeFile(join(target, "app", "build-info.json"), JSON.stringify({ version: "0.2.0" }));
  return { root, target };
}

test("check -> download -> swap installs the Windows bundle on win32", async () => {
  const { target } = await oldInstall();
  const { fetchImpl, requested } = fakeGitHub(makeZip(bundle("0.3.0")));
  const updater = createAutoUpdater({ currentVersion: "0.2.0", repository: "o/r", channel: "stable", platform: "win32", mode: "install", targetDir: target, fetchImpl });
  const result = await updater.check();
  assert.equal(result.status, "installed");
  assert.equal(result.version, "0.3.0");
  assert.ok(requested.includes(`${API}/releases/assets/2`), "downloaded the Windows zip");
  assert.ok(!requested.includes(`${API}/releases/assets/1`), "never downloaded the source tarball");
  assert.equal(await readFile(join(target, "nowplaying.exe"), "utf8"), "launcher");
  await access(join(target, "runtime", "node.exe"));
  assert.equal(JSON.parse(await readFile(join(target, "app", "build-info.json"), "utf8")).version, "0.3.0");
  assert.equal(await readFile(join(result.backup, "nowplaying.exe"), "utf8"), "old launcher");
});

test("a tampered zip fails the checksum and leaves the install alone", async () => {
  const { target } = await oldInstall();
  const good = makeZip(bundle("0.3.0"));
  const { fetchImpl } = fakeGitHub(good);
  const tampered = async (url, options) => {
    const response = await fetchImpl(url, options);
    if (url !== `${API}/releases/assets/2`) return response;
    const bytes = good.slice(); bytes[bytes.length - 30] ^= 1;
    return { ...response, arrayBuffer: async () => bytes.buffer };
  };
  const updater = createAutoUpdater({ currentVersion: "0.2.0", repository: "o/r", channel: "stable", platform: "win32", mode: "install", targetDir: target, fetchImpl: tampered });
  await assert.rejects(updater.check(), /checksum mismatch/);
  assert.equal(await readFile(join(target, "nowplaying.exe"), "utf8"), "old launcher");
});

test("a bundle with the wrong version or no runtime never replaces the install", async () => {
  const { target } = await oldInstall();
  const install = (files) => installVerifiedUpdate({ update: { bytes: makeZip(files), version: "0.3.0", filename: "nowplaying-v0.3.0-windows-x64.zip" }, targetDir: target });
  await assert.rejects(install(bundle("0.2.9")), /version mismatch/);
  const noRuntime = bundle("0.3.0"); delete noRuntime["runtime/node.exe"];
  await assert.rejects(install(noRuntime), /missing runtime\/node\.exe/);
  const noLauncher = bundle("0.3.0"); delete noLauncher["nowplaying.exe"];
  await assert.rejects(install(noLauncher), /missing nowplaying\.exe/);
  assert.equal(await readFile(join(target, "nowplaying.exe"), "utf8"), "old launcher");
});

test("the source tarball layout is refused as a Windows bundle", async () => {
  const { target } = await oldInstall();
  const tarballShape = { "dist/manifest.json": JSON.stringify({ version: "0.3.0" }), "package.json": "{}" };
  await assert.rejects(installVerifiedUpdate({ update: { bytes: makeZip(tarballShape), version: "0.3.0", filename: "nowplaying-v0.3.0-windows-x64.zip" }, targetDir: target }), /ENOENT/);
  assert.equal(await readFile(join(target, "nowplaying.exe"), "utf8"), "old launcher");
});

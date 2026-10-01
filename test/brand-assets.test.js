import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url));
const text = (p) => read(p).toString("utf8");

test("the app icon is a multi-size .ico with the brand sizes", () => {
  const ico = read("assets/nowplaying.ico");
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let i = 0; i < count; i++) sizes.push(ico[6 + i * 16] || 256);
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256]);
  for (let i = 0; i < count; i++) {
    const length = ico.readUInt32LE(6 + i * 16 + 8), offset = ico.readUInt32LE(6 + i * 16 + 12);
    assert.equal(ico.subarray(offset, offset + 8).toString("hex"), "89504e470d0a1a0a", "frames are PNG");
    assert.ok(offset + length <= ico.length);
  }
});

test("Inno Setup wizard images exist, are 24-bit BMPs with the right aspect, and are wired in", () => {
  const side = read("assets/brand/installer/wizard-side.bmp"), small = read("assets/brand/installer/wizard-small.bmp");
  for (const [bmp, w, h] of [[side, 430, 824], [small, 110, 110]]) {
    assert.equal(bmp.toString("latin1", 0, 2), "BM");
    assert.equal(bmp.readInt32LE(18), w);
    assert.equal(bmp.readInt32LE(22), h);
    assert.equal(bmp.readUInt16LE(28), 24);
  }
  assert.ok(Math.abs(430 / 824 - 164 / 314) < 0.002, "side image keeps the 164:314 wizard aspect");
  const iss = text("scripts/windows-installer.iss");
  assert.match(iss, /^WizardImageFile=\{#BundleDir\}\\assets\\brand\\installer\\wizard-side\.bmp$/m);
  assert.match(iss, /^WizardSmallImageFile=\{#BundleDir\}\\assets\\brand\\installer\\wizard-small\.bmp$/m);
  assert.match(iss, /^SetupIconFile=\{#BundleDir\}\\assets\\nowplaying\.ico$/m);
});

test("the Windows build uses the committed icon instead of drawing the old one", () => {
  const build = text("scripts/build-windows.ps1");
  assert.doesNotMatch(build, /generate-windows-icon/);
  assert.match(build, /assets\/nowplaying\.ico/);
  assert.equal(existsSync(new URL("../scripts/generate-windows-icon.ps1", import.meta.url)), false);
});

test("brand SVGs use only the palette, no gradients, and the Discord fallback is the new icon", () => {
  const palette = new Set(["#7C3AED", "#A855F7", "#EC4899", "#0B0B12", "#1F1F28", "#9CA3AF", "#E5E7EB", "#F8FAFC", "#FFFFFF", "#000000"]);
  const svgs = [...readdirSync(new URL("../assets/brand", import.meta.url)).filter((f) => f.endsWith(".svg")).map((f) => `assets/brand/${f}`),
    ...readdirSync(new URL("../assets/brand/installer", import.meta.url)).filter((f) => f.endsWith(".svg")).map((f) => `assets/brand/installer/${f}`)];
  assert.ok(svgs.length >= 9);
  for (const file of svgs) {
    const svg = text(file);
    assert.doesNotMatch(svg, /Gradient|filter=|<filter/i, file);
    for (const hex of svg.match(/#[0-9A-Fa-f]{6}\b/g) ?? []) assert.ok(palette.has(hex.toUpperCase()), `${file} uses ${hex}`);
  }
  const png = read("assets/discord-fallback.png");
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
  assert.match(text("README.md"), /!\[nowplaying[^\]]*\]\(assets\/brand\/banner\.png\)/);
});

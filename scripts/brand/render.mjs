// Builds every brand asset from source geometry: SVG masters, app/tray .ico,
// the Discord fallback image, Inno Setup wizard images and the README banner.
// Run: node scripts/brand/render.mjs   (test/brand-assets.test.js checks the output)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = (...p) => path.join(root, ...p);
mkdirSync(out("assets/brand/png"), { recursive: true });
mkdirSync(out("assets/brand/installer"), { recursive: true });

export const colors = Object.freeze({
  primary: "#7C3AED", secondary: "#A855F7", accent: "#EC4899",
  dark: "#0B0B12", surface: "#1F1F28", muted: "#9CA3AF", border: "#E5E7EB", light: "#F8FAFC",
});
const word = JSON.parse(readFileSync(out("assets/brand/wordmark-paths.json"), "utf8"));

// Play mark on a 256 grid: a rounded triangle with a smaller flat triangle inside.
const OUTER = "M 84 52 L 84 204 L 208 128 Z";
const INNER = "M 112 100 L 112 156 L 158 128 Z";
function mark({ outer = colors.primary, inner = colors.secondary, detail = true } = {}) {
  return `<path d="${OUTER}" fill="${outer}" stroke="${outer}" stroke-width="36" stroke-linejoin="round"/>` +
    (detail ? `<path d="${INNER}" fill="${inner}" stroke="${inner}" stroke-width="10" stroke-linejoin="round"/>` : "");
}
const svg = (w, h, body, vb = `0 0 ${w} ${h}`) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${vb}">${body}</svg>\n`;

// The mark is inset in its 256 box; crop the standalone mark to its real bounds.
const markSvg = svg(256, 256, mark(), "50 50 180 156").replace('width="256" height="256"', 'width="180" height="156"');

function appIcon({ bg, border, fg, detail = true, pad = 0 }) {
  const scale = 0.62;
  const t = (1 - scale) * 128;
  return `<rect x="${pad}" y="${pad}" width="${256 - pad * 2}" height="${256 - pad * 2}" rx="58" fill="${bg}"${border ? ` stroke="${border}" stroke-width="4"` : ""}/>` +
    `<g transform="translate(${t} ${t}) scale(${scale})">${fg(detail)}</g>`;
}
const iconDark = (detail = true) => svg(256, 256, appIcon({ bg: colors.dark, fg: (d) => mark({ detail: d }), detail }));
const iconLight = svg(256, 256, appIcon({ bg: colors.light, border: colors.border, pad: 2, fg: (d) => mark({ detail: d }) }));
const iconMono = svg(256, 256, appIcon({ bg: "#000000", fg: () => mark({ outer: "#FFFFFF", detail: false }) }));

// Wordmark: Inter Bold outlines. 1 unit = 1/100 em, baseline at y 0.
const NOW = (c) => `<path d="${word.now}" fill="${c}"/>`;
const PLAYING = (c) => `<path d="${word.playing}" fill="${c}"/>`;
function logo({ nowColor, playColor }) {
  const markW = 70, gap = 26, scale = 0.62;
  const h = 150;
  const wm = `translate(${markW + gap} 100)`;
  const w = Math.round(markW + gap + word.width + 8);
  return svg(w, h,
    `<g transform="translate(-6 38) scale(${markW / 150})"><g transform="translate(-40 -40) scale(1)">${mark()}</g></g>` +
    `<g transform="${wm}">${NOW(nowColor)}${PLAYING(playColor)}</g>`, `0 0 ${w} ${h}`);
}
const logoLight = logo({ nowColor: colors.dark, playColor: colors.primary });
const logoDark = logo({ nowColor: "#FFFFFF", playColor: colors.secondary });

// README banner (flat, dark).
const bannerW = 1280, bannerH = 360;
const bannerSvg = svg(bannerW, bannerH,
  `<rect width="${bannerW}" height="${bannerH}" fill="${colors.dark}"/>` +
  `<g transform="translate(96 76) scale(1.15)">${mark()}</g>` +
  `<g transform="translate(364 214) scale(1.5)">${NOW("#FFFFFF")}${PLAYING(colors.secondary)}</g>` +
  `<text x="372" y="282" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="22" letter-spacing="4" fill="${colors.muted}">SEE WHAT'S PLAYING, EVERYWHERE</text>`);

// Installer: welcome/finish side image (aspect 164:314) and the small corner image.
const sideW = 430, sideH = 824;
const sideSvg = svg(sideW, sideH,
  `<rect width="${sideW}" height="${sideH}" fill="${colors.dark}"/>` +
  `<g transform="translate(95 230) scale(0.95)">${mark()}</g>` +
  `<g transform="translate(60 600) scale(0.58)">${NOW("#FFFFFF")}${PLAYING(colors.secondary)}</g>` +
  `<text x="62" y="662" font-family="Inter, 'Segoe UI', Arial, sans-serif" font-size="15" letter-spacing="2.5" fill="${colors.muted}">SEE WHAT'S PLAYING</text>`);
const smallSvg = svg(256, 256, `<rect width="256" height="256" fill="#FFFFFF"/>${appIcon({ bg: colors.dark, fg: (d) => mark({ detail: d }), pad: 8 })}`);

const files = {
  "assets/brand/mark.svg": markSvg,
  "assets/brand/icon-dark.svg": iconDark(),
  "assets/brand/icon-light.svg": iconLight,
  "assets/brand/icon-mono.svg": iconMono,
  "assets/brand/logo.svg": logoLight,
  "assets/brand/logo-dark.svg": logoDark,
  "assets/brand/banner.svg": bannerSvg,
  "assets/brand/installer/wizard-side.svg": sideSvg,
  "assets/brand/installer/wizard-small.svg": smallSvg,
};
for (const [file, text] of Object.entries(files)) writeFileSync(out(file), text);

const png = (text, size) => sharp(Buffer.from(text), { density: 384 }).resize(size.w, size.h, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

// 16-32px drop the inner triangle so the mark stays a clean shape.
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const frames = [];
for (const size of icoSizes) frames.push({ size, data: await png(iconDark(size >= 48), { w: size, h: size }) });
const dir = Buffer.alloc(6 + frames.length * 16);
dir.writeUInt16LE(0, 0); dir.writeUInt16LE(1, 2); dir.writeUInt16LE(frames.length, 4);
let offset = dir.length;
frames.forEach(({ size, data }, i) => {
  const e = 6 + i * 16;
  dir[e] = size === 256 ? 0 : size; dir[e + 1] = size === 256 ? 0 : size; dir[e + 2] = 0; dir[e + 3] = 0;
  dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6); dir.writeUInt32LE(data.length, e + 8); dir.writeUInt32LE(offset, e + 12);
  offset += data.length;
});
writeFileSync(out("assets/nowplaying.ico"), Buffer.concat([dir, ...frames.map((f) => f.data)]));

writeFileSync(out("assets/discord-fallback.png"), await png(iconDark(), { w: 512, h: 512 }));
for (const [name, text, w, h] of [
  ["icon-dark-1024", iconDark(), 1024, 1024], ["icon-light-1024", iconLight, 1024, 1024], ["icon-mono-1024", iconMono, 1024, 1024],
  ["icon-512", iconDark(), 512, 512], ["touch-icon-180", iconDark(), 180, 180], ["favicon-32", iconDark(false), 32, 32], ["favicon-16", iconDark(false), 16, 16],
]) writeFileSync(out(`assets/brand/png/${name}.png`), await png(text, { w, h }));
writeFileSync(out("assets/brand/banner.png"), await png(bannerSvg, { w: bannerW, h: bannerH }));

// Inno Setup needs 24-bit BMP; flatten onto the page colour.
async function bmp(text, w, h, file) {
  const raw = await sharp(await png(text, { w, h })).flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = raw.info; const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixels = Buffer.alloc(rowSize * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const s = (y * width + x) * 3, d = (height - 1 - y) * rowSize + x * 3;
    pixels[d] = raw.data[s + 2]; pixels[d + 1] = raw.data[s + 1]; pixels[d + 2] = raw.data[s];
  }
  const head = Buffer.alloc(54);
  head.write("BM", 0); head.writeUInt32LE(54 + pixels.length, 2); head.writeUInt32LE(54, 10);
  head.writeUInt32LE(40, 14); head.writeInt32LE(width, 18); head.writeInt32LE(height, 22); head.writeUInt16LE(1, 26); head.writeUInt16LE(24, 28);
  head.writeUInt32LE(pixels.length, 34); head.writeInt32LE(2835, 38); head.writeInt32LE(2835, 42);
  writeFileSync(out(file), Buffer.concat([head, pixels]));
}
await bmp(sideSvg, sideW, sideH, "assets/brand/installer/wizard-side.bmp");
await bmp(smallSvg, 110, 110, "assets/brand/installer/wizard-small.bmp");
console.log("brand assets written");

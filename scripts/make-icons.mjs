// Re-draws the four app icons in public/icons/ from public/favicon.svg:  node scripts/make-icons.mjs
//
//   apple-touch-icon.png 180   a full square (iOS rounds it itself; a transparent corner would turn black); the mark 58 % wide
//   icon-192.png, icon-512.png  "any": a rounded square (22.5 %), transparent outside the corners; the mark 58 % wide
//   icon-512-maskable.png       a full square, the mark inside the middle 46 % (the maskable safe zone is a circle of 80 % of the side)
//
// The mark is whatever public/favicon.svg draws, on the page's grey (#f2f2f7). To change the icon: replace favicon.svg (a square-ish SVG), run this, commit the four PNGs.
// iOS keeps a copy of the icon from the moment the app is added to the Home Screen: after a change it has to be removed and added again to show the new one.
//
// No dependency: it needs a Chrome or Chromium to draw with (the SVG has blur filters that only a browser draws faithfully). It is found by
// the CHROME environment variable, or in the usual places (google-chrome, chromium, Playwright's /opt/pw-browsers, macOS Applications).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const BG = "#f2f2f7";

function findChrome() {
  const fixed = [process.env.CHROME, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"].filter(Boolean);
  const pw = fs.existsSync("/opt/pw-browsers") ? fs.readdirSync("/opt/pw-browsers").filter((d) => d.startsWith("chromium-")).map((d) => `/opt/pw-browsers/${d}/chrome-linux/chrome`) : [];
  for (const p of [...fixed, ...pw]) if (fs.existsSync(p)) return p;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try { return execFileSync("which", [name], { encoding: "utf8" }).trim(); } catch { /* next */ }
  }
  throw new Error("No Chrome or Chromium found: set CHROME to its path");
}

const svg = fs.readFileSync(path.join(pub, "favicon.svg"), "utf8").replace(/<svg /, '<svg style="display:block" ');
const html = (size, radiusPct, markPct) => `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}
.i{width:${size}px;height:${size}px;background:${BG};border-radius:${radiusPct}%;display:grid;place-items:center;overflow:hidden}
.i svg{width:${size * markPct / 100}px;height:auto}</style><div class="i">${svg}</div>`;

// Chrome's headless window is shorter than asked (its own chrome takes ~90 px), so the page is drawn in a taller window and the top-left square is cut out of the PNG it writes.
// The PNG is read and written here (8-bit RGBA, not interlaced: what Chrome writes) so there is no dependency; `opaque` writes RGB with no alpha channel (iOS turns transparent pixels black).
const crc = (() => { const t = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }); return (b) => { let c = ~0; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; }; })();
const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, "latin1"); data.copy(out, 8); out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };
function cropSquare(png, size, opaque) {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  const w = png.readUInt32BE(16), depth = png[24], type = png[25], interlace = png[28];
  if (depth !== 8 || type !== 6 || interlace !== 0) throw new Error(`unexpected PNG (depth ${depth}, color type ${type}, interlace ${interlace})`);
  const idat = []; for (let o = 8; o < png.length;) { const len = png.readUInt32BE(o), t = png.toString("latin1", o + 4, o + 8); if (t === "IDAT") idat.push(png.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, rows = raw.length / (stride + 1);
  const img = Buffer.alloc(rows * stride);
  for (let y = 0; y < rows; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), cur = img.subarray(y * stride, (y + 1) * stride), up = y ? img.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = up ? up[i] : 0, c = up && i >= bpp ? up[i - bpp] : 0;
      const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : (() => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })();
      cur[i] = (line[i] + pr) & 255;
    }
  }
  if (rows < size || w < size) throw new Error(`the screenshot is ${w}x${rows}, smaller than ${size}`);
  const ob = opaque ? 3 : 4, out = Buffer.alloc(size * (size * ob + 1));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) for (let k = 0; k < ob; k++) out[y * (size * ob + 1) + 1 + x * ob + k] = img[y * stride + x * 4 + k]; // filter 0 per row
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = opaque ? 2 : 6;
  return Buffer.concat([png.subarray(0, 8), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(out, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// [file, side, corner radius %, mark width %, opaque]
const jobs = [["apple-touch-icon.png", 180, 0, 58, true], ["icon-192.png", 192, 22.5, 58, false], ["icon-512.png", 512, 22.5, 58, false], ["icon-512-maskable.png", 512, 0, 46, true]];
const chrome = findChrome();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "icons-"));
fs.mkdirSync(path.join(pub, "icons"), { recursive: true });
for (const [name, size, radius, mark, opaque] of jobs) {
  const page = path.join(tmp, `${name}.html`), shot = path.join(tmp, name);
  fs.writeFileSync(page, html(size, radius, mark));
  execFileSync(chrome, ["--headless=new", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--default-background-color=00000000",
    `--window-size=${size},${size + 200}`, `--screenshot=${shot}`, `file://${page}`], { stdio: "ignore" });
  fs.writeFileSync(path.join(pub, "icons", name), cropSquare(fs.readFileSync(shot), size, opaque));
  console.log(name, `${size}x${size}`, opaque ? "RGB" : "RGBA");
}
fs.rmSync(tmp, { recursive: true, force: true });

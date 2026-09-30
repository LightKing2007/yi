/**
 * 对比两组场景截图（见 src/app/scenarios.ts）：node scripts/compare-shots.mjs [基准组] [对比组]，默认 base 与 now。
 * 逐像素比较，任一通道差超过 2 的像素算作不同；有差异的图在 .shots/diff/ 下生成差异图（不同的像素标红）。
 * 只用 Node 自带的 zlib，不需要安装任何东西。
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '.shots');
const [a = 'base', b = 'now'] = process.argv.slice(2);
const dirA = path.join(root, a), dirB = path.join(root, b), dirD = path.join(root, 'diff');

/** 解码 8 位 RGBA、非隔行的 PNG（浏览器 toDataURL 输出的就是这种） */
function decode(file) {
  const buf = fs.readFileSync(file);
  let p = 8, w = 0, h = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      if (data[8] !== 8 || data[9] !== 6 || data[12] !== 0) throw new Error(`${file}：只支持 8 位 RGBA、非隔行`);
    } else if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * 4, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? out[row + x - 4] : 0, up = y ? out[row - stride + x] : 0, ul = x >= 4 && y ? out[row - stride + x - 4] : 0;
      let v = src[x];
      if (f === 1) v += left;
      else if (f === 2) v += up;
      else if (f === 3) v += (left + up) >> 1;
      else if (f === 4) { const pp = left + up - ul, pa = Math.abs(pp - left), pb = Math.abs(pp - up), pc = Math.abs(pp - ul); v += pa <= pb && pa <= pc ? left : pb <= pc ? up : ul; }
      out[row + x] = v & 255;
    }
  }
  return { w, h, px: out };
}

function encode(file, w, h, px) {
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]), crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

if (!fs.existsSync(dirA) || !fs.existsSync(dirB)) { console.error(`找不到 .shots/${a} 或 .shots/${b}`); process.exit(2); }
fs.rmSync(dirD, { recursive: true, force: true });
const names = [...new Set([...fs.readdirSync(dirA), ...fs.readdirSync(dirB)])].filter(n => n.endsWith('.png')).sort();
let bad = 0;
for (const n of names) {
  const fa = path.join(dirA, n), fb = path.join(dirB, n);
  if (!fs.existsSync(fa) || !fs.existsSync(fb)) { console.log(`✗ ${n}  只在 ${fs.existsSync(fa) ? a : b} 里有`); bad++; continue; }
  const A = decode(fa), B = decode(fb);
  if (A.w !== B.w || A.h !== B.h) { console.log(`✗ ${n}  尺寸不同 ${A.w}×${A.h} / ${B.w}×${B.h}`); bad++; continue; }
  let diff = 0, max = 0;
  const vis = Buffer.from(A.px);
  for (let i = 0; i < A.px.length; i += 4) {
    const d = Math.max(Math.abs(A.px[i] - B.px[i]), Math.abs(A.px[i + 1] - B.px[i + 1]), Math.abs(A.px[i + 2] - B.px[i + 2]), Math.abs(A.px[i + 3] - B.px[i + 3]));
    if (d > max) max = d;
    if (d > 2) { diff++; vis[i] = 255; vis[i + 1] = 0; vis[i + 2] = 0; vis[i + 3] = 255; }
    else { vis[i + 3] = Math.min(vis[i + 3], 90); }
  }
  if (!diff) continue;
  bad++;
  fs.mkdirSync(dirD, { recursive: true });
  encode(path.join(dirD, n), A.w, A.h, vis);
  console.log(`✗ ${n}  ${diff} 个像素不同（${((diff / (A.w * A.h)) * 100).toFixed(3)}%），最大差 ${max}`);
}
console.log(bad ? `\n${bad} / ${names.length} 张有差异，差异图在 .shots/diff/` : `全部 ${names.length} 张一致`);
process.exit(bad ? 1 : 0);

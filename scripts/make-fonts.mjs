/**
 * 生成随游戏附带的字体子集：没有中文字体的电脑（例如精简安装的 Linux）上也能正常显示文字，Windows 上的标题也更好看。
 *   node scripts/make-fonts.mjs
 * 原始字体放在 .fonts-src/（不进仓库），来自思源字体（Noto CJK，SIL OFL 许可，可以随程序分发）：
 *   https://github.com/notofonts/noto-cjk 的 Sans/SubsetOTF/SC/NotoSansSC-Regular.otf、Serif/SubsetOTF/SC/NotoSerifSC-Regular.otf、NotoSerifSC-Black.otf
 * 输出到 src/ui/assets/fonts/：
 *   yi-serif-400.woff2、yi-serif-900.woff2  只含游戏里用到的字（标题、段位、房号等）
 *   yi-sans-400.woff2                       游戏里用到的字，加上最常用的 3755 个汉字（玩家昵称什么字都可能有）
 * 改了界面文字（src/ 下的中文、译文表）之后重新运行一次。
 */
import fs from 'node:fs';
import path from 'node:path';
import subsetFont from 'subset-font';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const src = path.join(root, '.fonts-src'),
  out = path.join(root, 'src/ui/assets/fonts');

/** 游戏里出现过的所有字：src/ 与 server/ 下全部源码里的字符（含译文表、说明文字、服务端发来的提示） */
function usedChars() {
  const set = new Set();
  const walk = d => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|tsx|css|html)$/.test(e.name)) for (const ch of fs.readFileSync(p, 'utf8')) set.add(ch);
    }
  };
  walk(path.join(root, 'src'));
  walk(path.join(root, 'server'));
  for (let c = 0x20; c < 0x7f; c++) set.add(String.fromCharCode(c)); // ASCII
  for (const ch of '·、，。：；！？“”‘’（）《》「」—…　') set.add(ch);
  return set;
}

/** GB2312 一级汉字（最常用的 3755 个） */
function gb2312Level1() {
  const dec = new TextDecoder('gbk'),
    out = [];
  for (let hi = 0xb0; hi <= 0xd7; hi++)
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      if (hi === 0xd7 && lo > 0xf9) break;
      out.push(dec.decode(new Uint8Array([hi, lo])));
    }
  return out;
}

const used = usedChars();
const keep = s => [...s].filter(ch => ch.codePointAt(0) >= 0x20).join('');
const serifText = keep(used),
  sansText = keep(new Set([...used, ...gb2312Level1()]));

const jobs = [
  ['NotoSerifSC-Regular.otf', 'yi-serif-400.woff2', serifText],
  ['NotoSerifSC-Black.otf', 'yi-serif-900.woff2', serifText],
  ['NotoSansSC-Regular.otf', 'yi-sans-400.woff2', sansText],
];
fs.mkdirSync(out, { recursive: true });
for (const [from, to, text] of jobs) {
  const file = path.join(src, from);
  if (!fs.existsSync(file)) {
    console.error(`缺少原始字体 ${file}（见本文件开头的下载地址）`);
    process.exit(1);
  }
  const buf = await subsetFont(fs.readFileSync(file), text, { targetFormat: 'woff2' });
  fs.writeFileSync(path.join(out, to), buf);
  console.log(`${to}  ${[...text].length} 个字  ${(buf.length / 1024).toFixed(0)} KB`);
}

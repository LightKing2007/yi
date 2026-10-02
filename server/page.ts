/**
 * 下载页面的 HTML：首屏（与游戏开始菜单相同的标题与印章、动态棋盘）、各平台的安装程序与 SHA-256 校验值（SEC-070）、
 * 游戏特色、系统要求、安装说明、校验方法、更新与隐私。不含任何脚本（API-063）；样式见 pageStyle.ts。
 */
import { pageStyle } from './pageStyle';

/** 页面上的一个安装程序；sha256 为 null 表示校验值尚在计算 */
export interface PagePkg { file: string; version: string; platform: string; size: number; sha256: string | null }

/** 各平台的名称、系统要求与卡片上棋子的颜色，按页面上的顺序排列 */
export const PLATFORMS: Record<string, { label: string; tag: string; req: string; pip: 'b' | 'w' }> = {
  'win-x64': { label: 'Windows', tag: 'x64', req: 'Windows 10 或更高版本', pip: 'b' },
  'mac-arm64': { label: 'macOS', tag: 'Apple 芯片', req: 'macOS 13 或更高版本', pip: 'w' },
  'mac-x64': { label: 'macOS', tag: 'Intel 芯片', req: 'macOS 13 或更高版本', pip: 'b' },
  'linux-x86_64': { label: 'Linux', tag: 'x86_64', req: 'AppImage 格式', pip: 'w' },
};

/** 首屏棋盘上依次落下的棋子（15 路，坐标从 0 起）：黑白交替，最后一手带标记 */
const OPENING: [number, number][] = [[7, 7], [8, 6], [8, 8], [6, 6], [6, 8], [9, 9], [7, 9], [5, 7], [9, 7]];
const SIZE = 15;
const STARS: [number, number][] = [[3, 3], [11, 3], [7, 7], [3, 11], [11, 11]];
const BYTES_PER_MB = 1048576;
/** GitHub 上发布说明的地址前缀 */
const RELEASES = 'https://github.com/LightKing2007/yi/releases/tag/v';

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const pct = (n: number) => `${((n / (SIZE - 1)) * 100).toFixed(4)}%`;
const arrow = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
  + '<path d="M8 2.5v9M4 8l4 4 4-4M3 14h10"/></svg>';

/** 棋盘：网格与星位（SVG）、依次落下的棋子、最后一手的涟漪、可预览落子的交叉点 */
function board() {
  const lines: string[] = [];
  for (let i = 0; i < SIZE; i++) {
    lines.push(`<line x1="0" y1="${i}" x2="${SIZE - 1}" y2="${i}"/><line x1="${i}" y1="0" x2="${i}" y2="${SIZE - 1}"/>`);
  }
  const stars = STARS.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.11"/>`).join('');
  const taken = new Set(OPENING.map(([x, y]) => y * SIZE + x));
  const stones = OPENING.map(([x, y], i) => {
    const last = i === OPENING.length - 1 ? ' last' : '';
    return `<b class="s ${i % 2 ? 'w' : 'b'}${last}" style="left:${pct(x)};top:${pct(y)};--i:${i}"></b>`;
  }).join('');
  const [lx, ly] = OPENING[OPENING.length - 1];
  const ring = `<b class="ring" style="left:${pct(lx)};top:${pct(ly)};--i:${OPENING.length - 1}"></b>`;
  const cells = Array.from({ length: SIZE * SIZE }, (_, k) => (taken.has(k) ? '<i class="o"></i>' : '<i></i>')).join('');
  return `<div class="board"><div class="grid">`
    + `<svg viewBox="0 0 ${SIZE - 1} ${SIZE - 1}" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}${stars}</svg>`
    + `${stones}${ring}<div class="cells" aria-hidden="true">${cells}</div></div></div>`;
}

function card(p: PagePkg, i: number) {
  const info = PLATFORMS[p.platform];
  const sum = p.sha256 ? `<code>${p.sha256}</code>` : '<code>正在计算，请稍后刷新页面。</code>';
  return `<article class="panel card" style="--i:${i}">
<div class="name"><span class="pip ${info.pip}"></span><h3>${esc(info.label)}</h3><span class="tag">${esc(info.tag)}</span></div>
<div class="req">${esc(info.req)}</div>
<div class="meta"><span>版本 ${esc(p.version)}</span><span>${(p.size / BYTES_PER_MB).toFixed(0)} MB</span></div>
<div class="file" title="${esc(p.file)}">${esc(p.file)}</div>
<a class="btn primary" href="/${encodeURIComponent(p.file)}" download>${arrow}下载</a>
<details><summary>SHA-256 校验值</summary>${sum}</details>
</article>`;
}

const FEATURES: [string, string][] = [
  ['五子棋', '15 路棋盘，连成五子即获胜。黑方禁手（三三、四四、长连）可在设置中开关，禁手点以红色小叉标示。'],
  ['围棋', '9 路、13 路、19 路棋盘，完整支持提子、禁着点与打劫。双方停一手后进入点目，按数子法计分，贴 7.5 目。'],
  ['人机对弈', '电脑分简单、普通、困难三档，玩家可执黑或执白。电脑在后台思考，思考期间界面始终流畅。'],
  ['联机对战', '提供匹配、排位与好友房间三种方式。排位按 Elo 等级分计算段位；网络中断后，60 秒内恢复连接即可继续对局。'],
  ['画面与声音', '榧木棋盘、云子与贝纹白子均由着色器实时绘制；落子声与背景音乐由程序合成，并提供五种光影效果。'],
  ['三种语言', '界面提供文言、中文与 English 三种语言，可在设置中随时切换。'],
];

const REQUIREMENTS: [string, string][] = [
  ['macOS', 'macOS 13 Ventura 或更高版本，Apple 芯片或 Intel 芯片'],
  ['Windows', 'Windows 10 或更高版本，64 位（x64）'],
  ['Linux', 'x86_64 架构，可运行 AppImage 的桌面发行版'],
  ['显卡', '支持 WebGL2（OpenGL ES 3.0）。没有图形加速的虚拟机中可能无法运行'],
  ['网络', '单机游戏无须联网；联机对战需要连接互联网'],
];

const GUIDES: [string, string[]][] = [
  ['Windows', [
    '运行下载的安装程序，按提示选择安装位置。',
    '首次运行时如出现“Windows 已保护你的电脑”提示，请点击“更多信息”，再点击“仍要运行”。',
    '如需卸载，请在“设置”的“应用”中找到“弈”。',
  ]],
  ['macOS', [
    '打开下载的 .dmg 文件，将“弈”拖入“应用程序”文件夹。',
    '首次打开时，请在“访达”中按住 Control 键点按该应用程序并选择“打开”，或前往“系统设置”中的“隐私与安全性”，点按“仍要打开”。',
    '如需卸载，请将“弈”从“应用程序”文件夹移到废纸篓。',
  ]],
  ['Linux', [
    '为下载的文件添加执行权限：<code class="inline">chmod +x Yi-*.AppImage</code>。',
    '双击文件，或在终端中执行该文件即可运行。',
    '部分发行版须先安装 FUSE 2，例如 Ubuntu 24.04 上的 libfuse2t64 软件包。',
  ]],
];

/** 生成下载页面；assetVersion 用于资源地址的版本参数 */
export function downloadPage(pkgs: PagePkg[], assetVersion: string) {
  const latest = pkgs.map(p => p.version).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))[0];
  const link = latest ? `<a href="${RELEASES}${esc(latest)}" rel="noopener noreferrer" target="_blank">更新说明</a>` : '';
  const notes = latest ? `<span class="chip">最新版本 ${esc(latest)} · ${link}</span>` : '';
  const cards = pkgs.length ? `<div class="cards">${pkgs.map(card).join('')}</div>` : '<div class="panel empty">暂无可供下载的安装程序。</div>';
  const features = FEATURES
    .map(([t, d], i) => `<div class="panel feature reveal"><span class="pip ${i % 2 ? 'w' : 'b'}"></span><h3>${t}</h3><p>${d}</p></div>`).join('');
  const reqs = REQUIREMENTS.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
  const guides = GUIDES
    .map(([os, steps]) => `<div class="panel guide reveal"><h3>${os}</h3><ol>${steps.map(s => `<li>${s}</li>`).join('')}</ol></div>`).join('');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>弈 · 下载</title><meta name="description" content="“弈”是一款五子棋与围棋桌面游戏，支持人机对弈与联机对战。下载 macOS、Windows 及 Linux 版本。">
<meta name="color-scheme" content="light dark"><link rel="icon" href="/assets/icon.png?v=${assetVersion}">
<style>${pageStyle(assetVersion)}</style></head>
<body>
<header class="top"><div class="wrap"><a class="home" href="#"><img src="/assets/icon.png?v=${assetVersion}" alt="">弈</a>
<nav><a href="#download">下载</a><a href="#features">特色</a><a href="#requirements">系统要求</a>
<a href="#guide">安装说明</a><a href="#verify">文件校验</a></nav></div></header>
<main class="wrap">
<div class="hero">
<div>
<div class="brand"><div class="big" role="img" aria-label="弈"></div><div class="seal">棋</div></div>
<p class="kinds">五子棋 · 围棋</p><p class="motto">以木为枰，以石为子</p>
<p class="lead">“弈”是一款五子棋与围棋桌面游戏。棋盘与棋子由着色器实时绘制，支持人机对弈与联机对战，提供 macOS、Windows 及 Linux 版本。</p>
<div class="cta"><a class="btn primary" href="#download">${arrow}下载游戏</a><a class="btn" href="#guide">安装说明</a>${notes}</div>
</div>
<figure class="stage" style="margin:0">${board()}<figcaption class="caption">将鼠标移至交叉点，可预览落子</figcaption></figure>
</div>

<section id="download"><div class="head"><span class="label">下载</span><h2>选择操作系统</h2>
<p>请根据您的操作系统选择对应的安装程序。下载支持断点续传；下载完成后，可按本页“文件校验”一节核对校验值。</p></div>${cards}</section>

<section id="features"><div class="head reveal"><span class="label">特色</span><h2>两种棋，一方木枰</h2>
<p>五子棋与围棋各有完整的规则实现，单人、人机与联机三种对局方式共用同一套规则。</p></div><div class="features">${features}</div></section>

<section id="requirements"><div class="head reveal"><span class="label">系统要求</span><h2>运行环境</h2></div>
<div class="panel reveal"><table>${reqs}</table></div></section>

<section id="guide"><div class="head reveal"><span class="label">安装说明</span><h2>安装与首次运行</h2>
<p>安装程序尚未经过操作系统厂商的公证或签名，首次运行时系统可能给出提示，按以下步骤操作即可。</p></div><div class="guides">${guides}</div></section>

<section id="verify"><div class="head reveal"><span class="label">文件校验</span><h2>核对 SHA-256 校验值</h2>
<p>计算下载文件的 SHA-256 校验值，并与该安装程序卡片中列出的数值比对，一致即表示文件完整且未被篡改。全部校验值亦可从 <a href="/SHA256SUMS">SHA256SUMS</a> 获取。</p></div>
<div class="cmds reveal">
<div class="panel cmd"><span>Windows</span><code>Get-FileHash 文件名 -Algorithm SHA256</code></div>
<div class="panel cmd"><span>macOS</span><code>shasum -a 256 文件名</code></div>
<div class="panel cmd"><span>Linux</span><code>sha256sum 文件名</code></div>
</div></section>

<section id="notes"><div class="head reveal"><span class="label">更多</span><h2>更新与隐私</h2></div><div class="notes">
<div class="panel reveal"><h3>更新</h3><p>有新版本时，游戏的开始菜单及联机对战页面会给出提示，点击提示即可打开本页面。安装新版本即可完成更新，设置与段位均予以保留。</p></div>
<div class="panel reveal"><h3>隐私</h3><p>游戏不收集使用数据，也不上传日志，错误日志仅保存在本机。联机时，服务器仅保存匿名身份的散列值、昵称及段位分。</p></div>
</div></section>
</main>
<footer><div class="wrap"><p>Copyright © 2026 LightKing。保留所有权利。</p>
<p>游戏附带思源黑体、思源宋体的子集，依 SIL Open Font License 1.1 授权使用。</p></div></footer>
</body></html>`;
}

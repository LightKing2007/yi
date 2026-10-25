/**
 * 下载页面：致谢并推荐适用于访客计算机的安装程序（按请求头推断，platform.ts），一键下载；
 * 另列出全部版本及其 SHA-256 校验值（SEC-070）、安装说明、校验方法、系统要求、更新与隐私。
 * 地址带 start 时（主页的下载按钮），推断确定的访客进入页面即开始下载，以 meta refresh 实现，不用脚本（API-063）。
 */
import { downloadStyle } from './downloadStyle';
import { ARROW, PLATFORMS, RELEASES, esc, fileUrl, latestVersion, megabytes, shell, type PagePkg } from './page';
import type { Detected } from './platform';

/** 首屏卡片顶部的一角棋盘：一枚棋子落定，涟漪散开 */
const CORNER = '<div class="corner wood" aria-hidden="true"><b class="st b last"></b><i class="ring"></i></div>';

/** 触屏设备上的提示：iPad 上的 Safari 自称 Mac，服务端无从区分，以 CSS 的指针类型判断后显示；已推断为手机时不需要 */
const TOUCH_NOTE = '<p class="touch-note">“弈”为桌面游戏，须在 Windows、macOS 或 Linux 计算机上安装。</p>';

/** 各操作系统的安装步骤：键为 PLATFORMS 的名称 */
const GUIDES: [string, string[]][] = [
  [
    'Windows',
    [
      '运行下载的安装程序，按提示选择安装位置。',
      '首次运行时如出现“Windows 已保护你的电脑”提示，请点击“更多信息”，再点击“仍要运行”。',
      '如需卸载，请在“设置”的“应用”中找到“弈”。',
    ],
  ],
  [
    'macOS',
    [
      '打开下载的 .dmg 文件，将“弈”拖入“应用程序”文件夹。',
      '首次打开时，请在“访达”中按住 Control 键点按该应用程序并选择“打开”，或前往“系统设置”中的“隐私与安全性”，点按“仍要打开”。',
      '如需卸载，请将“弈”从“应用程序”文件夹移到废纸篓。',
    ],
  ],
  [
    'Linux',
    [
      '为下载的文件添加执行权限：<code>chmod +x Yi-*.AppImage</code>。',
      '双击文件，或在终端中执行该文件即可运行。',
      '部分发行版须先安装 FUSE 2，例如 Ubuntu 24.04 上的 libfuse2t64 软件包。',
    ],
  ],
];

const REQUIREMENTS: [string, string][] = [
  ['macOS', 'macOS 13 Ventura 或更高版本，Apple 芯片或 Intel 芯片'],
  ['Windows', 'Windows 10 或更高版本，64 位（x64）'],
  ['Linux', 'x86_64 架构，可运行 AppImage 的桌面发行版'],
  ['显卡', '支持 WebGL2（OpenGL ES 3.0）。没有图形加速的虚拟机中可能无法运行'],
  ['网络', '单机游戏无须联网；联机对战需要连接互联网'],
];

const COMMANDS: [string, string][] = [
  ['Windows', 'Get-FileHash 文件名 -Algorithm SHA256'],
  ['macOS', 'shasum -a 256 文件名'],
  ['Linux', 'sha256sum 文件名'],
];

const checksum = (p: PagePkg) => (p.sha256 ? `<code class="sum">${p.sha256}</code>` : '<code class="sum">正在计算，请稍后刷新页面。</code>');

/** 首屏的说明：按是否自动开始下载、能否推断访客的操作系统而不同 */
function status(pkg: PagePkg | undefined, detected: Detected, starting: boolean) {
  if (detected.mobile) return '“弈”为桌面游戏，请在 Windows、macOS 或 Linux 计算机上打开本页面下载。以下列出全部版本。';
  if (!pkg) return '未能识别您的操作系统，请从下方的全部版本中选择。';
  if (starting) return '下载已经开始。如果没有开始，请点击下方的按钮。';
  return '已按您的操作系统选出对应的安装程序，点击按钮即可下载。';
}

/** 推荐的安装程序：大号卡片，含版本、大小、系统要求与校验值；Mac 的芯片为推测时另给出 Intel 版本的入口 */
function ticket(pkg: PagePkg, pkgs: PagePkg[], detected: Detected) {
  const info = PLATFORMS[pkg.platform];
  if (!info) return '';
  const intel = pkgs.find(p => p.platform === 'mac-x64');
  const alt =
    pkg.platform === 'mac-arm64' && !detected.sure && intel
      ? `<p class="alt">使用 Intel 芯片的 Mac？请<a href="${fileUrl(intel)}" download>下载 Intel 芯片版本</a>。</p>`
      : '';
  return `<article class="ticket">${CORNER}
<div class="ticket-os"><h2>${esc(info.label)}</h2><span>${esc(info.tag)}</span></div>
<dl class="ticket-meta"><div><dt>版本</dt><dd>${esc(pkg.version)}</dd></div><div><dt>大小</dt><dd>${megabytes(pkg.size)}</dd></div>
<div><dt>系统要求</dt><dd>${esc(info.req)}</dd></div></dl>
<a class="btn primary" href="${fileUrl(pkg)}" download>${ARROW}<span>下载 ${esc(info.short)}</span></a>${alt}
<div class="ticket-file"><span>${esc(pkg.file)}</span>${checksum(pkg)}</div>
</article>`;
}

function hero(pkgs: PagePkg[], detected: Detected, starting: boolean) {
  const pkg = detected.mobile ? undefined : pkgs.find(p => p.platform === detected.platform);
  const latest = latestVersion(pkgs);
  const notes = latest ? `<a href="${RELEASES}${esc(latest)}" target="_blank" rel="noopener noreferrer">版本 ${esc(latest)} 更新说明</a>` : '';
  const right = pkg
    ? ticket(pkg, pkgs, detected)
    : `<div class="ticket empty">${CORNER}<a class="btn primary" href="#all">${ARROW}<span>查看全部版本</span></a></div>`;
  return `<section class="dl-hero ink">
<div class="dl-hero-in"><div class="thanks">
<span class="label">下载</span>
<h1>感谢您<br>${detected.mobile ? '关注' : '下载'}“弈”</h1>
<p class="status${starting ? ' live' : ''}">${status(pkg, detected, starting)}</p>
${detected.mobile ? '' : TOUCH_NOTE}
<div class="hint">${notes}<a href="#all">全部版本</a><a href="#guide">安装说明</a></div>
</div>${right}</div></section>`;
}

function guide(detected: Detected) {
  const label = detected.platform ? PLATFORMS[detected.platform]?.label : undefined;
  const pick = GUIDES.some(([os]) => os === label) ? label : GUIDES[0]?.[0];
  const radios = GUIDES.map(([os]) => `<input type="radio" name="os" id="os-${os}"${os === pick ? ' checked' : ''}>`).join('');
  const tabs = GUIDES.map(([os]) => `<label for="os-${os}">${os}</label>`).join('');
  const panels = GUIDES.map(([os, steps]) => `<ol class="steps" data-os="${os}">${steps.map(step => `<li>${step}</li>`).join('')}</ol>`).join('');
  return `<section class="guide shell" id="guide">
<div class="sec-head"><span class="idx">壹</span><span class="label">安装说明</span><h2>三步完成安装</h2>
<p>安装程序尚未经过操作系统厂商的公证或签名，首次运行时系统可能给出提示，按以下步骤操作即可。</p></div>
<div class="os-pick">${radios}<div class="tabs" role="group" aria-label="操作系统">${tabs}</div>${panels}</div></section>`;
}

function row(p: PagePkg, recommended: boolean) {
  const info = PLATFORMS[p.platform];
  if (!info) return '';
  const tag = recommended ? '<em>推荐</em>' : '';
  return `<div class="row${recommended ? ' on' : ''}" role="listitem">
<div class="row-os"><b>${esc(info.label)}</b><span>${esc(info.tag)}</span>${tag}</div>
<div class="row-req">${esc(info.req)}</div><div class="row-meta">${esc(p.version)} · ${megabytes(p.size)}</div>
<a class="btn ghost" href="${fileUrl(p)}" download>${ARROW}<span>下载</span></a>
<details><summary>SHA-256 校验值</summary><span class="file">${esc(p.file)}</span>${checksum(p)}</details></div>`;
}

function all(pkgs: PagePkg[], detected: Detected) {
  const rows = pkgs.length
    ? `<div class="rows" role="list">${pkgs.map(p => row(p, p.platform === detected.platform)).join('')}</div>`
    : '<p class="none">暂无可供下载的安装程序。</p>';
  return `<section class="all ink" id="all">
<div class="sec-head"><span class="idx">贰</span><span class="label">全部版本</span><h2>其他版本</h2>
<p>如需为其他计算机下载，或使用 Intel 芯片的 Mac，请从下表中选择。下载支持断点续传。</p></div>${rows}</section>`;
}

function verify() {
  const cmds = COMMANDS.map(([os, cmd]) => `<div><span>${os}</span><code>${cmd}</code></div>`).join('');
  const reqs = REQUIREMENTS.map(([item, need]) => `<div><dt>${item}</dt><dd>${need}</dd></div>`).join('');
  return `<section class="more shell" id="verify">
<div class="cols">
<div class="col"><span class="idx">叁</span><h3>文件校验</h3>
<p>计算下载文件的 SHA-256 校验值，并与本页列出的数值比对，一致即表示文件完整且未被篡改。全部校验值亦可从 <a href="/SHA256SUMS">SHA256SUMS</a> 获取。</p>
<div class="cmds">${cmds}</div></div>
<div class="col"><span class="idx">肆</span><h3>系统要求</h3><dl class="reqs">${reqs}</dl></div>
<div class="col"><span class="idx">伍</span><h3>更新与隐私</h3>
<p>有新版本时，游戏的开始菜单及联机对战页面会给出提示，点击提示即可打开本页面。安装新版本即可完成更新，设置与段位均予以保留。</p>
<p>游戏不收集使用数据，也不上传日志，错误日志仅保存在本机。联机时，服务器仅保存匿名身份的散列值、昵称及段位分。</p></div>
</div></section>`;
}

/** 生成下载页面；starting 为地址中带 start（推断确定时进入页面即开始下载），assetVersion 用于资源地址的版本参数 */
export function downloadPage(pkgs: PagePkg[], detected: Detected, assetVersion: string, starting = false) {
  const pkg = detected.mobile ? undefined : pkgs.find(p => p.platform === detected.platform);
  const autostart = starting && detected.sure && pkg ? fileUrl(pkg) : undefined;
  return shell({
    title: '弈 · 下载',
    description: '下载“弈”：五子棋与围棋桌面游戏，提供 Windows、macOS（Apple 芯片、Intel 芯片）及 Linux 版本。',
    assetVersion,
    nav: [
      ['/', '主页'],
      ['#guide', '安装'],
      ['#all', '版本'],
      ['#verify', '校验'],
    ],
    action: ['#all', '全部版本'],
    style: downloadStyle(),
    refresh: autostart,
    body: hero(pkgs, detected, Boolean(autostart)) + guide(detected) + all(pkgs, detected) + verify(),
  });
}

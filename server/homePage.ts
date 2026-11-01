/**
 * 主页：介绍“弈”的两种棋、对局方式、功能、语言与细节，并按访客的操作系统给出下载入口。
 * 页面以黑白两色交替推进，如同对局中黑白交替落子；版式与动画见 homeStyle.ts。
 */
import { homeStyle } from './homeStyle';
import { board } from './board';
import { BURST, LATTICE, RINGS, SHAPES, stream } from './geometry';
import { featureRing } from './ring';
import { ARROW, PLATFORMS, esc, megabytes, recommended, shell, type PagePkg } from './page';
import type { Detected } from './platform';

/** 下载页面的地址；带 start 时进入页面即开始下载推荐的安装程序 */
const DOWNLOAD = '/download/';
const DOWNLOAD_START = '/download/?start';

/** 首屏棋盘（19 路）上依次落下的棋子：前八手在载入时落下，其余随页面滚动一手一手落下（见 geometry.ts） */
const HERO_MOVES = 'pd dd pp dp fq cn qf nc jj dj pj jd jp fd qc kc lq cf qn nq oc pb ed ec hq gp mp np ql rk';
const STARS_19 = 'dd jd pd dj jj pj dp jp pp';

/** 首屏的下载入口：推荐的平台、版本与大小；手机访客与无法推断时改为前往下载页面 */
function heroAction(pkgs: PagePkg[], detected: Detected) {
  const pkg = recommended(pkgs, detected);
  if (!pkg) {
    const note = detected.mobile ? '“弈”为桌面游戏，请在计算机上下载' : '提供 Windows、macOS 及 Linux 版本';
    return `<a class="btn" href="${DOWNLOAD}">${ARROW}<span>前往下载</span></a><span class="hint">${note}</span>`;
  }
  const info = PLATFORMS[pkg.platform];
  if (!info) return '';
  return (
    `<a class="btn" href="${DOWNLOAD_START}">${ARROW}<span>下载 ${esc(info.short)}</span></a>` +
    `<span class="hint">版本 ${esc(pkg.version)} · ${esc(info.tag)} · ${megabytes(pkg.size)}<a href="${DOWNLOAD}#all">其他版本</a></span>`
  );
}

/** 首屏的棋盘：19 路，可预览落子 */
const HERO_BOARD = board({ size: 19, stars: STARS_19, moves: HERO_MOVES, cls: 'wood', ghost: true });

/** 首屏只留标题、标语与下载入口（左），棋盘在右；游戏的介绍在“两种棋”一节 */
function hero(pkgs: PagePkg[], detected: Detected) {
  return `<section class="hero ink" id="top">
<div class="hero-floor" aria-hidden="true">${HERO_BOARD}</div>
<div class="hero-in"><div class="hero-left">
<div class="hero-mark"><h1 class="hero-title"><span class="mark" role="img" aria-label="弈"></span><span class="seal">棋</span></h1>
<div class="motto">以木为枰<br>以石为子</div></div>
<div class="cta">${heroAction(pkgs, detected)}</div>
</div></div>
<a class="cue" href="#games"><span>向下</span><i></i></a>
</section>`;
}

/** 五子棋：黑方沿斜线连成五子，另有一处禁手点 */
const GOMOKU = board({ size: 15, stars: 'dd ld hh dl ll', moves: 'hh hg gi ih ig gh fj jj jf', cls: 'mini wood five', line: 'fj jf', cross: 'kk' });
/** 围棋（19 路）：四角布局之后，黑方在天元四周落下最后一子，提取被围住的白子（第 5 手） */
const GO = board({ size: 19, stars: STARS_19, moves: 'pd dd pp dp jj ij kj ji jk', colors: 'bwbwwbbbb', cls: 'mini wood go' });

/** 棋种的要点：标签式的短语，不是段落 */
const tags = (items: string[]) => `<div class="facts" role="list">${items.map(item => `<span role="listitem">${item}</span>`).join('')}</div>`;

function games() {
  return `<section class="games shell reveal-circle" id="games">${SHAPES}
<div class="sec-head"><span class="idx">壹</span><span class="label">两种棋</span>
<h2 class="rv">两种棋，一方木枰</h2>
<p class="rv">“弈”是一款五子棋与围棋桌面游戏，可与好友同屏对弈、与电脑对弈，或联网与其他玩家对战。两种棋各有完整的规则实现，联机时每一手棋均由服务器校验。</p></div>
<div class="split">
<article class="game"><div class="game-num"><b>15</b><span>路</span></div>
<div class="game-art">${GOMOKU}<span class="strike" aria-hidden="true"></span></div>
<div class="game-text"><h3>五子棋<small>Gomoku</small></h3>
<p>横、竖或斜向连成五子即获胜。黑方禁手（三三、四四、长连）可在“设置”中开关，禁手点以红色小叉标示。</p>
${tags(['15 路棋盘', '黑方禁手', '获胜时击散其余棋子，可查看棋局'])}</div></article>
<article class="game"><div class="game-num"><b>19</b><span>路</span></div>
<div class="game-art">${GO}</div>
<div class="game-text"><h3>围棋<small>Go</small></h3>
<p>提供 9 路、13 路、19 路棋盘，完整支持提子、禁着点与打劫。双方连续停一手后进入点目，按数子法计分，贴 7.5 目。</p>
${tags(['9 · 13 · 19 路棋盘', '数子法', '点目时自动估算死子'])}</div></article>
</div></section>`;
}

/** 段位：自十级至九段；新玩家自四级起始 */
const RANKS = [
  '十级',
  '九级',
  '八级',
  '七级',
  '六级',
  '五级',
  '四级',
  '三级',
  '二级',
  '一级',
  '初段',
  '二段',
  '三段',
  '四段',
  '五段',
  '六段',
  '七段',
  '八段',
  '九段',
];
const START_RANK = '四级';

function modes() {
  const ranks = RANKS.map(r => `<span role="listitem"${r === START_RANK ? ' class="start"' : ''}>${r}</span>`).join('');
  return `<section class="modes ink" id="modes"><div class="modes-pin">${RINGS}
<div class="sec-head"><span class="idx">贰</span><span class="label">对局方式</span><h2>三种对局，一套规则</h2></div>
<div class="track">
<article class="mode"><span class="mode-no">一</span><h3>双人对弈</h3>
<p>同一台计算机上，两人轮流落子。可悔棋、停一手，终局后可查看棋局。</p>
<div class="keys" aria-label="快捷键"><kbd>U</kbd><span>悔棋</span><kbd>P</kbd><span>停一手</span><kbd>N</kbd><span>新局</span></div></article>
<article class="mode"><span class="mode-no">二</span><h3>人机对弈</h3>
<p>电脑分简单、普通、困难三档，玩家可执黑或执白。电脑在后台思考，思考期间界面始终流畅；围棋的普通与困难两档采用蒙特卡洛树搜索。</p>
<div class="levels" aria-hidden="true"><span><i></i>简单</span><span><i></i><i></i>普通</span><span><i></i><i></i><i></i>困难</span></div></article>
<article class="mode"><span class="mode-no">三</span><h3>联机对战</h3>
<p>匹配、排位与好友房间三种方式。悔棋、求和须经对方同意；网络中断后，60 秒内恢复连接即可继续对局。</p>
<dl class="ways"><div><dt>匹配</dt><dd>与等待最久的玩家配对</dd></div><div><dt>排位</dt><dd>按 Elo 等级分计算段位</dd></div>
<div><dt>好友</dt><dd>以四位房号邀请好友</dd></div></dl></article>
<article class="mode wide"><span class="mode-no">四</span><h3>段位</h3>
<p>排位对局按 Elo 等级分计算段位，自十级、一级、初段直至九段。新玩家自四级起始，段位与本机生成的匿名身份绑定。</p>
<div class="ranks" role="list">${ranks}</div></article>
</div><div class="progress" aria-hidden="true"><i></i></div></div></section>`;
}

/** 三种语言对照：中文、文言、英文（取自游戏的译文表） */
const PHRASES: [string, string, string][] = [
  ['五子棋', '连珠', 'Gomoku'],
  ['联机对战', '会友对弈', 'Play Online'],
  ['人机对弈', '与机弈', 'vs Computer'],
  ['悔棋', '悔着', 'Undo'],
  ['认输', '投子', 'Resign'],
];

function details() {
  const rows = PHRASES.map(([zh, lzh, en]) => `<div role="row"><span>${zh}</span><span>${lzh}</span><span lang="en">${en}</span></div>`).join('');
  return `<section class="tongues shell" id="details">${LATTICE}
<div class="sec-head"><span class="idx">肆</span><span class="label">语言与细节</span>
<h2 class="rv">文言、中文、English</h2>
<p class="rv">界面提供三种语言，可在“设置”中随时切换。浅色与深色主题、界面大小与坐标显示亦可按需调整，设置修改后自动保存。</p></div>
<div class="phrases" role="table" aria-label="三种语言对照"><div class="phrases-head" role="row"><span>中文</span><span>文言</span><span>English</span></div>${rows}</div>
<div class="figures">
<div class="fig rv"><b>60<small>秒</small></b><p>网络中断后，60 秒内恢复连接即可继续对局，掉线期间双方暂停计时。</p></div>
<div class="fig rv"><b>3<small>次</small></b><p>联机对局中，悔棋与求和须经对方同意，每局每方各限 3 次。</p></div>
<div class="fig rv"><b>7.5<small>目</small></b><p>围棋按数子法计分，黑方贴 7.5 目；点目结果须经双方确认。</p></div>
<div class="fig rv"><b>19<small>个</small></b><p>排位段位自十级、一级、初段直至九段，按 Elo 等级分升降。</p></div>
</div>${stream('tongues')}</section>`;
}

function finale(pkgs: PagePkg[], detected: Detected) {
  return `<section class="finale ink reveal-circle" id="get">${BURST}
<div class="finale-in"><span class="label">下载</span>
<h2 class="finale-title">入局</h2>
<p class="finale-lead">提供 Windows、macOS（Apple 芯片、Intel 芯片）及 Linux 版本。单机游戏无须联网，联机对战需要连接互联网。</p>
<div class="cta">${heroAction(pkgs, detected)}</div>
<div class="os-row"><span>Windows</span><span>macOS</span><span>Linux</span></div></div></section>`;
}

/** 生成主页；detected 为按请求头推断的访客操作系统，assetVersion 用于资源地址的版本参数 */
export function homePage(pkgs: PagePkg[], detected: Detected, assetVersion: string) {
  return shell({
    title: '弈 · 五子棋与围棋',
    description: '“弈”是一款五子棋与围棋桌面游戏，支持双人对弈、人机对弈与联机对战，提供 Windows、macOS 及 Linux 版本。',
    assetVersion,
    nav: [
      ['#games', '玩法'],
      ['#modes', '对局'],
      ['#features', '功能'],
      ['#details', '细节'],
      [DOWNLOAD, '下载'],
    ],
    style: homeStyle(),
    body: hero(pkgs, detected) + games() + modes() + featureRing() + details() + finale(pkgs, detected),
  });
}

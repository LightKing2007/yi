/**
 * 主页的背景几何：黑白棋子排成的二进制流（随滚动横移）、随滚动旋转的圆与方、
 * 对局方式背后的同心圆、语言一节的交叉点阵、终章的放射线与涟漪。全部是细线与小圆，只动 transform 与 opacity；
 * 随滚动推进的效果只在支持 animation-timeline 的浏览器中启用，其余浏览器以缓慢的定时动画或静止的图形代替。
 */

/** 二进制流中棋子的排列：1 为黑子，0 为白子 */
const BITS = '101100111000101101001110100110001011100101101100';
/** 二进制流中每枚棋子占的宽度（SVG 的用户单位） */
const STEP = 10;
/** 棋子的半径占 STEP 的比例 */
const STONE_RATIO = 0.34;

/** 一段图形中排列的遍数：使一段宽于最宽的屏幕，横移时不露出空白 */
const REPEATS = 4;

/** 一行二进制流：同一段棋子排两遍，横移一段的长度即首尾相接；reverse 为反向移动 */
function streamRow(pattern: string, reverse: boolean) {
  const bits = pattern.repeat(REPEATS);
  const width = bits.length * STEP;
  const half = STEP / 2;
  const radius = (STEP * STONE_RATIO).toFixed(2);
  const stones = [...bits].map((bit, i) => `<circle class="${bit === '1' ? 'b' : 'w'}" cx="${i * STEP + half}" cy="${half}" r="${radius}"/>`).join('');
  const svg = `<svg viewBox="0 0 ${width} ${STEP}" aria-hidden="true">${stones}</svg>`;
  return `<div class="stream-row${reverse ? ' rev' : ''}"><div class="stream-track">${svg}${svg}</div></div>`;
}

/** 黑白棋子排成的两行二进制流，两行反向移动 */
export function stream() {
  const shifted = BITS.slice(BITS.length / 2) + BITS.slice(0, BITS.length / 2);
  return `<div class="stream" aria-hidden="true">${streamRow(BITS, false)}${streamRow(shifted, true)}</div>`;
}

/** “两种棋”一节背后的圆与方：随滚动升降、旋转 */
export const SHAPES = '<div class="shapes" aria-hidden="true"><i class="sh-circle"><b></b></i><i class="sh-square"></i><i class="sh-diag"></i></div>';

/** 语言一节背后的交叉点阵 */
export const LATTICE = '<div class="tongues-bg" aria-hidden="true"><div class="lattice"></div></div>';

/** 对局方式背后的同心圆 */
export const RINGS = '<div class="rings" aria-hidden="true"></div>';

/** 终章背后的放射线与三道涟漪 */
export const BURST = '<div class="burst" aria-hidden="true"><i></i><i></i><i></i></div>';

/** 背景几何的样式 */
export const geometryStyle = `
/* 二进制流 */
.stream { position: relative; display: grid; gap: 10px; padding: 8px 0; overflow: clip; pointer-events: none;
  -webkit-mask: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  mask: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent); }
.stream-track { display: flex; width: max-content; animation: stream-slide 90s linear infinite; }
.stream-row.rev .stream-track { animation-direction: reverse; }
.stream svg { display: block; height: 14px; width: auto; flex: none; }
.stream circle { stroke-width: 1; }
.ink .stream .b { fill: transparent; stroke: rgb(236 231 221 / 0.35); }
.ink .stream .w { fill: rgb(236 231 221 / 0.82); stroke: none; }
.shell .stream .b { fill: #141210; stroke: none; }
.shell .stream .w { fill: transparent; stroke: rgb(20 18 16 / 0.35); }
@keyframes stream-slide { to { transform: translateX(-50%); } }
.ringsec > .stream { margin-top: clamp(40px, 6vh, 72px); }
/* 语言一节有左右留白，二进制流以负边距伸到屏幕两侧 */
.tongues > .stream { max-width: none; margin: clamp(80px, 12vh, 140px) calc(-1 * var(--gut)) 0; }
.games > .shapes, .tongues > .tongues-bg { max-width: none; margin: 0; }

/* “两种棋”背后的圆与方 */
.games { position: relative; }
.games > :not(.shapes) { position: relative; }
.shapes { position: absolute; inset: 0; overflow: clip; pointer-events: none; }
.shapes i { position: absolute; border: 1.5px solid rgb(20 18 16 / 0.2); }
.sh-circle { right: -12vmin; top: 14%; width: 72vmin; aspect-ratio: 1; border-radius: 50%; animation: spin-plain 120s linear infinite; }
.sh-circle b { position: absolute; left: 50%; top: -9px; width: 18px; height: 18px; margin-left: -9px; border-radius: 50%; background: var(--fg); }
.sh-square { left: -10vmin; bottom: 8%; width: 46vmin; aspect-ratio: 1; transform: rotate(12deg); animation: tilt 60s ease-in-out infinite alternate; }
.sh-diag { left: 0; top: 50%; width: 140%; height: 0; border-width: 1px 0 0; transform-origin: 0 0; transform: rotate(-14deg); }
@keyframes spin-plain { to { transform: rotate(360deg); } }
@keyframes tilt { from { transform: rotate(12deg); } to { transform: rotate(57deg); } }

/* 对局方式背后的同心圆 */
/* overflow: clip 不形成滚动容器，横向展示所用的 sticky 不受影响 */
.modes { overflow: clip; }
.modes-pin { position: relative; }
.modes-pin > :not(.rings) { position: relative; }
.rings { position: absolute; right: -30vmin; top: 50%; width: 120vmin; aspect-ratio: 1; margin-top: -60vmin; pointer-events: none; border-radius: 50%;
  background: repeating-radial-gradient(circle, transparent 0 calc(6vmin - 1px), rgb(236 231 221 / 0.12) calc(6vmin - 1px) 6vmin),
    repeating-conic-gradient(from 0deg, rgb(214 169 100 / 0.16) 0 0.4deg, transparent 0.4deg 15deg);
  -webkit-mask: radial-gradient(circle, #000 30%, transparent 70%); mask: radial-gradient(circle, #000 30%, transparent 70%);
  animation: spin-plain 200s linear infinite; }

/* 语言一节的交叉点阵 */
.tongues { position: relative; }
.tongues > :not(.tongues-bg) { position: relative; }
.tongues-bg { position: absolute; inset: 0; overflow: clip; pointer-events: none; }
.lattice { position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle, rgb(20 18 16 / 0.16) 1.2px, transparent 1.6px) 0 0 / 36px 36px;
  -webkit-mask: radial-gradient(60% 50% at 80% 30%, #000, transparent); mask: radial-gradient(60% 50% at 80% 30%, #000, transparent); }

/* 终章的放射线与涟漪 */
.finale > :not(.burst) { position: relative; }
.burst { position: absolute; left: 50%; top: 58%; width: 0; height: 0; pointer-events: none; }
.burst::before { content: ""; position: absolute; left: -75vmax; top: -75vmax; width: 150vmax; height: 150vmax; border-radius: 50%;
  background: repeating-conic-gradient(from 0deg, rgb(214 169 100 / 0.09) 0 0.25deg, transparent 0.25deg 7.5deg);
  -webkit-mask: radial-gradient(circle, transparent 12%, #000 22%, transparent 62%); mask: radial-gradient(circle, transparent 12%, #000 22%, transparent 62%);
  animation: spin-plain 240s linear infinite; }
.burst i { position: absolute; left: -20vmin; top: -20vmin; width: 40vmin; height: 40vmin; border-radius: 50%; border: 1px solid rgb(214 169 100 / 0.5);
  opacity: 0; animation: ripple-out 7.5s var(--ease) infinite; }
.burst i:nth-child(2) { animation-delay: 2.5s; }
.burst i:nth-child(3) { animation-delay: 5s; }
@keyframes ripple-out { 0% { opacity: 0.7; transform: scale(0.2); } 100% { opacity: 0; transform: scale(3.6); } }

/*
 * 随滚动推进：各层以不同的速度与方向移动，形成视差。容器一律用 overflow: clip 而不用 hidden：hidden 使容器成为滚动容器，
 * 其中以 view() 计算的进度改以该容器为准，不再随页面滚动。只改 translate、rotate、scale 这几个独立属性，与元素原有的 transform 叠加而不互相覆盖。
 * 首屏：文字上移并淡出、棋盘上移，其余的棋子一手一手落下；两种棋：两块棋盘一升一降并随之转动，圆与方升降旋转；
 * 语言：点阵显现；终章：“入局”放大、放射线随滚动转动
 */
@supports (animation-timeline: view()) {
@media (prefers-reduced-motion: no-preference) {
  .stream-track { animation: stream-scroll linear both; animation-timeline: view(); animation-range: cover; }
  .stream-row.rev .stream-track { animation-direction: reverse; }
  .hero-left { animation: px-hero linear both; animation-timeline: scroll(); animation-range: 0 100vh; }
  .hero-floor { animation: px-floor linear both; animation-timeline: scroll(); animation-range: 0 100vh; }
  /* 首屏棋盘随滚动略快于页面上升；前八手在载入时落下，此后每向下滚动 2.4% 屏高落下一手，往回滚则依次提起，棋盘离开屏幕前落完 */
  .hero-floor .st:nth-of-type(n + 9) { animation: drop linear both; animation-timeline: scroll();
    animation-range: calc((var(--i) - 8) * 2.4vh) calc((var(--i) - 8) * 2.4vh + 4vh); }
  .game-art { animation: px-art linear both; animation-timeline: view(); animation-range: cover; }
  .game + .game .game-art { animation-direction: reverse; }
  .game-num b { animation: px-num linear both; animation-timeline: view(); animation-range: cover; }
  .sh-circle { animation: sh-circle linear both; animation-timeline: view(); animation-range: cover; }
  .sh-square { animation: sh-square linear both; animation-timeline: view(); animation-range: cover; }
  .sh-diag { animation: sh-diag linear both; animation-timeline: view(); animation-range: cover; }
  .lattice { animation: lattice linear both; animation-timeline: view(); animation-range: cover 0% cover 60%; }
  .finale-title { animation: px-finale linear both; animation-timeline: view(); animation-range: entry 20% cover 50%; }
  .burst::before { animation: burst-turn linear both; animation-timeline: view(); animation-range: cover; }
  /* 横移的距离约与滚动的距离相当，太快则看不清棋子 */
  @keyframes stream-scroll { to { transform: translateX(-20%); } }
  @keyframes px-hero { to { translate: 0 -20vh; opacity: 0.1; } }
  @keyframes px-floor { to { translate: 0 -10vh; } }
  @keyframes px-art { from { translate: 0 110px; rotate: -6deg; } to { translate: 0 -110px; rotate: 5deg; } }
  @keyframes px-num { from { translate: 0 80px; } to { translate: 0 -60px; } }
  @keyframes sh-circle { from { translate: 0 30vh; rotate: 0deg; } to { translate: 0 -30vh; rotate: 320deg; } }
  @keyframes sh-square { from { translate: 0 -20vh; rotate: -30deg; } to { translate: 0 35vh; rotate: 90deg; } }
  @keyframes sh-diag { from { rotate: -12deg; } to { rotate: 12deg; } }
  @keyframes lattice { from { opacity: 0; background-position: 0 60px; } to { opacity: 1; background-position: 0 0; } }
  @keyframes px-finale { from { scale: 0.7; opacity: 0.2; } to { scale: 1; opacity: 1; } }
  @keyframes burst-turn { from { rotate: -40deg; } to { rotate: 50deg; } }
}
@media (prefers-reduced-motion: no-preference) and (min-width: 960px) {
  .rings { animation: rings linear both; animation-timeline: --modes; animation-range: contain 0% contain 100%; }
  @keyframes rings { from { scale: 0.6; rotate: 0deg; } to { scale: 1.4; rotate: 120deg; } }
}
}
/* 窄屏上棋盘与数字上下排列，二者的视差会相互遮挡 */
@media (max-width: 640px) {
  .game-art, .game-num b { animation: none; }
}
@media (max-width: 960px) {
  .sh-diag { display: none; }
  .rings { right: -50vmin; }
}
`;

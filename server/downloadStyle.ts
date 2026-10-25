/**
 * 下载页面的样式（数据文件）：首屏的致谢与作为下载按钮的白子、按操作系统切换的安装步骤（以单选框实现）、全部版本的列表、校验与须知。
 */
import { geometryStyle } from './geometry';
import { minify } from './pageStyle';

/** 安装说明中可切换的操作系统（与 downloadPage.ts 的 GUIDES 一致） */
const GUIDE_OS = ['Windows', 'macOS', 'Linux'];

/** 选中的操作系统：标签的选中样式、键盘焦点与对应的步骤 */
const tabRules = () =>
  GUIDE_OS.map(
    os =>
      `#os-${os}:checked ~ .tabs label[for="os-${os}"] { background: var(--fg); color: var(--bg); border-color: var(--fg); }\n` +
      `#os-${os}:focus-visible ~ .tabs label[for="os-${os}"] { outline: 2px solid var(--kaya); outline-offset: 3px; }\n` +
      `#os-${os}:checked ~ .steps[data-os="${os}"] { visibility: visible; }`,
  ).join('\n');

/** 下载页面专有的样式 */
export const downloadStyle = () => minify(geometryStyle + hero + guide + rows + more + tabRules() + motion);

const hero = `
.dl-hero { position: relative; overflow: clip; background: radial-gradient(80% 70% at 78% 40%, #2a2118 0, #13100d 50%, var(--ink) 80%); }
.dl-hero-in { position: relative; max-width: var(--max); margin: 0 auto; min-height: min(100svh, 920px); padding: 140px var(--gut) 110px;
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 480px); gap: clamp(40px, 7vw, 120px); align-items: center; }
.thanks .label { animation: rise 0.9s var(--ease) 0.1s both; }
.thanks h1 { margin-top: 26px; font: 900 clamp(52px, 7.2vw, 112px)/1.08 var(--serif); letter-spacing: 0.02em; animation: rise 1.1s var(--ease) 0.2s both; }
.status { position: relative; margin-top: 34px; max-width: 26em; padding-left: 26px; font-size: 17px; color: var(--dim);
  animation: rise 1.1s var(--ease) 0.35s both; }
.status::before { content: ""; position: absolute; left: 0; top: 0.62em; width: 10px; height: 10px; border-radius: 50%; background: var(--fg); }
.status.live::before { background: var(--kaya); box-shadow: 0 0 0 0 rgb(214 169 100 / 0.6); animation: pulse 1.8s var(--ease) infinite; }
.touch-note { display: none; margin-top: 14px; padding-left: 26px; font-size: 15px; color: var(--accent); }
@media (hover: none) and (pointer: coarse) { .touch-note { display: block; } }
.thanks .hint { margin-top: 30px; gap: 8px 26px; animation: rise 1.1s var(--ease) 0.5s both; }
/*
 * 推荐的安装程序：不用卡片，一枚大号白子就是下载按钮，落在背景棋盘网格的交叉点上（与主页首屏一致）；
 * 其下以文字排出平台名称、版本、大小与系统要求，校验值折叠在最下方
 */
.pick { display: grid; justify-items: center; text-align: center; animation: pick-in 1.3s var(--ease) 0.3s both; }
/* --stone 为白子的直径，--cell 为背景网格的格距：略大于白子，如同棋子落在棋盘上 */
.stone-wrap { position: relative; isolation: isolate; --stone: clamp(150px, 14vw, 200px); --cell: calc(var(--stone) * 1.06); }
/*
 * 背景的棋盘网格：以白子的中心为准排布，白子正落在一个交叉点上。网格的宽、高都是格距的偶数倍，
 * 居中后中心恰为网格线的交点；向四周渐隐
 */
.stone-grid { position: absolute; z-index: -1; left: 50%; top: calc(var(--stone) / 2); width: calc(var(--cell) * 16); height: calc(var(--cell) * 10);
  transform: translate(-50%, -50%); pointer-events: none;
  background: linear-gradient(rgb(236 231 221 / 0.1) 1px, transparent 1px) 0 0 / var(--cell) var(--cell),
    linear-gradient(90deg, rgb(236 231 221 / 0.1) 1px, transparent 1px) 0 0 / var(--cell) var(--cell);
  -webkit-mask: radial-gradient(closest-side, #000 15%, transparent); mask: radial-gradient(closest-side, #000 15%, transparent); }
.stone-btn { display: grid; justify-items: center; gap: 26px; text-decoration: none; color: var(--fg); }
.stone { position: relative; display: grid; place-items: center; width: var(--stone); aspect-ratio: 1; border-radius: 50%;
  color: var(--ink);
  background:
    radial-gradient(ellipse 34% 24% at 36% 28%, rgb(255 255 255 / 0.95), transparent 70%),
    repeating-radial-gradient(circle at 50% 135%, rgb(150 130 100 / 0.03) 0 1.2%, transparent 1.2% 2.4%),
    radial-gradient(circle at 70% 84%, rgb(190 205 215 / 0.45), transparent 45%),
    radial-gradient(circle at 42% 38%, #fdfbf6 0, #efe9de 50%, #d6cdbd 88%, #c2b7a4 100%);
  box-shadow: 0 3px 4px rgb(0 0 0 / 0.5), 0 30px 60px -18px rgb(0 0 0 / 0.85), inset 0 -6px 14px rgb(120 100 70 / 0.35);
  transition: transform 0.6s cubic-bezier(0.3, 1.4, 0.5, 1), box-shadow 0.6s var(--ease); }
.stone .ico { width: 26%; height: 26%; transition: transform 0.5s var(--ease); }
.stone::after { content: ""; position: absolute; inset: 0; border-radius: 50%; border: 1px solid rgb(236 231 221 / 0.6); opacity: 0;
  animation: stone-ripple 3.2s var(--ease) 2s infinite; }
.stone-label { position: relative; font-size: 16px; letter-spacing: 0.22em; padding-bottom: 6px; }
.stone-label::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 1px; background: currentColor;
  transform: scaleX(0.3); transition: transform 0.5s var(--ease); }
.stone-btn:hover .stone { transform: translateY(-6px) scale(1.04);
  box-shadow: 0 3px 4px rgb(0 0 0 / 0.5), 0 44px 80px -20px rgb(0 0 0 / 0.9), inset 0 -6px 14px rgb(120 100 70 / 0.35); }
.stone-btn:hover .ico { transform: translateY(3px); }
.stone-btn:hover .stone-label::after { transform: scaleX(1); }
.stone-btn:focus-visible { outline: none; }
.stone-btn:focus-visible .stone { outline: 2px solid var(--kaya); outline-offset: 6px; }
.pick-os { display: flex; align-items: baseline; justify-content: center; gap: 12px; margin-top: 46px; }
.pick-os h2 { font: 900 clamp(40px, 4vw, 60px)/1 var(--serif); }
.pick-os span { font-size: 14px; letter-spacing: 0.1em; color: var(--accent); }
.pick-meta { display: flex; flex-wrap: wrap; justify-content: center; margin-top: 14px; font-size: 14px; color: var(--dim); }
.pick-meta span + span::before { content: "·"; margin: 0 12px; color: var(--faint); }
.alt { margin-top: 12px; font-size: 14px; color: var(--dim); }
.alt a { color: var(--fg); text-underline-offset: 4px; }
.sum-fold { position: relative; display: inline-block; font-size: 13px; color: var(--faint); cursor: pointer; outline: none; }
.sum-trigger { display: inline-flex; align-items: center; gap: 8px; transition: color 0.3s var(--ease); }
.sum-trigger::before { content: ""; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg); transition: transform 0.35s var(--ease); }
.sum-fold:hover .sum-trigger, .sum-fold:focus-within .sum-trigger { color: var(--fg); }
.sum-fold:focus-within .sum-trigger::before { transform: rotate(45deg); }
.sum-fold:focus-visible .sum-trigger { outline: 2px solid var(--kaya); outline-offset: 4px; border-radius: 4px; }
/* 浮层只在获得焦点时显示，不占版面，显示与收起时周围的排版不动 */
.sum-pop { display: none; cursor: auto; position: absolute; z-index: 6; top: calc(100% + 10px); left: 0; width: min(31em, 86vw);
  padding: 14px 16px; border-radius: 12px;
  background: #18150f; box-shadow: 0 0 0 1px rgb(236 231 221 / 0.12), 0 24px 50px -16px rgb(0 0 0 / 0.85); text-align: left;
  animation: pop-in 0.3s var(--ease) both; }
.sum-pop .file { display: block; font: 12px/1.6 var(--mono); color: var(--dim); }
.sum-pop code.sum { margin-top: 8px; }
.pick-sum { margin-top: 22px; }
.pick-sum .sum-pop { left: 50%; translate: -50% 0; }
.sum-fold:focus-within .sum-pop { display: block; }
@keyframes pop-in { from { opacity: 0; transform: translateY(-6px); } }
code.sum { display: block; padding: 8px 10px; border-radius: 8px; background: rgb(236 231 221 / 0.05); font: 11.5px/1.6 var(--mono); color: var(--dim);
  word-break: break-all; user-select: all; }
@keyframes stone-ripple { 0% { opacity: 0.7; transform: scale(1); } 80%, 100% { opacity: 0; transform: scale(1.9); } }
@keyframes pick-in { from { opacity: 0; transform: translateY(40px) scale(0.96); } to { opacity: 1; transform: none; } }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgb(214 169 100 / 0.6); } 100% { box-shadow: 0 0 0 14px rgb(214 169 100 / 0); } }
`;

const guide = `
.guide, .all, .more { padding: clamp(100px, 15vh, 180px) var(--gut); }
.guide > *, .all > *, .more > * { max-width: var(--max); margin-left: auto; margin-right: auto; }
/* 三个操作系统的步骤叠放在同一格中，高度取最高的一组：切换时只换显示的一组，页面高度与下方的排版不动 */
.os-pick { position: relative; display: grid; }
.os-pick > .tabs { grid-row: 1; }
.os-pick > .steps { grid-row: 2; grid-column: 1; }
.os-pick > input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.tabs { display: flex; gap: 8px; margin-top: clamp(40px, 7vh, 72px); }
.tabs label { padding: 9px 22px; border: 1px solid var(--line); border-radius: 999px; font-size: 14px; letter-spacing: 0.08em; color: var(--dim);
  cursor: pointer;
  transition: background 0.35s var(--ease), color 0.35s var(--ease), border-color 0.35s var(--ease); }
.tabs label:hover { border-color: var(--fg); color: var(--fg); }
.steps { list-style: none; display: grid; visibility: hidden; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(20px, 3vw, 48px);
  margin-top: 40px; padding: 0;
  counter-reset: step; }
.steps li { position: relative; padding-top: 34px; border-top: 1px solid var(--fg); color: var(--dim); counter-increment: step;
  animation: rise 0.7s var(--ease) both; }
.steps li::before { content: counter(step, cjk-decimal); display: grid; place-items: center; width: 56px; height: 56px; margin-bottom: 20px;
  border-radius: 50%; font: 900 22px/1 var(--serif); color: #f3efe7;
  background: var(--stone-b); box-shadow: 0 10px 18px -8px rgb(0 0 0 / 0.55); }
.steps li:nth-child(2) { animation-delay: 0.08s; }
.steps li:nth-child(3) { animation-delay: 0.16s; }
.steps code, .more code { padding: 1px 6px; border-radius: 5px; background: rgb(20 18 16 / 0.07); font: 13px var(--mono); word-break: break-all; }
`;

const rows = `
.rows { margin: clamp(48px, 8vh, 90px) auto 0; border-top: 1px solid var(--line); }
.row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1.4fr) minmax(0, 0.8fr) auto; align-items: center; gap: 8px 28px;
  padding: 26px 0; border-bottom: 1px solid var(--line); transition: background 0.4s var(--ease), padding 0.5s var(--ease); }
.row:hover { background: rgb(236 231 221 / 0.03); padding-left: 16px; padding-right: 16px; }
.row-os { display: flex; align-items: baseline; gap: 12px; }
.row-os b { font: 900 clamp(24px, 2.4vw, 32px)/1.1 var(--serif); }
.row-os span { font-size: 13px; letter-spacing: 0.16em; color: var(--dim); }
.row-os em { font-style: normal; font-size: 12px; padding: 2px 10px; border-radius: 999px; background: var(--kaya); color: var(--ink); letter-spacing: 0.16em; }
.row-req, .row-meta { font-size: 14px; color: var(--dim); }
.row .btn { height: 46px; }
.row .row-sum { grid-column: 1 / -1; justify-self: start; }
.none { margin-top: 48px; color: var(--dim); }
@media (max-width: 860px) {
  .dl-hero-in { grid-template-columns: 1fr; padding-top: 120px; min-height: 0; }
  .steps { grid-template-columns: 1fr; }
  .row { grid-template-columns: 1fr auto; }
  .row-req, .row-meta { grid-column: 1; }
  .row .btn { grid-column: 2; grid-row: 1 / span 3; }
}
@media (max-width: 520px) {
  .row { grid-template-columns: 1fr; }
  .row .btn { grid-column: 1; grid-row: auto; justify-self: start; }
}
`;

const more = `
.cols { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(28px, 4vw, 64px); }
.col .idx { margin-bottom: 26px; }
.col h3 { margin-bottom: 16px; }
.col p { color: var(--dim); font-size: 15px; }
.col p + p { margin-top: 12px; }
.col a { text-underline-offset: 4px; }
.cmds { margin-top: 22px; display: grid; gap: 10px; }
.cmds div { display: grid; gap: 4px; padding: 12px 14px; border-radius: 12px; background: var(--shell-2); }
.cmds span { font-size: 12px; letter-spacing: 0.2em; color: var(--faint); }
.cmds code { padding: 0; background: none; font-size: 13px; color: var(--fg); user-select: all; }
.reqs { margin: 0; display: grid; gap: 0; }
.reqs div { padding: 12px 0; border-bottom: 1px solid var(--line); }
.reqs div:first-child { padding-top: 0; }
.reqs dt { font: 900 16px/1.4 var(--serif); }
.reqs dd { margin: 4px 0 0; font-size: 14px; color: var(--dim); }
@media (max-width: 960px) { .cols { grid-template-columns: 1fr; } }
`;

/**
 * 与主页一致的背景几何与动效：各节以圆形自下升起（黑白交替）、安装说明背后的圆与方、
 * 全部版本背后的同心圆与二进制流、须知背后的交叉点阵；首屏的文字与白子随滚动以不同速度离开
 */
const motion = `
.guide, .all, .more { position: relative; }
.all { overflow: clip; }
.guide > :not(.shapes), .all > :not(.rings), .more > :not(.tongues-bg) { position: relative; }
.guide > .shapes, .more > .tongues-bg { position: absolute; max-width: none; margin: 0; }
.all > .rings { max-width: none; margin-right: 0; margin-left: 0; }
.all > .stream { max-width: none; margin: 0 calc(-1 * var(--gut)) clamp(48px, 8vh, 90px); }
@supports (animation-timeline: view()) {
@media (prefers-reduced-motion: no-preference) {
  .dl-hero::after, .guide::after, .all::after { content: ""; display: block; height: var(--overlap); }
  .guide::before, .all::before, .more::before { content: ""; display: block; height: 40vh; }
  .thanks { animation: px-copy linear both; animation-timeline: scroll(); animation-range: 0 100vh; }
  .pick { animation: pick-in 1.3s var(--ease) 0.3s both, px-title linear both; animation-timeline: auto, scroll();
    animation-range: normal, 0 100vh; }
  .all .rings { animation: dl-rings linear both; animation-timeline: view(); animation-range: cover; }
  @keyframes px-copy { to { translate: 0 -36vh; opacity: 0; } }
  @keyframes px-title { to { translate: 0 -14vh; } }
  @keyframes dl-rings { from { scale: 0.7; rotate: 0deg; } to { scale: 1.3; rotate: 120deg; } }
}
}
`;

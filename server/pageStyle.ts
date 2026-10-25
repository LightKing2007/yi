/**
 * 网站页面共用的样式（数据文件）：色彩与字体、黑白两种区块、顶栏、按钮、棋盘与棋子、页脚、随滚动出现的动画。
 * 设计以黑白交替为主线：区块分为墨色（.ink）与贝色（.shell）两种，顶栏以 difference 混合模式在两种底色上自动反色；
 * 榧木色只用于棋盘与少量强调。动画与交互全部以 CSS 实现，不使用脚本（API-063）。系统设置了“减弱动态效果”时关闭全部动画。
 * 随滚动推进的动画（animation-timeline）只在支持的浏览器中启用，其他浏览器直接显示最终状态。
 */

/** 样式中资源地址的版本参数的占位符 */
const VERSION_SLOT = '{version}';
/** 页面样式；version 为资源地址的版本参数，换版本时浏览器重新取字体。注释只留在源码里，不发给浏览器 */
export const siteStyle = (version: string) => minify(base + stones + motion).replaceAll(VERSION_SLOT, version);

/** 去掉注释与多余的空白 */
export const minify = (css: string) =>
  css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\n\s*/g, '\n')
    .trim();

const base = `
@font-face { font-family: "Yi Serif"; src: url("/assets/yi-serif-900.woff2?v={version}") format("woff2"); font-weight: 900; font-display: swap; }
@font-face { font-family: "Yi Serif"; src: url("/assets/yi-serif-400.woff2?v={version}") format("woff2"); font-weight: 400; font-display: swap; }
:root {
  --ink: #0b0a09; --ink-2: #151310; --shell: #f3efe7; --shell-2: #e8e2d6;
  --kaya: #d6a964; --kaya-2: #b58443; --seal: #b23a2c; --seal-ink: #fbefe6;
  --serif: "Yi Serif", "Songti SC", "STSong", "Noto Serif CJK SC", "Source Han Serif SC", serif;
  --sans: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --ease: cubic-bezier(0.22, 0.8, 0.2, 1); --ease-io: cubic-bezier(0.65, 0, 0.35, 1);
  --gut: clamp(20px, 5vw, 72px); --max: 1280px; --edge: max(var(--gut), (100vw - var(--max)) / 2);
  --title: url("/assets/title-yi.png?v={version}");
  color-scheme: dark;
}
.ink { --bg: var(--ink); --fg: #ece7dd; --dim: #a39b8e; --faint: #8a8276; --line: rgb(236 231 221 / 0.12); --accent: var(--kaya); --on-accent: var(--ink);
  background: var(--bg); color: var(--fg); color-scheme: dark; }
.shell { --bg: var(--shell); --fg: #141210; --dim: #5f584e; --faint: #696155; --line: rgb(20 18 16 / 0.12); --accent: var(--ink); --on-accent: var(--shell);
  background: var(--bg); color: var(--fg); color-scheme: light; }
* { box-sizing: border-box; }
html { background: var(--ink); scroll-behavior: smooth; -webkit-text-size-adjust: 100%; overflow-x: clip; }
body { margin: 0; background: var(--ink); color: #ece7dd; font: 16px/1.75 var(--sans); -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility; }
::selection { background: var(--seal); color: var(--seal-ink); }
a { color: inherit; }
h1, h2, h3 { margin: 0; font-weight: 900; }
p { margin: 0; }
:focus-visible { outline: 2px solid var(--kaya); outline-offset: 3px; border-radius: 4px; }
.skip { position: fixed; left: 16px; top: -60px; z-index: 100; padding: 8px 14px; border-radius: 8px; background: var(--shell); color: var(--ink);
  text-decoration: none; transition: top 0.3s var(--ease); }
.skip:focus { top: 12px; }
.glyph { display: inline-block; width: 22px; aspect-ratio: 568 / 646; background: currentColor;
  -webkit-mask: var(--title) center / contain no-repeat; mask: var(--title) center / contain no-repeat; }
.seal { display: inline-flex; align-items: center; justify-content: center; border-radius: 5px; background: var(--seal); color: var(--seal-ink);
  font: 900 1em/1 var(--serif); }

/* 顶栏：白色文字以 difference 混合，在墨色区块上为白、在贝色区块上为黑 */
.bar { position: fixed; inset: 0 0 auto; z-index: 50; height: 72px; padding: 0 var(--gut); display: flex; align-items: center; gap: 40px;
  color: #fff; mix-blend-mode: difference; pointer-events: none; }
.bar a { pointer-events: auto; text-decoration: none; }
.logo { display: flex; align-items: center; gap: 10px; }
.logo .glyph { width: 26px; transition: transform 0.6s var(--ease); }
.logo .seal { display: none; }
.logo:hover .glyph { transform: rotate(-6deg) scale(1.06); }
.bar nav { display: flex; gap: 34px; margin-left: auto; font-size: 14px; letter-spacing: 0.24em; }
.bar nav a { position: relative; padding: 6px 0; opacity: 0.72; transition: opacity 0.3s var(--ease); }
.bar nav a::after { content: ""; position: absolute; left: 50%; bottom: 0; width: 4px; height: 4px; border-radius: 50%; background: currentColor;
  transform: translateX(-50%) scale(0); transition: transform 0.4s var(--ease); }
.bar nav a:hover { opacity: 1; }
.bar nav a:hover::after { transform: translateX(-50%) scale(1); }
.pill { display: inline-flex; align-items: center; height: 38px; padding: 0 20px; border: 1px solid currentColor; border-radius: 999px;
  font-size: 14px; letter-spacing: 0.2em; transition: background 0.35s var(--ease), color 0.35s var(--ease); }
.pill:hover { background: #fff; color: #000; }

/* 区块的通用排版 */
.sec-head { display: grid; grid-template-columns: auto 1fr; column-gap: 18px; row-gap: 22px; align-items: center; max-width: 52em; }
.sec-head > :not(.idx, .label) { grid-column: 1 / -1; }
.idx { width: 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; font: 900 15px/1 var(--serif);
  background: var(--fg); color: var(--bg); box-shadow: 0 6px 14px -6px rgb(0 0 0 / 0.5); }
.label { font-size: 13px; letter-spacing: 0.42em; color: var(--dim); }
h2 { font: 900 clamp(36px, 5.4vw, 80px)/1.12 var(--serif); letter-spacing: 0.01em; text-wrap: balance; }
.sec-head p { max-width: 34em; font-size: clamp(16px, 1.3vw, 18px); color: var(--dim); }
h3 { font: 900 clamp(22px, 2vw, 28px)/1.3 var(--serif); }

/* 按钮：主按钮悬停时，一枚棋子从图标处铺开 */
.btn { position: relative; isolation: isolate; overflow: hidden; display: inline-flex; align-items: center; gap: 14px; height: 58px; padding: 0 30px 0 10px;
  border-radius: 999px; font: 500 16px/1 var(--sans); letter-spacing: 0.08em; text-decoration: none; white-space: nowrap;
  background: var(--fg); color: var(--bg); transition: transform 0.5s var(--ease), box-shadow 0.5s var(--ease); }
.btn .ico { width: 38px; height: 38px; padding: 10px; border-radius: 50%; background: var(--bg); color: var(--fg); flex: none;
  transition: transform 0.5s var(--ease); }
.btn::before { content: ""; position: absolute; z-index: -1; left: 10px; top: 50%; width: 38px; height: 38px; margin-top: -19px; border-radius: 50%;
  background: var(--kaya); transform: scale(0); transition: transform 0.7s var(--ease); }
.btn:hover { transform: translateY(-2px); box-shadow: 0 18px 40px -18px rgb(0 0 0 / 0.55); color: var(--ink); }
.btn:hover::before { transform: scale(14); }
.btn:hover .ico { transform: translateY(2px); background: var(--ink); color: var(--kaya); }
.btn:active { transform: translateY(0) scale(0.98); }
.btn.ghost { background: transparent; color: var(--fg); box-shadow: inset 0 0 0 1px var(--line); padding: 0 26px; }
.btn.ghost:hover { box-shadow: inset 0 0 0 1px var(--fg); color: var(--fg); transform: translateY(-2px); }
.btn.ghost::before { display: none; }
.hint { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; font-size: 13px; letter-spacing: 0.06em; color: var(--dim); }
.hint a { color: var(--fg); text-underline-offset: 4px; text-decoration-thickness: 1px; }
.cta { display: flex; flex-wrap: wrap; align-items: center; gap: 18px 26px; }

/* 页脚 */
.foot { position: relative; background: var(--ink); color: #8d857a; font-size: 13px; border-top: 1px solid rgb(236 231 221 / 0.1); }
.foot-in { max-width: var(--max); margin: 0 auto; padding: 56px var(--gut) 64px; display: grid; grid-template-columns: 1fr auto; gap: 28px 40px; }
.foot-brand { display: flex; align-items: center; gap: 16px; color: #ece7dd; }
.foot-brand .glyph { width: 30px; }
.foot-motto { font: 400 15px/1 var(--serif); letter-spacing: 0.3em; color: #a39b8e; }
.foot-links { display: flex; gap: 28px; align-items: center; }
.foot-links a { text-decoration: none; transition: color 0.3s var(--ease); }
.foot-links a:hover { color: #ece7dd; }
.foot-legal { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px 28px; padding-top: 24px; border-top: 1px solid rgb(236 231 221 / 0.08); }
.icp { display: inline-flex; align-items: center; gap: 6px; text-decoration: none; }
.icp:hover { color: #ece7dd; }
@media (max-width: 720px) {
  .bar { height: 60px; }
  .bar nav { display: none; }
  .bar .pill { margin-left: auto; }
  .foot-in { grid-template-columns: 1fr; }
  .foot-links { flex-wrap: wrap; gap: 12px 24px; }
  .btn { height: 54px; }
}
`;

/** 棋子与榧木纹理：带高光与投影的黑白棋子（主页的棋盘与下载页面的卡片共用） */
const stones = `
.wood { background:
    radial-gradient(120% 80% at 22% 10%, rgb(255 240 205 / 0.35), transparent 55%),
    repeating-linear-gradient(91deg, rgb(110 62 18 / 0.08) 0 1px, transparent 1px 7px),
    repeating-linear-gradient(89.4deg, rgb(110 62 18 / 0.06) 0 2px, transparent 2px 19px),
    repeating-linear-gradient(90.7deg, rgb(255 236 200 / 0.09) 0 3px, transparent 3px 29px),
    linear-gradient(170deg, #ecd09a, #ddb673 55%, #c99a52);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.4), inset 0 -2px 0 rgb(0 0 0 / 0.08); }
.st { position: absolute; width: calc(100% / (var(--n) - 1) * 0.94); aspect-ratio: 1; border-radius: 50%; transform: translate(-50%, -50%);
  font-size: calc((100cqi - 2 * var(--pad)) / (var(--n) - 1)); }
/* 黑子仿云子：窗形的柔光高光、背光一侧透出墨绿；白子仿贝壳：温润的底色、细纹与边缘透光。投影分两层：贴盘的接触阴影与柔和的投影 */
.st.b { background:
    radial-gradient(ellipse 30% 20% at 36% 27%, rgb(255 255 255 / 0.5), rgb(255 255 255 / 0.08) 65%, transparent 100%),
    radial-gradient(circle at 72% 82%, rgb(70 110 95 / 0.38), transparent 42%),
    radial-gradient(circle at 42% 36%, #3c3c3b 0, #181817 42%, #070707 78%, #000 100%);
  box-shadow: 0 0.05em 0.05em rgb(0 0 0 / 0.55), 0.1em 0.2em 0.3em rgb(0 0 0 / 0.38), inset 0 -0.05em 0.1em rgb(0 0 0 / 0.6); }
.st.w { background:
    radial-gradient(ellipse 34% 24% at 36% 28%, rgb(255 255 255 / 0.95), transparent 70%),
    repeating-radial-gradient(circle at 50% 135%, rgb(150 130 100 / 0.07) 0 2.5%, transparent 2.5% 5%),
    radial-gradient(circle at 70% 84%, rgb(190 205 215 / 0.45), transparent 45%),
    radial-gradient(circle at 42% 38%, #fdfbf6 0, #efe9de 50%, #d6cdbd 88%, #c2b7a4 100%);
  box-shadow: 0 0.05em 0.05em rgb(50 30 5 / 0.45), 0.1em 0.2em 0.3em rgb(60 40 10 / 0.3), inset 0 -0.05em 0.12em rgb(120 100 70 / 0.35); }
.st.last::before { content: ""; position: absolute; left: 50%; top: 50%; width: 24%; height: 24%; border-radius: 50%; transform: translate(-50%, -50%);
  background: var(--seal); z-index: 1; }
`;

/** 动画：入场、随滚动出现与“减弱动态效果” */
const motion = `
@keyframes rise { from { opacity: 0; transform: translateY(28px); } to { opacity: 1; transform: none; } }
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes drop {
  0% { opacity: 0; transform: translate(-50%, -50%) translateY(-30%) scale(1.35); filter: blur(2px); }
  55% { opacity: 1; transform: translate(-50%, -50%) scale(0.95); filter: none; }
  100% { opacity: 1; transform: translate(-50%, -50%); }
}
/* 区块以一枚圆形自下升起：圆心在区块顶边之下、与顶边相切，看到的始终是完整的圆弧而不是被顶边截平的半圆；
   进入完成时再扩到整个区块，较高的区块下部也不被裁去 */
@keyframes circle-in {
  from { clip-path: circle(0 at 50% 0); } 60% { clip-path: circle(70vmax at 50% 70vmax); } to { clip-path: circle(150% at 50% 0); }
}
@supports (animation-timeline: view()) {
  .rv { animation: rise linear both; animation-timeline: view(); animation-range: entry 5% entry 75%; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;

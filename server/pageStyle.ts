/**
 * 下载页面的样式（数据文件，COD-040 按 1000 行计）。主题为棋盘：纸色底上的淡棋盘格、榧木棋盘、云子与贝纹白子；
 * 动画与交互全部以 CSS 实现，不使用脚本（API-063 不允许任何脚本）。系统设置了“减弱动态效果”时关闭全部动画。
 * 标题与印章的样式与游戏开始菜单一致（src/ui/styles.css 的 .brand、.seal）。
 */

/** 页面样式；v 为资源地址的版本参数，换版本时浏览器重新取字体。注释只留在源码里，不发给浏览器 */
export const pageStyle = (v: string) => css(v).replace(/\/\*[\s\S]*?\*\//g, '');

const css = (v: string) => `
@font-face { font-family: "Yi Serif"; src: url("/assets/yi-serif-900.woff2?v=${v}") format("woff2"); font-weight: 700 900; font-display: swap; }
:root {
  --paper: #f2eadb; --paper-deep: #e6dac4; --ink: #29241e; --dim: #6c6052; --faint: #a09381; --line: rgb(70 45 15 / 0.075);
  --card: rgb(255 252 246 / 0.74); --card-line: rgb(80 55 25 / 0.12); --seal: rgb(176 52 40 / 0.94); --seal-ink: #faeee4;
  --wood-1: #edd29d; --wood-2: #e0b977; --wood-3: #cf9d53; --wood-edge: #b0803f; --wood-side: #94672f; --grid: rgb(48 30 10 / 0.72);
  --btn: #27221c; --btn-text: #f7f2e8; --code: rgb(80 55 25 / 0.07);
  --lift: 0 1px 0 rgb(255 255 255 / 0.65) inset, 0 22px 44px -26px rgb(70 45 15 / 0.5), 0 6px 14px -8px rgb(70 45 15 / 0.2);
  --lift-hover: 0 1px 0 rgb(255 255 255 / 0.7) inset, 0 34px 60px -28px rgb(70 45 15 / 0.55), 0 10px 22px -10px rgb(70 45 15 / 0.25);
  --serif: "Yi Serif", "Songti SC", "STSong", "Noto Serif CJK SC", serif;
  --sans: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", system-ui, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --ease: cubic-bezier(0.2, 0.7, 0.2, 1);
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper: #17130f; --paper-deep: #100d0a; --ink: #ede5d7; --dim: #a99c89; --faint: #6f6556; --line: rgb(255 230 190 / 0.045);
    --card: rgb(42 35 28 / 0.72); --card-line: rgb(255 230 190 / 0.09); --seal-ink: #fbefe6;
    --wood-1: #9a7444; --wood-2: #845f35; --wood-3: #6c4b28; --wood-edge: #503517; --wood-side: #3b2611; --grid: rgb(18 10 3 / 0.78);
    --btn: #ede5d7; --btn-text: #1b1712; --code: rgb(255 230 190 / 0.07);
    --lift: 0 1px 0 rgb(255 255 255 / 0.04) inset, 0 22px 44px -26px rgb(0 0 0 / 0.8), 0 6px 14px -8px rgb(0 0 0 / 0.5);
    --lift-hover: 0 1px 0 rgb(255 255 255 / 0.05) inset, 0 34px 60px -28px rgb(0 0 0 / 0.85), 0 10px 22px -10px rgb(0 0 0 / 0.55);
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; -webkit-text-size-adjust: 100%; }
body {
  margin: 0; color: var(--ink); font: 16px/1.8 var(--sans); -webkit-font-smoothing: antialiased; background-color: var(--paper);
  background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size: 52px 52px; background-position: center -1px;
}
body::before {
  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: -1;
  background: radial-gradient(120% 70% at 50% 0%, transparent 35%, var(--paper) 85%);
}
::selection { background: var(--seal); color: var(--seal-ink); }
a { color: inherit; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 0 24px; }

/* 顶栏 */
.top { position: sticky; top: 0; z-index: 10; backdrop-filter: saturate(1.4) blur(14px); -webkit-backdrop-filter: saturate(1.4) blur(14px);
  background: color-mix(in srgb, var(--paper) 72%, transparent); border-bottom: 1px solid var(--card-line); }
.top .wrap { display: flex; align-items: center; gap: 28px; height: 60px; }
.top .home { display: flex; align-items: center; gap: 10px; text-decoration: none; font: 900 20px/1 var(--serif); }
.top .home img { width: 28px; height: 28px; border-radius: 7px; }
.top nav { display: flex; gap: 22px; margin-left: auto; font-size: 14px; }
.top nav a { text-decoration: none; color: var(--dim); position: relative; transition: color 0.3s var(--ease); }
.top nav a::after { content: ""; position: absolute; left: 0; right: 0; bottom: -4px; height: 1px; background: currentColor;
  transform: scaleX(0); transition: transform 0.4s var(--ease); }
.top nav a:hover { color: var(--ink); }
.top nav a:hover::after { transform: scaleX(1); }

/* 首屏 */
.hero { display: grid; grid-template-columns: 1fr minmax(0, 520px); gap: 72px; align-items: center; padding: 76px 0 92px; }
.brand { position: relative; width: 210px; height: 196px; }
/* 宽高比与游戏的 .brand .big（126×143）相同，略宽于标题图（568×646），图片不贴左右边缘 */
.brand .big { position: absolute; left: -6px; top: -8px; width: 158px; height: 179px; background: var(--ink);
  -webkit-mask: url("/assets/title-yi.png?v=${v}") center / contain no-repeat; mask: url("/assets/title-yi.png?v=${v}") center / contain no-repeat;
  animation: brush 1.5s cubic-bezier(0.65, 0, 0.35, 1) 0.15s both; }
.brand .seal { position: absolute; left: 160px; top: 122px; width: 38px; height: 38px; border-radius: 6px; background: var(--seal); color: var(--seal-ink);
  font: 900 23px/1 var(--serif); display: flex; align-items: center; justify-content: center; animation: stamp 0.7s var(--ease) 1.35s both; }
.kinds { margin: 4px 0 0; font-size: 20px; letter-spacing: 0.06em; color: var(--dim); animation: rise 0.9s var(--ease) 0.5s both; }
.motto { margin: 6px 0 0; font-size: 15px; letter-spacing: 0.12em; color: var(--faint); animation: rise 0.9s var(--ease) 0.6s both; }
.lead { max-width: 30em; margin: 26px 0 0; font-size: 17px; color: var(--dim); animation: rise 0.9s var(--ease) 0.7s both; }
.cta { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-top: 34px; animation: rise 0.9s var(--ease) 0.8s both; }
.chip { font-size: 13px; color: var(--faint); }
.chip a { color: var(--dim); text-underline-offset: 3px; }

/* 按钮 */
.btn { position: relative; overflow: hidden; display: inline-flex; align-items: center; justify-content: center; gap: 8px; height: 46px; padding: 0 26px;
  border-radius: 999px; font: 500 15px/1 var(--sans); text-decoration: none; border: 1px solid var(--card-line); color: var(--ink); background: var(--card);
  transition: transform 0.35s var(--ease), box-shadow 0.35s var(--ease), background 0.35s var(--ease); }
.btn:hover { transform: translateY(-2px); box-shadow: var(--lift); }
.btn:active { transform: translateY(0) scale(0.98); }
.btn.primary { background: var(--btn); color: var(--btn-text); border-color: transparent; }
.btn.primary::before { content: ""; position: absolute; inset: 0; transform: translateX(-120%) skewX(-20deg);
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.22), transparent); transition: transform 0.8s var(--ease); }
.btn.primary:hover::before { transform: translateX(120%) skewX(-20deg); }
.btn svg { width: 16px; height: 16px; transition: transform 0.4s var(--ease); }
.btn:hover svg { transform: translateY(2px); }

/* 棋盘 */
.stage { animation: board-in 1.3s var(--ease) 0.1s both; }
.board { position: relative; aspect-ratio: 1; border-radius: 6px; overflow: hidden;
  background:
    radial-gradient(120% 80% at 18% 8%, rgb(255 244 214 / 0.5), transparent 55%),
    repeating-linear-gradient(91deg, rgb(110 62 18 / 0.07) 0 1px, transparent 1px 6px),
    repeating-linear-gradient(89.3deg, rgb(110 62 18 / 0.05) 0 2px, transparent 2px 17px),
    repeating-linear-gradient(90.6deg, rgb(255 240 210 / 0.08) 0 3px, transparent 3px 23px),
    linear-gradient(172deg, var(--wood-1), var(--wood-2) 55%, var(--wood-3));
  box-shadow: 0 1px 0 rgb(255 255 255 / 0.4) inset, 0 -2px 0 rgb(0 0 0 / 0.06) inset, 0 9px 0 var(--wood-edge), 0 13px 0 var(--wood-side),
    0 46px 80px -30px rgb(60 35 10 / 0.6); margin-bottom: 13px; }
.board::after { content: ""; position: absolute; inset: -40%; pointer-events: none;
  background: linear-gradient(115deg, transparent 42%, rgb(255 248 230 / 0.16) 50%, transparent 58%); animation: sheen 9s ease-in-out 2.5s infinite; }
.grid { position: absolute; inset: 6.25%; }
.grid svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.grid line { stroke: var(--grid); stroke-width: 1; vector-effect: non-scaling-stroke; }
.grid circle { fill: var(--grid); }
.s { position: absolute; width: 6.6%; aspect-ratio: 1; border-radius: 50%; transform: translate(-50%, -50%);
  animation: drop 0.65s cubic-bezier(0.3, 0.7, 0.3, 1) calc(1.1s + var(--i) * 0.42s) both; }
.s.b { background: radial-gradient(circle at 34% 30%, #6a6a6a 0, #2b2b2b 22%, #0e0e0e 58%, #000 100%);
  box-shadow: 1px 3px 4px rgb(0 0 0 / 0.42), inset -2px -3px 5px rgb(255 255 255 / 0.05); }
.s.w { background: radial-gradient(circle at 35% 30%, #fff 0, #f4f0e7 40%, #ded6c7 85%, #c9bfae 100%);
  box-shadow: 1px 3px 4px rgb(60 40 10 / 0.34), inset -2px -3px 6px rgb(120 100 70 / 0.18); }
.s::after { content: ""; position: absolute; inset: 0; border-radius: 50%;
  background: radial-gradient(ellipse 38% 26% at 34% 26%, rgb(255 255 255 / 0.32), transparent 70%); }
.s.last::before { content: ""; position: absolute; left: 50%; top: 50%; width: 22%; height: 22%; border-radius: 50%;
  transform: translate(-50%, -50%); background: #f3eee4; }
.ring { position: absolute; width: 6.6%; aspect-ratio: 1; border-radius: 50%; border: 2px solid rgb(255 250 235 / 0.8); pointer-events: none;
  transform: translate(-50%, -50%) scale(0.6); opacity: 0; animation: ripple 2.8s var(--ease) calc(1.6s + var(--i) * 0.42s) infinite; }
.cells { position: absolute; left: -3.57%; top: -3.57%; width: 107.14%; height: 107.14%; display: grid;
  grid-template-columns: repeat(15, 1fr); grid-template-rows: repeat(15, 1fr); }
.cells i { position: relative; cursor: pointer; }
.cells i.o { pointer-events: none; }
.cells i::after { content: ""; position: absolute; inset: 4%; border-radius: 50%; opacity: 0; transform: scale(0.55);
  background: radial-gradient(circle at 34% 30%, #6a6a6a 0, #1a1a1a 55%, #000 100%);
  transition: opacity 0.25s var(--ease), transform 0.4s cubic-bezier(0.3, 1.5, 0.5, 1); }
.cells i:hover::after { opacity: 0.4; transform: scale(1); }
.cells i:active::after { opacity: 0.85; transform: scale(0.94); }
.caption { margin: 14px 0 0; text-align: center; font-size: 13px; color: var(--faint); }

/* 各节 */
section { padding: 72px 0; }
.head { max-width: 40em; margin-bottom: 34px; }
.label { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; letter-spacing: 0.2em; color: var(--seal); }
.label::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: currentColor; }
h2 { margin: 10px 0 0; font: 900 34px/1.3 var(--serif); letter-spacing: 0.02em; }
h3 { margin: 0; font: 900 20px/1.4 var(--serif); }
.head p { margin: 12px 0 0; color: var(--dim); }
.panel { border-radius: 18px; background: var(--card); border: 1px solid var(--card-line); box-shadow: var(--lift);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }

/* 下载卡片 */
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px; align-items: start; }   /* 展开校验值时不拉高同一行的其他卡片 */
.card { padding: 24px 22px 18px; display: flex; flex-direction: column; gap: 6px;
  transition: transform 0.5s var(--ease), box-shadow 0.5s var(--ease); animation: rise 0.9s var(--ease) calc(0.25s + var(--i) * 0.08s) both; }
.card:hover { transform: translateY(-6px); box-shadow: var(--lift-hover); }
.card .name { display: flex; align-items: center; gap: 12px; }
.pip { display: block; width: 26px; height: 26px; flex: none; border-radius: 50%; transition: transform 0.6s cubic-bezier(0.3, 1.5, 0.5, 1); }
.pip.b { background: radial-gradient(circle at 34% 30%, #6a6a6a 0, #1b1b1b 55%, #000 100%); box-shadow: 0 2px 4px rgb(0 0 0 / 0.35); }
.pip.w { background: radial-gradient(circle at 35% 30%, #fff 0, #eee8dc 55%, #cfc6b5 100%); box-shadow: 0 2px 4px rgb(60 40 10 / 0.3); }
.card:hover .pip { transform: translateY(-3px) rotate(-12deg) scale(1.06); }
.tag { margin-left: auto; padding: 2px 9px; border-radius: 999px; border: 1px solid var(--card-line); font-size: 12px; color: var(--dim); white-space: nowrap; }
.req { font-size: 13px; color: var(--dim); }
.meta { display: flex; justify-content: space-between; margin-top: auto; padding-top: 14px; font-size: 13px; color: var(--faint); }
.file { font: 12px/1.6 var(--mono); color: var(--faint); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card .btn { margin-top: 12px; width: 100%; }
details { margin-top: 10px; font-size: 13px; color: var(--dim); }
summary { cursor: pointer; list-style: none; display: flex; align-items: center; gap: 6px; transition: color 0.3s var(--ease); }
summary::-webkit-details-marker { display: none; }
summary::before { content: ""; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg); transition: transform 0.35s var(--ease); }
details[open] summary::before { transform: rotate(45deg); }
summary:hover { color: var(--ink); }
details code { display: block; margin-top: 8px; padding: 8px 10px; border-radius: 8px; background: var(--code);
  font: 11.5px/1.6 var(--mono); word-break: break-all; }
.empty { padding: 40px; text-align: center; color: var(--dim); }

/* 特色 */
.features { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.feature { padding: 26px 24px; transition: transform 0.5s var(--ease), box-shadow 0.5s var(--ease); }
.feature:hover { transform: translateY(-4px); box-shadow: var(--lift-hover); }
.feature .pip { width: 22px; height: 22px; margin-bottom: 14px; }
.feature:hover .pip { transform: scale(1.12); }
.feature p { margin: 8px 0 0; font-size: 15px; color: var(--dim); }

/* 系统要求、安装、校验 */
table { width: 100%; border-collapse: collapse; font-size: 15px; }
th, td { padding: 14px 20px; text-align: left; border-bottom: 1px solid var(--card-line); vertical-align: top; }
th { font-weight: 500; color: var(--dim); white-space: nowrap; }
tr:last-child td, tr:last-child th { border-bottom: 0; }
.guides { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.guide { padding: 26px 24px; }
.guide ol { margin: 12px 0 0; padding-left: 1.3em; color: var(--dim); font-size: 15px; }
.guide li + li { margin-top: 6px; }
code.inline { padding: 1px 6px; border-radius: 5px; background: var(--code); font: 13px var(--mono); word-break: break-all; }
.cmds { display: grid; gap: 10px; margin-top: 18px; }
.cmd { display: grid; grid-template-columns: 96px 1fr; align-items: center; gap: 14px; padding: 12px 18px; }
.cmd span { font-size: 13px; color: var(--dim); }
.cmd code { font: 13px/1.6 var(--mono); word-break: break-all; }
.notes { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.notes .panel { padding: 26px 24px; }
.notes p { margin: 10px 0 0; font-size: 15px; color: var(--dim); }

footer { padding: 40px 0 56px; border-top: 1px solid var(--card-line); font-size: 13px; color: var(--faint); }
footer p { margin: 4px 0; }

/* 动画 */
@keyframes brush { from { clip-path: inset(0 0 100% 0); opacity: 0.2; } to { clip-path: inset(0 0 0 0); opacity: 1; } }
@keyframes stamp {
  0% { opacity: 0; transform: scale(1.9) rotate(-10deg); } 55% { opacity: 1; transform: scale(0.9) rotate(3deg); } 100% { opacity: 1; transform: none; }
}
@keyframes rise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
@keyframes board-in { from { opacity: 0; transform: perspective(1400px) rotateX(14deg) translateY(30px) scale(0.97); } to { opacity: 1; transform: none; } }
@keyframes drop {
  0% { opacity: 0; transform: translate(-50%, -50%) translateY(-22px) scale(1.28); filter: blur(1.5px); }
  60% { opacity: 1; transform: translate(-50%, -50%) scale(0.96); filter: none; }
  100% { opacity: 1; transform: translate(-50%, -50%); }
}
@keyframes ripple { 0% { opacity: 0.75; transform: translate(-50%, -50%) scale(0.7); } 70%, 100% { opacity: 0; transform: translate(-50%, -50%) scale(2.4); } }
@keyframes sheen { 0%, 100% { transform: translateX(-30%); } 50% { transform: translateX(30%); } }
@supports (animation-timeline: view()) {
  .reveal { animation: rise linear both; animation-timeline: view(); animation-range: entry 0% cover 28%; }
}
@media (prefers-reduced-motion: reduce) {
  html { scroll-behavior: auto; }
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .ring { display: none; }
}

/* 窄屏 */
@media (max-width: 920px) {
  .hero { grid-template-columns: 1fr; gap: 48px; padding-top: 48px; }
  .stage { max-width: 520px; width: 100%; margin: 0 auto; }
  .features, .guides { grid-template-columns: 1fr 1fr; }
  .notes { grid-template-columns: 1fr; }
}
@media (max-width: 600px) {
  .wrap { padding: 0 16px; }
  .top nav { display: none; }
  .features, .guides { grid-template-columns: 1fr; }
  .brand { transform: scale(0.82); transform-origin: left top; height: 162px; }
  h2 { font-size: 28px; }
  th, td { padding: 12px 14px; }
  .cmd { grid-template-columns: 1fr; gap: 4px; }
}
`;

/**
 * 主页的样式（数据文件）：首屏的透视棋盘、贝色区块以圆形自上而下铺开（如一枚棋子落下）、对局方式的横向滚动、
 * 光影切换与跟随鼠标的高光（以单选框与 :has() 实现）、语言对照与终章。随滚动推进的效果只在支持 animation-timeline 的浏览器中启用。
 */
import { boardStyle } from './board';
import { geometryStyle } from './geometry';
import { ringStyle } from './ring';
import { minify } from './pageStyle';

/** 主页专有的样式 */
export const homeStyle = () => minify(boardStyle + geometryStyle + ringStyle + hero + games + modes + tongues + finale + scroll + narrow);

const hero = `
.hero { position: relative; min-height: 100svh; overflow: clip; display: grid; align-items: end; background: var(--ink); }
/* 光晕与棋盘只占首屏，并在首屏底部渐隐为墨色：首屏下方为贝色区块展开留出的墨色空间，两者之间不留接缝 */
.hero::before { content: ""; position: absolute; inset: 0 0 auto; height: 100svh; pointer-events: none;
  background: radial-gradient(90% 70% at 72% 78%, #2a2118 0, #14110d 45%, transparent 75%);
  -webkit-mask: linear-gradient(#000 60%, transparent); mask: linear-gradient(#000 60%, transparent); }
.hero-floor { position: absolute; inset: 0 0 auto; height: 100svh; perspective: 2600px; perspective-origin: 80% 10%;
  -webkit-mask: linear-gradient(90deg, transparent 62%, #000 74%), linear-gradient(#000 70%, transparent 98%); -webkit-mask-composite: source-in;
  mask: linear-gradient(90deg, transparent 62%, #000 74%), linear-gradient(#000 70%, transparent 98%); mask-composite: intersect; }
/* 整块棋盘斜放在右侧：盘面在透视中完整可见，带厚度（前、左两侧的木边）与台面上的投影；棋子在盘面的四角与中腹 */
.hero-floor .board { position: absolute; left: 92%; top: 58%; width: min(820px, 54vw); --pad: 4.5cqi; transform-style: preserve-3d;
  transform: translate(-50%, -50%) rotateX(55deg) rotateZ(-22deg); animation: floor-in 2.4s var(--ease) both;
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.5), inset 0 0 10cqi rgb(90 50 10 / 0.28), 0 0 0 1px rgb(120 80 30 / 0.5); }
.hero-floor .board .grid::before { content: ""; position: absolute; inset: -6%; pointer-events: none;
  background: radial-gradient(55% 45% at 30% 45%, rgb(255 236 196 / 0.32), transparent 70%); }
.hero-floor .board::before, .hero-floor .board::after { content: ""; position: absolute; background: linear-gradient(#a8783c, #7a521f); }
.hero-floor .board::before { left: 0; right: 0; top: 100%; height: 4.2cqi; transform-origin: 50% 0; transform: rotateX(-90deg);
  background: repeating-linear-gradient(90deg, rgb(90 55 20 / 0.25) 0 2px, transparent 2px 9px), linear-gradient(#b4844a, #7d5420); }
.hero-floor .board::after { top: 0; bottom: 0; right: 100%; width: 4.2cqi; transform-origin: 100% 50%; transform: rotateY(90deg);
  background: linear-gradient(90deg, #6f4a1c, #9a6c34); }
.hero-floor .grid { transform-style: preserve-3d; }
.hero-floor .grid line { stroke: rgb(36 20 4 / 0.85); stroke-width: 1.2; }
.hero-shadow { position: absolute; left: 92%; top: 62%; width: min(900px, 60vw); aspect-ratio: 1.6; translate: -50% -50%; rotate: -14deg;
  border-radius: 50%; background: radial-gradient(closest-side, rgb(0 0 0 / 0.75), transparent); filter: blur(30px); }
/* 棋子略高于盘面：与盘面同在一个平面时，立体渲染会把部分棋子遮在盘面之下 */
.hero-floor .st { translate: 0 0 2px; animation: drop 0.7s cubic-bezier(0.3, 0.7, 0.3, 1) calc(1.4s + var(--i) * 0.38s) both; }
.hero::after { content: ""; position: absolute; inset: 0 0 auto; height: 100svh; pointer-events: none;
  background: linear-gradient(90deg, rgb(11 10 9 / 0.9) 0, rgb(11 10 9 / 0.6) 44%, transparent 60%),
    linear-gradient(0deg, rgb(11 10 9 / 0.7), transparent 30%); }
.hero-in { position: relative; z-index: 2; width: 100%; max-width: var(--max); margin: 0 auto; padding: 132px var(--gut) clamp(96px, 16vh, 160px);
  display: grid; grid-template-columns: auto minmax(0, 25em); justify-content: start; gap: clamp(32px, 4.5vw, 80px); align-items: end; pointer-events: none; }
.hero-in a { pointer-events: auto; }
.hero-title { position: relative; height: clamp(240px, 52vh, 560px); aspect-ratio: 568 / 646; }
.hero-title .mark { position: absolute; inset: 0; background: var(--fg);
  -webkit-mask: var(--title) center / contain no-repeat; mask: var(--title) center / contain no-repeat;
  animation: brush 1.8s var(--ease-io) 0.2s both; }
.hero-title .seal { position: absolute; right: -6%; bottom: 4%; width: 15%; aspect-ratio: 1; font-size: clamp(18px, 3.6vh, 36px);
  box-shadow: 0 8px 22px -8px rgb(178 58 44 / 0.6); animation: stamp 0.8s var(--ease) 1.7s both; }
.hero-copy { padding-bottom: 6px; }
.motto { font: 400 clamp(40px, 5vw, 76px)/1.2 var(--serif); letter-spacing: 0.08em; animation: rise 1.1s var(--ease) 0.85s both; }
.hero .cta { margin-top: 56px; animation: rise 1.1s var(--ease) 1.15s both; }
.cue { position: absolute; z-index: 2; left: 50%; bottom: 26px; transform: translateX(-50%); display: grid; justify-items: center; gap: 10px;
  font-size: 12px; letter-spacing: 0.4em; text-decoration: none; color: var(--faint); animation: fade 2s var(--ease) 2.4s both; }
.cue i { position: relative; width: 1px; height: 46px; background: var(--line); overflow: hidden; }
.cue i::after { content: ""; position: absolute; left: 0; top: -40%; width: 1px; height: 40%; background: var(--fg);
  animation: cue 2.2s var(--ease-io) infinite; }
@keyframes floor-in { from { opacity: 0; transform: translate(-50%, -38%) rotateX(66deg) rotateZ(-40deg); } to { opacity: 1; } }
@keyframes brush { from { clip-path: inset(0 0 100% 0); opacity: 0.3; } to { clip-path: inset(0); opacity: 1; } }
@keyframes stamp {
  0% { opacity: 0; transform: scale(2) rotate(-12deg); } 55% { opacity: 1; transform: scale(0.9) rotate(3deg); } 100% { opacity: 1; transform: none; }
}
@keyframes cue { to { top: 100%; } }
`;

const games = `
.games, .tongues { padding: clamp(110px, 16vh, 200px) var(--gut) clamp(96px, 14vh, 180px); }
.games > *, .tongues > * { max-width: var(--max); margin-left: auto; margin-right: auto; }
.split { display: flex; margin-top: clamp(56px, 9vh, 110px); border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.game { position: relative; flex: 1 1 0; min-width: 0; padding: 44px clamp(20px, 3vw, 48px) 52px; display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-areas: "num art" "text art"; gap: 28px clamp(20px, 3vw, 44px);
  transition: background 0.6s var(--ease); outline: none; }
.game + .game { border-left: 1px solid var(--line); }
/* 悬停只改底色与棋盘的姿态，不改栏宽：改栏宽会使正文重新换行、在悬停时跳动 */
.game:hover { background: var(--shell-2); }
.game-num { grid-area: num; display: flex; align-items: baseline; gap: 8px; }
.game-num b { font: 900 clamp(84px, 10vw, 168px)/0.85 var(--serif); letter-spacing: -0.02em; color: transparent; -webkit-text-stroke: 1.5px var(--fg);
  transition: color 0.6s var(--ease); }
.game:hover .game-num b { color: var(--fg); }
.game-num span { font: 400 20px/1 var(--serif); color: var(--dim); }
.game-art { grid-area: art; align-self: center; position: relative; }
.mini { --pad: 7cqi; box-shadow: 0 1px 0 rgb(255 255 255 / 0.5) inset, 0 7px 0 #b0803f, 0 10px 0 #8a5f2b, 0 50px 70px -30px rgb(60 35 10 / 0.55);
  transition: transform 0.9s var(--ease); }
.game:hover .mini { transform: perspective(900px) rotateX(10deg) rotateZ(-3deg) translateY(-6px); }
.game-text { grid-area: text; align-self: end; }
.game-text h3 small { margin-left: 12px; font: 400 14px/1 var(--sans); letter-spacing: 0.2em; color: var(--faint); }
.game-text p { margin-top: 14px; color: var(--dim); }
.facts { margin-top: 22px; display: flex; flex-wrap: wrap; gap: 8px; }
.facts span { padding: 3px 12px; border: 1px solid var(--line); border-radius: 999px; font-size: 13px; color: var(--dim); }
`;

const modes = `
.modes { position: relative; }
.modes-pin { padding: clamp(110px, 16vh, 180px) var(--gut) clamp(80px, 12vh, 140px); }
.modes .sec-head { max-width: var(--max); margin: 0 auto; }
.track { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; max-width: var(--max); margin: clamp(48px, 8vh, 90px) auto 0;
  border-top: 1px solid var(--line); }
.mode { position: relative; padding: 40px clamp(20px, 3vw, 44px) 48px 0; border-bottom: 1px solid var(--line); }
.mode:nth-child(even) { padding-left: clamp(20px, 3vw, 44px); border-left: 1px solid var(--line); }
.mode-no { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%; font: 900 26px/1 var(--serif);
  background: radial-gradient(circle at 35% 30%, #fff 0, #f2ede3 40%, #d4cab8 90%); color: var(--ink);
  box-shadow: 0 10px 20px -8px rgb(0 0 0 / 0.8), inset -3px -4px 8px rgb(120 100 70 / 0.25); transition: transform 0.6s cubic-bezier(0.3, 1.5, 0.5, 1); }
.mode:hover .mode-no { transform: translateY(-4px) rotate(-8deg); }
.mode h3 { margin-top: 26px; }
.mode p { margin-top: 14px; max-width: 30em; color: var(--dim); }
.keys { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; margin-top: 28px; font-size: 13px; color: var(--dim); }
.keys span { margin-right: 10px; }
kbd { display: inline-grid; place-items: center; min-width: 38px; height: 38px; padding: 0 10px; border-radius: 9px; font: 500 14px/1 var(--mono);
  color: var(--fg);
  background: linear-gradient(#24211d, #191714); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1), 0 3px 0 #050504, 0 6px 12px -4px rgb(0 0 0 / 0.6);
  transition: transform 0.15s var(--ease), box-shadow 0.15s var(--ease); }
kbd:hover { transform: translateY(2px); box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1), 0 1px 0 #050504, 0 3px 6px -3px rgb(0 0 0 / 0.6); }
.levels { display: flex; gap: 28px; margin-top: 28px; font-size: 13px; color: var(--dim); }
.levels span { display: flex; align-items: center; gap: 4px; }
.levels i { width: 12px; height: 12px; border-radius: 50%; background: radial-gradient(circle at 35% 30%, #fff, #d8d0c1 80%); }
.levels span i:last-of-type { margin-right: 6px; }
.ways { display: grid; grid-template-columns: repeat(3, auto); gap: 18px 28px; margin: 28px 0 0; }
.ways dt { font: 900 18px/1.4 var(--serif); }
.ways dd { margin: 4px 0 0; font-size: 13px; color: var(--dim); }
.ranks { display: flex; flex-wrap: wrap; gap: 6px 4px; margin-top: 30px; }
.ranks span { position: relative; padding: 6px 10px 10px; font: 400 15px/1 var(--serif); color: var(--faint); transition: color 0.3s var(--ease); }
.ranks span:nth-child(n + 11) { color: var(--dim); }
.ranks span:hover { color: var(--fg); }
.ranks .start { color: var(--fg); }
.ranks .start::after { content: ""; position: absolute; left: 50%; bottom: -4px; width: 6px; height: 6px; margin-left: -3px; border-radius: 50%;
  background: var(--seal); }
.progress { display: none; }
`;

const tongues = `
.phrases { margin: clamp(48px, 8vh, 96px) auto 0; border-top: 1px solid var(--line); }
.phrases > div { position: relative; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: baseline; gap: 20px;
  padding: clamp(14px, 2vh, 22px) 0 clamp(14px, 2vh, 22px) 44px; border-bottom: 1px solid var(--line); transition: background 0.4s var(--ease); }
.phrases > div > span { font: 900 clamp(26px, 3.4vw, 50px)/1.15 var(--serif); }
.phrases > div > span[lang] { font-weight: 400; letter-spacing: 0.01em; }
.phrases > div > span:nth-child(2) { color: var(--dim); }
.phrases > div::before { content: ""; position: absolute; left: 6px; top: 50%; width: 20px; height: 20px; margin-top: -10px; border-radius: 50%;
  background: radial-gradient(circle at 34% 30%, #6a6a6a 0, #1a1a1a 55%, #000 100%); box-shadow: 0 3px 5px rgb(0 0 0 / 0.3);
  transform: translateY(-14px) scale(1.3); opacity: 0; transition: transform 0.5s cubic-bezier(0.3, 1.5, 0.5, 1), opacity 0.3s var(--ease); }
.phrases > div:not(.phrases-head):hover { background: var(--shell-2); }
.phrases > div:not(.phrases-head):hover::before { transform: none; opacity: 1; }
.phrases .phrases-head { padding-top: 14px; padding-bottom: 14px; }
.phrases .phrases-head > span { font: 400 12px/1 var(--sans); letter-spacing: 0.4em; color: var(--faint); }
.figures { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0 clamp(20px, 3vw, 44px); margin-top: clamp(80px, 12vh, 140px); }
.fig { padding-top: 22px; border-top: 1px solid var(--fg); }
.fig b { display: flex; align-items: baseline; gap: 6px; font: 900 clamp(56px, 6.4vw, 104px)/1 var(--serif); letter-spacing: -0.02em; }
.fig small { font: 400 18px/1 var(--serif); color: var(--dim); }
.fig p { margin-top: 18px; font-size: 15px; color: var(--dim); }
`;

const finale = `
.finale { position: relative; padding: clamp(140px, 22vh, 240px) var(--gut) clamp(110px, 16vh, 180px); text-align: center; overflow: clip;
  background: radial-gradient(70% 60% at 50% 46%, #241c14 0, var(--ink) 70%); }
.finale-in { max-width: 760px; margin: 0 auto; display: grid; justify-items: center; }
.finale-title { margin-top: 18px; font: 900 clamp(120px, 21vw, 320px)/1 var(--serif); letter-spacing: 0.06em; padding-left: 0.06em;
  background: repeating-linear-gradient(93deg, rgb(110 62 18 / 0.25) 0 2px, transparent 2px 9px), linear-gradient(175deg, #f1d7a4, #d3a660 45%, #9c6c2f);
  -webkit-background-clip: text; background-clip: text; color: transparent; }
.finale-lead { margin-top: 22px; max-width: 30em; color: var(--dim); }
.finale .cta { justify-content: center; margin-top: 44px; }
.finale .hint { justify-content: center; width: 100%; }
.os-row { display: flex; margin-top: 64px; font-size: 13px; letter-spacing: 0.32em; color: var(--faint); }
.os-row span + span::before { content: "·"; margin: 0 18px; }
`;

/** 随滚动推进的效果：只在支持 animation-timeline、且未要求减弱动态效果时启用 */
const scroll = `
@supports (animation-timeline: view()) {
@media (prefers-reduced-motion: no-preference) {
  .hero:has(+ .reveal-circle) { min-height: calc(100svh + 70vh); grid-template-rows: 100svh; align-content: start; }
  .hero:has(+ .reveal-circle) .cue { bottom: calc(26px + 70vh); }
  .tongues:has(+ .reveal-circle) { padding-bottom: calc(clamp(96px, 14vh, 180px) + 70vh); }
  .reveal-circle { margin-top: -70vh; animation: circle-in linear both; animation-timeline: view(); animation-range: entry 0% entry 100%; }
  .games { padding-top: calc(clamp(110px, 16vh, 200px) + 50vh); }
  .finale { padding-top: calc(clamp(140px, 22vh, 240px) + 30vh); }
  .five .st, .go .st { animation: drop linear both; animation-timeline: view();
    animation-range: cover calc(18% + var(--i) * 3%) cover calc(22% + var(--i) * 3%); }
  .five .win { stroke-dashoffset: 1; animation: draw linear forwards; animation-timeline: view(); animation-range: cover 46% cover 54%; }
  .five .ban { animation: fade linear both; animation-timeline: view(); animation-range: cover 50% cover 54%; }
  .go b.st:nth-of-type(5) { animation: captured linear both; animation-timeline: view(); animation-range: cover 27% cover 52%; }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @keyframes captured {
    0% { opacity: 0; transform: translate(-50%, -50%) translateY(-30%) scale(1.35); } 12%, 70% { opacity: 1; transform: translate(-50%, -50%); }
    100% { opacity: 0; transform: translate(-50%, -50%) scale(0.6); }
  }
  .fig { animation: rise linear both; animation-timeline: view(); animation-range: entry 10% entry 80%; }
}
@media (prefers-reduced-motion: no-preference) and (min-width: 960px) {
  .modes { height: 380vh; view-timeline-name: --modes; }
  .modes-pin { position: sticky; top: 0; height: 100vh; overflow: hidden; display: flex; flex-direction: column; justify-content: center;
    padding: 96px 0 72px; }
  .modes .sec-head { margin: 0 var(--edge); }
  .track { display: flex; width: max-content; max-width: none; margin: clamp(40px, 7vh, 80px) 0 0 var(--edge); border-top: 0;
    animation: slide linear both; animation-timeline: --modes; animation-range: contain 5% contain 95%; }
  .mode, .mode:nth-child(even) { width: min(520px, 40vw); flex: none; padding: 36px 48px 40px; border: 0; border-left: 1px solid var(--line); }
  .mode.wide { width: min(820px, 62vw); }
  .progress { display: block; position: relative; height: 1px; margin: 48px var(--edge) 0; background: var(--line); }
  .progress i { position: absolute; inset: 0; background: var(--fg); transform-origin: 0 50%;
    animation: grow linear both; animation-timeline: --modes; animation-range: contain 5% contain 95%; }
  @keyframes slide { to { transform: translateX(calc(-100% + 100vw - 2 * var(--edge))); } }
  @keyframes grow { from { transform: scaleX(0); } }
}
}
`;

const narrow = `
@media (min-width: 961px) and (max-width: 1240px) {
  .hero-floor .board { left: 80%; top: 62%; }
  .hero::after { background: linear-gradient(90deg, rgb(11 10 9 / 0.92) 0, rgb(11 10 9 / 0.8) 66%, transparent 84%),
    linear-gradient(0deg, rgb(11 10 9 / 0.7), transparent 30%); }
}
@media (max-width: 960px) {
  .hero-in { grid-template-columns: 1fr; gap: 28px; }
  .hero-in { padding-top: 96px; padding-bottom: 92px; }
  .hero-title { height: clamp(180px, 31vh, 320px); }
  .motto { font-size: clamp(32px, 9vw, 52px); }
  .hero .cta { margin-top: 36px; }
  .hero-floor .board { left: 62%; top: 70%; width: 120vw; }
  .hero::after { background: linear-gradient(0deg, rgb(11 10 9 / 0.9) 10%, rgb(11 10 9 / 0.3) 60%, transparent); }
  .split { flex-direction: column; }
  .game + .game { border-left: 0; border-top: 1px solid var(--line); }
  .figures { grid-template-columns: 1fr 1fr; row-gap: 36px; }
}
@media (max-width: 640px) {
  .cue { display: none; }
  .game { grid-template-columns: 1fr; grid-template-areas: "num" "art" "text"; padding-left: 0; padding-right: 0; }
  .game-art { max-width: 320px; }
  .game:hover { background: none; }
  .track { grid-template-columns: 1fr; }
  .mode, .mode:nth-child(even) { padding: 32px 0 40px; border-left: 0; }
  .ways { grid-template-columns: 1fr 1fr; }
  .figures { grid-template-columns: 1fr; }
  .phrases > div { padding-left: 0; gap: 10px; }
  .phrases > div::before { display: none; }
  .phrases > div > span { font-size: clamp(20px, 6vw, 28px); }
  .phrases > div > span[lang] { font-size: clamp(17px, 4.6vw, 24px); }
}
`;

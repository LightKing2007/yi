/**
 * 支持作者页的样式：两行标题的定时明暗、真实成本、低边形爱心海洋与可降级的 CSS 动效。
 * 爱心海洋的位置、大小与节奏以 nth-child 规则集中在这里，页面模板不写内联样式；
 * 动效只使用 transform / opacity，reduced-motion 下保留静态层次并停用浮动（11-website-frontend 6.1）。
 */
import { minify } from './pageStyle';

/** 支持作者页专有的样式。 */
export const donateStyle = () => minify(hero + purpose + support + faq + finale + scroll + narrow);

const hero = `
.donate-hero { position: relative; min-height: 100svh; overflow: clip; background:
  radial-gradient(70% 90% at 88% 38%, rgb(130 75 72 / 0.1), transparent 68%), var(--ink); }
.donate-hero::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.5;
  background: linear-gradient(rgb(236 231 221 / 0.04) 1px, transparent 1px) center / 72px 72px,
    linear-gradient(90deg, rgb(236 231 221 / 0.04) 1px, transparent 1px) center / 72px 72px;
  -webkit-mask: linear-gradient(90deg, transparent 8%, #000 70%); mask: linear-gradient(90deg, transparent 8%, #000 70%); }
.donate-hero::after { content: ""; position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(90deg, rgb(11 10 9 / 0.25), transparent 60%), linear-gradient(0deg, var(--ink), transparent 24%); }
/* 棋盘边线：右侧十九道刻线，呼应十九路棋盘；只是装饰，屏幕上不承载信息 */
.donate-board-edge { position: absolute; z-index: 1; top: 50%; right: calc(var(--gut) + 4px); width: 10px; height: min(58vh, 520px);
  transform: translateY(-50%); pointer-events: none; opacity: 0.55;
  background: repeating-linear-gradient(to bottom, rgb(236 231 221 / 0.22) 0 1px, transparent 1px 26px); }
.donate-board-edge::before { content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 1px; background: rgb(236 231 221 / 0.16); }
.donate-hero-in { position: relative; z-index: 1; display: flex; align-items: center; max-width: var(--max); min-height: 100svh;
  margin: 0 auto; padding: 116px var(--gut) 96px; }
.donate-copy { position: relative; z-index: 2; width: 100%; }
.donate-kicker { display: flex; align-items: center; gap: 16px; margin-bottom: 30px; animation: rise 0.9s var(--ease) 0.1s both; }
.donate-kicker-rule { width: 44px; height: 1px; flex: none; background: var(--kaya); opacity: 0.8; }
.donate-copy h1 { font: 900 clamp(58px, 7.9vw, 118px)/1.08 var(--serif); letter-spacing: -0.045em; animation: rise 1.1s var(--ease) 0.25s both; }
.donate-title-line { display: block; width: max-content; max-width: 100%; white-space: nowrap; }
.donate-lead { max-width: 39em; margin-top: 36px; color: var(--dim); font-size: var(--type-lead); animation: rise 1.1s var(--ease) 0.45s both; }
.donate-copy .cta { margin-top: 38px; animation: rise 1.1s var(--ease) 0.65s both; }
.donate-copy .cta .btn { width: 196px; justify-content: center; padding-right: 22px; }
.donate-copy .facts { margin-top: 26px; animation: rise 1.1s var(--ease) 0.8s both; }
@media (prefers-reduced-motion: no-preference) {
  .donate-title-line:first-child { animation: donate-title-first 8s ease-in-out infinite; }
  .donate-title-line:nth-child(2) { animation: donate-title-second 8s ease-in-out infinite; }
}
@keyframes donate-title-first { 0%, 38%, 100% { opacity: 1; } 50%, 88% { opacity: 0.28; } }
@keyframes donate-title-second { 0%, 38%, 100% { opacity: 0.28; } 50%, 88% { opacity: 1; } }
`;

const purpose = `
.donate-purpose, .donate-support, .donate-faq { position: relative; padding: clamp(110px, 16vh, 190px) var(--gut); }
.donate-purpose > *, .donate-support > *, .donate-faq > * { max-width: var(--max); margin-left: auto; margin-right: auto; }
.cost-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: clamp(56px, 8vh, 90px);
  border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
.cost-card { position: relative; min-width: 0; padding: 34px clamp(22px, 3vw, 42px) 42px; transition: background 0.5s var(--ease); }
.cost-card + .cost-card { border-left: 1px solid var(--line); }
.cost-card:hover { background: var(--shell-2); }
.cost-no { display: block; color: var(--faint); font: 900 clamp(38px, 4vw, 58px)/1 var(--serif); letter-spacing: -0.02em;
  transition: color 0.4s var(--ease); }
.cost-card:hover .cost-no { color: var(--fg); }
.cost-card h3 { margin-top: 34px; }
.cost-card p { margin-top: 18px; color: var(--dim); }
.donate-quote { position: relative; max-width: 17em; margin-top: clamp(76px, 12vh, 140px); margin-bottom: 0; text-align: center;
  white-space: pre-line; font: 900 clamp(34px, 4.7vw, 66px)/1.4 var(--serif); }
.donate-quote::before { content: ""; display: block; width: 1px; height: 54px; margin: 0 auto 34px; background: var(--kaya); }
`;

const support = `
.donate-support { overflow: clip; }
/* 同心圆如棋盘的星位，随滚动缓慢转动与放大 */
.donate-support::before { content: ""; position: absolute; right: -24vmin; top: 10%; width: 80vmin; aspect-ratio: 1; border-radius: 50%;
  pointer-events: none;
  background: repeating-radial-gradient(circle, transparent 0 calc(7vmin - 1px), rgb(214 169 100 / 0.08) calc(7vmin - 1px) 7vmin);
  -webkit-mask: radial-gradient(circle, transparent 12%, #000 40%, transparent 72%);
  mask: radial-gradient(circle, transparent 12%, #000 40%, transparent 72%); }
.donate-support > * { position: relative; }
.principles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: clamp(52px, 8vh, 84px);
  border-top: 1px solid var(--line); }
.principle { padding: 30px clamp(20px, 3vw, 40px) 36px 0; border-bottom: 1px solid var(--line); }
.principle + .principle { padding-left: clamp(20px, 3vw, 40px); border-left: 1px solid var(--line); }
.principle > span { color: var(--kaya); font: 400 12px/1 var(--mono); }
.principle h3 { margin-top: 24px; }
.principle p { margin-top: 14px; color: var(--dim); }
.donate-panel { position: relative; overflow: hidden; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center;
  gap: 40px; margin-top: clamp(64px, 10vh, 110px); padding: clamp(30px, 4vw, 54px);
  border: 1px solid rgb(214 169 100 / 0.26); border-radius: var(--radius-card);
  background: radial-gradient(70% 130% at 100% 0, rgb(214 169 100 / 0.14), transparent 68%), var(--ink-2); }
.donate-panel::after { content: ""; position: absolute; right: -70px; top: -110px; width: 280px; aspect-ratio: 1; border-radius: 50%;
  border: 1px solid rgb(214 169 100 / 0.14); pointer-events: none; }
.donate-panel-copy { position: relative; z-index: 1; }
.donate-panel h3 { max-width: 19em; margin-top: 18px; font-size: clamp(26px, 3vw, 42px); }
.donate-panel p { max-width: 42em; margin-top: 16px; color: var(--dim); }
.donate-panel-action { position: relative; z-index: 1; display: grid; justify-items: center; gap: 18px; }
.donate-panel-action .btn, .donate-panel-action .donate-pending { width: 226px; justify-content: center; }
.donate-pending { display: inline-flex; align-items: center; justify-content: center; min-height: 58px; padding: 0 26px;
  border: 1px solid var(--line); border-radius: var(--radius-pill); color: var(--fg);
  font-size: var(--type-small); letter-spacing: var(--tracking-btn); white-space: nowrap; }
`;

const faq = `
.donate-questions { max-width: 1000px; margin-top: clamp(48px, 8vh, 84px); }
.donate-question { border-top: 1px solid var(--line); }
.donate-question:last-child { border-bottom: 1px solid var(--line); }
.donate-question summary { display: grid; grid-template-columns: 48px minmax(0, 1fr) 24px; align-items: center; gap: 18px;
  padding: 28px 0; cursor: pointer; list-style: none; }
.donate-question summary::-webkit-details-marker { display: none; }
.donate-question summary > span { color: var(--faint); font: 400 12px/1 var(--mono); }
.donate-question summary i { position: relative; width: 18px; height: 18px; transition: transform 0.4s var(--ease); }
.donate-question summary i::before, .donate-question summary i::after { content: ""; position: absolute; left: 0; top: 8px;
  width: 18px; height: 1px; background: var(--fg); }
.donate-question summary i::after { transform: rotate(90deg); }
.donate-question[open] summary i { transform: rotate(45deg); }
.donate-question summary:hover h3 { color: var(--kaya-2); }
.donate-question summary h3 { transition: color 0.3s var(--ease); }
.donate-question > p { max-width: 48em; margin: -4px 0 0 66px; padding-bottom: 30px; color: var(--dim); }
`;

const finale = `
.donate-finale { position: relative; min-height: 92svh; overflow: clip; display: flex; align-items: center;
  padding: clamp(130px, 20vh, 220px) var(--gut);
  background: radial-gradient(70% 80% at 82% 40%, rgb(236 231 221 / 0.035), transparent 72%), var(--ink); }
.donate-finale-in { position: relative; z-index: 1; width: min(100%, var(--max)); margin: 0 auto; }
.donate-finale h2 { max-width: 9em; margin-top: 26px; font: 900 clamp(64px, 9vw, 136px)/1.08 var(--serif); letter-spacing: -0.04em; }
.donate-finale h2 span { color: var(--kaya); }
.donate-finale p { max-width: 38em; margin-top: 30px; color: var(--dim); font-size: var(--type-lead); }
.donate-finale .cta { margin-top: 44px; }
.donate-finale .cta .btn, .donate-finale .donate-pending { width: 220px; min-height: 58px; justify-content: center; padding: 0 24px; }
/* 页脚：深复古红底色与爱心海洋；只有本页使用这个变体 */
.foot-heart { overflow: hidden; border-top-color: rgb(225 197 193 / 0.12); color: #a08b88;
  background: radial-gradient(90% 120% at 50% 0, rgb(129 80 87 / 0.26), transparent 62%),
    linear-gradient(#241518, #170e10 60%, #140b0d); }
.foot-heart .foot-in { position: relative; z-index: 2; }
.foot-heart .foot-brand { color: #eee5df; }
.foot-heart .foot-motto { color: #b39b96; }
.foot-heart .foot-legal { border-top-color: rgb(225 197 193 / 0.1); }
.foot-heart .foot-links a:hover, .foot-heart .icp:hover { color: #eee5df; }
.heart-ocean { position: absolute; inset: 0; z-index: 0; overflow: hidden; pointer-events: none; }
.heart-ocean::after { content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(120% 90% at 50% 118%, transparent 34%, rgb(18 8 10 / 0.55)); }
/* 低边形爱心：只由 CSS 渐变与裁切构成，两片切面叠出轻微的立体感；所有爱心正立 */
.heart-ocean i { position: absolute; left: var(--x); bottom: var(--y); display: block; width: var(--size); aspect-ratio: 0.94;
  opacity: var(--opacity); background: var(--heart);
  background: linear-gradient(125deg, color-mix(in srgb, var(--heart) 82%, #d7b1aa), var(--heart) 48%,
    color-mix(in srgb, var(--heart) 82%, #241416));
  clip-path: polygon(50% 96%, 7% 55%, 2% 32%, 9% 13%, 27% 4%, 45% 11%, 50% 24%, 55% 11%, 73% 4%, 91% 13%, 98% 32%, 93% 55%); }
.heart-ocean i::before, .heart-ocean i::after { content: ""; position: absolute; inset: 0; }
.heart-ocean i::before { background: rgb(255 232 224 / 0.09);
  clip-path: polygon(50% 24%, 50% 96%, 7% 55%, 2% 32%, 9% 13%, 27% 4%, 45% 11%); }
.heart-ocean i::after { background: rgb(20 8 12 / 0.14);
  clip-path: polygon(50% 24%, 55% 11%, 73% 4%, 91% 13%, 98% 32%, 93% 55%, 50% 96%); }
/* 22 枚爱心：固定垂直轨道、景深、周期与相位各不相同，不旋转、不横向漂移 */
.heart-ocean i:nth-child(1) { --x: 2%; --size: 34px; --y: 14%; --duration: 19s; --delay: -11s; --opacity: 0.3; --heart: #815057; }
.heart-ocean i:nth-child(2) { --x: 7%; --size: 52px; --y: 42%; --duration: 27s; --delay: -22s; --opacity: 0.2; --heart: #9b6569; }
.heart-ocean i:nth-child(3) { --x: 12%; --size: 24px; --y: 62%; --duration: 16s; --delay: -5s; --opacity: 0.42; --heart: #a87376; }
.heart-ocean i:nth-child(4) { --x: 17%; --size: 38px; --y: 8%; --duration: 23s; --delay: -17s; --opacity: 0.26; --heart: #73464d; }
.heart-ocean i:nth-child(5) { --x: 22%; --size: 28px; --y: 74%; --duration: 18s; --delay: -13s; --opacity: 0.36; --heart: #966067; }
.heart-ocean i:nth-child(6) { --x: 27%; --size: 46px; --y: 34%; --duration: 29s; --delay: -9s; --opacity: 0.18; --heart: #a36d71; }
.heart-ocean i:nth-child(7) { --x: 32%; --size: 22px; --y: 52%; --duration: 15s; --delay: -12s; --opacity: 0.46; --heart: #ae777a; }
.heart-ocean i:nth-child(8) { --x: 37%; --size: 60px; --y: 18%; --duration: 25s; --delay: -21s; --opacity: 0.16; --heart: #7e4c53; }
.heart-ocean i:nth-child(9) { --x: 42%; --size: 26px; --y: 66%; --duration: 17s; --delay: -3s; --opacity: 0.4; --heart: #986168; }
.heart-ocean i:nth-child(10) { --x: 47%; --size: 40px; --y: 6%; --duration: 24s; --delay: -19s; --opacity: 0.22; --heart: #a46d72; }
.heart-ocean i:nth-child(11) { --x: 52%; --size: 32px; --y: 46%; --duration: 16s; --delay: -14s; --opacity: 0.38; --heart: #ad7679; }
.heart-ocean i:nth-child(12) { --x: 57%; --size: 54px; --y: 28%; --duration: 22s; --delay: -7s; --opacity: 0.2; --heart: #835159; }
.heart-ocean i:nth-child(13) { --x: 62%; --size: 20px; --y: 78%; --duration: 15s; --delay: -6s; --opacity: 0.48; --heart: #b27d80; }
.heart-ocean i:nth-child(14) { --x: 67%; --size: 44px; --y: 54%; --duration: 26s; --delay: -24s; --opacity: 0.22; --heart: #9c656b; }
.heart-ocean i:nth-child(15) { --x: 72%; --size: 28px; --y: 12%; --duration: 18s; --delay: -8s; --opacity: 0.34; --heart: #8c585f; }
.heart-ocean i:nth-child(16) { --x: 77%; --size: 50px; --y: 38%; --duration: 30s; --delay: -20s; --opacity: 0.18; --heart: #a36d71; }
.heart-ocean i:nth-child(17) { --x: 82%; --size: 24px; --y: 70%; --duration: 16s; --delay: -4s; --opacity: 0.42; --heart: #ae777a; }
.heart-ocean i:nth-child(18) { --x: 87%; --size: 36px; --y: 24%; --duration: 21s; --delay: -15s; --opacity: 0.28; --heart: #815057; }
.heart-ocean i:nth-child(19) { --x: 92%; --size: 58px; --y: 4%; --duration: 28s; --delay: -23s; --opacity: 0.16; --heart: #9b6569; }
.heart-ocean i:nth-child(20) { --x: 96%; --size: 22px; --y: 60%; --duration: 15s; --delay: -10s; --opacity: 0.44; --heart: #b27d80; }
.heart-ocean i:nth-child(21) { --x: 14%; --size: 18px; --y: 86%; --duration: 17s; --delay: -16s; --opacity: 0.36; --heart: #986168; }
.heart-ocean i:nth-child(22) { --x: 79%; --size: 20px; --y: 84%; --duration: 19s; --delay: -2s; --opacity: 0.4; --heart: #ad7679; }
@media (prefers-reduced-motion: no-preference) {
  .heart-ocean i { animation: heart-float var(--duration) linear var(--delay) infinite; }
}
@keyframes heart-float {
  0% { opacity: 0; transform: translate3d(0, 12vh, 0); }
  12%, 82% { opacity: var(--opacity); }
  100% { opacity: 0; transform: translate3d(0, -30vh, 0); }
}
`;

const scroll = `
@supports (animation-timeline: view()) {
@media (prefers-reduced-motion: no-preference) {
  .donate-hero:has(+ .reveal-circle) { min-height: calc(100svh + var(--overlap)); }
  .donate-hero:has(+ .reveal-circle) .donate-hero-in { min-height: 100svh; }
  .donate-purpose { padding-top: calc(clamp(110px, 16vh, 190px) + 24vh); }
  .donate-support:has(+ .reveal-circle), .donate-faq:has(+ .reveal-circle) { padding-bottom: calc(clamp(110px, 16vh, 190px) + var(--overlap)); }
  .donate-faq { padding-top: calc(clamp(110px, 16vh, 190px) + 24vh); }
  .donate-finale { padding-top: calc(clamp(130px, 20vh, 220px) + 24vh); }
  .donate-copy { animation: donate-copy-away linear both; animation-timeline: scroll(); animation-range: 0 100vh; }
  .donate-quote { animation: donate-quote-in linear both; animation-timeline: view(); animation-range: entry 5% entry 80%; }
  .donate-support::before { animation: donate-rings-turn linear both; animation-timeline: view(); animation-range: cover; }
  @keyframes donate-copy-away { to { translate: 0 -16vh; opacity: 0.08; } }
  @keyframes donate-quote-in { from { opacity: 0.15; translate: 0 46px; } to { opacity: 1; translate: 0 0; } }
  @keyframes donate-rings-turn { to { rotate: 80deg; scale: 1.12; } }
}
}
`;

const narrow = `
@media (max-width: 1040px) {
  .donate-board-edge { display: none; }
  .donate-panel { grid-template-columns: 1fr; }
  .donate-panel-action { justify-items: start; }
}
@media (max-width: 800px) {
  .donate-hero-in { padding-top: 124px; padding-bottom: 90px; }
  .donate-copy h1 { font-size: clamp(48px, 9.6vw, 76px); }
  .cost-grid, .principles { grid-template-columns: 1fr; }
  .cost-card { padding: 30px 0 34px; }
  .cost-card + .cost-card { border-left: 0; border-top: 1px solid var(--line); }
  .cost-card h3 { margin-top: 24px; }
  .principle, .principle + .principle { padding: 28px 0; border-left: 0; }
  .principle h3 { margin-top: 18px; }
  .donate-support::before { opacity: 0.55; }
}
@media (max-width: 540px) {
  .donate-hero-in { padding-top: 104px; }
  .donate-kicker { margin-bottom: 24px; }
  .donate-kicker .label { font-size: 11px; letter-spacing: 0.2em; }
  .donate-copy h1 { font-size: 10.35vw; letter-spacing: -0.055em; }
  .donate-lead { margin-top: 28px; }
  .donate-copy .cta { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 30px; }
  .donate-copy .cta .btn { width: 100%; gap: 8px; padding: 0 10px; font-size: 14px; }
  .donate-copy .cta .ico { width: 34px; height: 34px; padding: 9px; }
  .donate-copy .facts { gap: 8px; }
  .donate-purpose, .donate-support, .donate-faq { padding-left: var(--gut); padding-right: var(--gut); }
  .donate-quote { text-align: left; font-size: clamp(32px, 9vw, 48px); }
  .donate-quote::before { margin-left: 0; }
  .donate-panel { padding: 28px 22px; gap: 28px; }
  .donate-panel-action, .donate-panel-action .btn, .donate-panel-action .donate-pending { width: 100%; }
  .donate-question summary { grid-template-columns: 30px minmax(0, 1fr) 20px; gap: 10px; padding: 24px 0; }
  .donate-question summary h3 { font-size: 20px; line-height: 1.45; }
  .donate-question > p { margin-left: 40px; }
  .donate-finale { min-height: 84svh; }
  .donate-finale h2 { font-size: clamp(50px, 14vw, 70px); }
  .donate-finale .cta { display: grid; grid-template-columns: 1fr; width: 100%; gap: 14px; }
  .donate-finale .cta .btn, .donate-finale .donate-pending { width: 100%; }
}
`;

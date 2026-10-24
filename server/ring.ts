/**
 * 主页的功能环：十二张功能卡片绕成一个立体的圆环，页面滚动时圆环随之转动（区块固定在屏幕上，滚动的距离换成转动的角度）。
 * 卡片上方是一小块 3×3 的棋形，下方是编号、名称与一句说明。未要求减弱动态效果、且浏览器支持 animation-timeline 时才转动；
 * 不支持时圆环缓慢自转，悬停即停；要求减弱动态效果时，卡片平铺为网格。
 */

import { stream } from './geometry';

/** 卡片：3×3 棋形（b 黑子、w 白子、. 空点，自左上逐行）、名称与说明 */
const CARDS: [string, string, string][] = [
  ['b.b.b.b.b', '五子棋', '15 路棋盘，连成五子即获胜'],
  ['bwb.x.bwb', '黑方禁手', '三三、四四、长连，可在“设置”中开关'],
  ['.w.wbw.w.', '围棋', '9 路、13 路、19 路棋盘'],
  ['wb.b.bwb.', '提子与打劫', '完整支持提子、禁着点与打劫'],
  ['bbwbw.ww.', '数子法点目', '点目时自动估算死子，贴 7.5 目'],
  ['b..bb.bbb', '人机对弈', '简单、普通、困难三档，可执黑或执白'],
  ['b.......w', '匹配', '与等待时间最长的玩家配对'],
  ['..b.bbbbb', '排位', '按 Elo 等级分计算段位，自十级至九段'],
  ['bw.wb....', '好友房间', '以四位房号邀请好友开局'],
  ['b.w.b.w.b', '断线重连', '60 秒内恢复连接即可继续对局'],
  ['wwbwbbbbb', '五种光影', '无、黄昏、晨曦、月夜、竹影'],
  ['b.w.b.w..', '三种语言', '文言、中文、English'],
];

/** 圆环上卡片的数目，决定每张卡片相隔的角度 */
export const CARD_COUNT = CARDS.length;
const TWO_DIGITS = 2;

const cell = (ch: string) => (ch === 'b' ? '<i class="b"></i>' : ch === 'w' ? '<i class="w"></i>' : ch === 'x' ? '<i class="x"></i>' : '<i></i>');

/** 功能环：区块、固定在屏幕上的舞台与十二张卡片 */
export function featureRing() {
  const total = String(CARD_COUNT).padStart(TWO_DIGITS, '0');
  const cards = CARDS.map(([shape, title, note], i) => {
    const no = String(i + 1).padStart(TWO_DIGITS, '0');
    return (
      `<article class="card" style="--k:${i}"><div class="card-shape" aria-hidden="true">${[...shape].map(cell).join('')}</div>` +
      `<span class="card-no">No.${no} / ${total}</span><h3>${title}</h3><span class="card-note">${note}</span></article>`
    );
  }).join('');
  return `<section class="ringsec ink" id="features">${stream()}<div class="ring-pin">
<div class="sec-head"><span class="idx">叁</span><span class="label">功能一览</span><h2>十二项功能，环绕一周</h2></div>
<div class="ring-stage"><div class="ring">${cards}</div></div></div></section>`;
}

/** 功能环的样式 */
export const ringStyle = `
.ringsec { position: relative; overflow: clip; --card-w: clamp(160px, min(13vw, 21vh), 210px); --gap: 1.12;
  --r: calc(var(--card-w) * var(--gap) * ${CARD_COUNT} / 6.2832); }
.ring-pin { padding: clamp(110px, 16vh, 180px) var(--gut) clamp(80px, 12vh, 140px); }
.ringsec .sec-head { max-width: var(--max); margin: 0 auto; }
.ringsec h2 { font-size: clamp(30px, 3.8vw, 56px); }
.ring-stage { position: relative; height: calc(var(--card-w) * 1.8); margin-top: clamp(32px, 6vh, 72px); perspective: 1800px; perspective-origin: 50% 30%; }
.ring { position: absolute; left: 50%; top: 50%; width: 0; height: 0; transform-style: preserve-3d; transform: rotateX(-12deg) rotateY(0deg);
  animation: ring-spin 80s linear infinite; }
.ring:hover { animation-play-state: paused; }
.card { position: absolute; left: calc(var(--card-w) / -2); top: calc(var(--card-w) * -0.8); width: var(--card-w); padding: 18px 18px 20px;
  border-radius: 16px; background: linear-gradient(180deg, #1d1a16, #121010);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.07), 0 0 0 1px rgb(236 231 221 / 0.1);
  transform: rotateY(calc(var(--k) * 360deg / ${CARD_COUNT})) translateZ(var(--r)); backface-visibility: hidden; -webkit-backface-visibility: hidden;
  transition: box-shadow 0.4s var(--ease); }
.card:hover { box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.1), 0 0 0 1px var(--kaya), 0 20px 50px -20px rgb(214 169 100 / 0.35); }
.card-shape { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; aspect-ratio: 1; margin-bottom: 16px; border-radius: 10px;
  background: linear-gradient(rgb(40 24 8 / 0.6), rgb(40 24 8 / 0.6)) 50% 50% / 66.7% 1px no-repeat,
    linear-gradient(90deg, rgb(40 24 8 / 0.6), rgb(40 24 8 / 0.6)) 50% 50% / 1px 66.7% no-repeat,
    linear-gradient(rgb(40 24 8 / 0.6), rgb(40 24 8 / 0.6)) 50% 16.7% / 66.7% 1px no-repeat,
    linear-gradient(rgb(40 24 8 / 0.6), rgb(40 24 8 / 0.6)) 50% 83.3% / 66.7% 1px no-repeat,
    linear-gradient(90deg, rgb(40 24 8 / 0.6), rgb(40 24 8 / 0.6)) 16.7% 50% / 1px 66.7% no-repeat,
    linear-gradient(90deg, rgb(40 24 8 / 0.6), rgb(40 24 8 / 0.6)) 83.3% 50% / 1px 66.7% no-repeat,
    linear-gradient(170deg, #e6c88f, #d2a865 60%, #b98a47); }
.card-shape i { position: relative; display: grid; place-items: center; }
.card-shape i.b::after, .card-shape i.w::after { content: ""; width: 78%; aspect-ratio: 1; border-radius: 50%; }
.card-shape i.b::after { background: radial-gradient(circle at 34% 30%, #6a6a6a 0, #1d1d1d 50%, #000 100%); box-shadow: 1px 3px 4px rgb(0 0 0 / 0.45); }
.card-shape i.w::after { background: radial-gradient(circle at 35% 30%, #fff 0, #eee8dc 55%, #cbc1af 100%); box-shadow: 1px 3px 4px rgb(60 40 10 / 0.4); }
.card-shape i.x::after { content: "×"; color: var(--seal); font: 700 22px/1 var(--sans); }
.card-no { display: block; font: 11px/1 var(--mono); letter-spacing: 0.12em; color: var(--faint); }
.card h3 { margin-top: 10px; font-size: 20px; }
.card-note { display: block; margin-top: 6px; font-size: 13px; line-height: 1.6; color: var(--dim); }
@keyframes ring-spin { to { transform: rotateX(-12deg) rotateY(-360deg); } }

/* 随滚动转动：区块固定在屏幕上，滚过区块的距离换成圆环转过的角度 */
@supports (animation-timeline: view()) {
@media (prefers-reduced-motion: no-preference) {
  .ringsec { height: 320vh; view-timeline-name: --ring; }
  .ring-pin { position: sticky; top: 0; height: 100vh; display: flex; flex-direction: column; justify-content: center;
    padding-top: 80px; padding-bottom: 40px; }
  .ring { animation: ring-turn linear both; animation-timeline: --ring; animation-range: contain 0% contain 100%; }
  .ring:hover { animation-play-state: running; }
  @keyframes ring-turn { from { transform: rotateX(-12deg) rotateY(40deg); } to { transform: rotateX(-12deg) rotateY(-340deg); } }
}
}

/* 减弱动态效果时平铺为网格 */
@media (prefers-reduced-motion: reduce) {
  .ring-stage { height: auto; perspective: none; }
  .ring { position: static; width: auto; height: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 16px;
    transform: none; }
  .card { position: static; width: auto; transform: none; }
}
@media (max-width: 640px) {
  .ringsec { --card-w: 128px; }
  .ring-stage { perspective: 1700px; }
  .card { padding: 12px 12px 14px; }
  .card h3 { font-size: 17px; }
  .card-note { font-size: 12px; }
}
`;

/**
 * 下载页面的样式（数据文件）：首屏的致谢与推荐卡片、按操作系统切换的安装步骤（以单选框实现）、全部版本的列表、校验与须知。
 */
import { minify } from './pageStyle';

/** 安装说明中可切换的操作系统（与 downloadPage.ts 的 GUIDES 一致） */
const GUIDE_OS = ['Windows', 'macOS', 'Linux'];

/** 选中的操作系统：标签的选中样式、键盘焦点与对应的步骤 */
const tabRules = () =>
  GUIDE_OS.map(
    os =>
      `#os-${os}:checked ~ .tabs label[for="os-${os}"] { background: var(--fg); color: var(--bg); border-color: var(--fg); }\n` +
      `#os-${os}:focus-visible ~ .tabs label[for="os-${os}"] { outline: 2px solid var(--kaya); outline-offset: 3px; }\n` +
      `#os-${os}:checked ~ .steps[data-os="${os}"] { display: grid; }`,
  ).join('\n');

/** 下载页面专有的样式 */
export const downloadStyle = () => minify(hero + guide + rows + more + tabRules());

const hero = `
.dl-hero { position: relative; overflow: clip; background: radial-gradient(80% 70% at 78% 40%, #2a2118 0, #13100d 50%, var(--ink) 80%); }
.dl-hero::before { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.5;
  background-image: linear-gradient(var(--line) 1px, transparent 1px), linear-gradient(90deg, var(--line) 1px, transparent 1px);
  background-size: 64px 64px; background-position: center;
  -webkit-mask: radial-gradient(60% 70% at 70% 45%, #000, transparent); mask: radial-gradient(60% 70% at 70% 45%, #000, transparent); }
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
.ticket { position: relative; padding: 0 36px 32px; border-radius: 22px; background: linear-gradient(180deg, #1c1915, #12100e);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.07), 0 0 0 1px rgb(236 231 221 / 0.08), 0 60px 120px -50px rgb(0 0 0 / 0.9);
  animation: ticket-in 1.3s var(--ease) 0.3s both; }
.corner { position: relative; width: calc(100% + 72px); margin: 0 -36px 30px; aspect-ratio: 2.6; border-radius: 22px 22px 0 0; overflow: hidden; }
.corner::before { content: ""; position: absolute; inset: 0;
  background: linear-gradient(90deg, rgb(40 24 8 / 0.7) 1px, transparent 1px) calc(50% - 0.5px) 0 / 48px 100%,
    linear-gradient(rgb(40 24 8 / 0.7) 1px, transparent 1px) 0 calc(50% - 0.5px) / 100% 48px; }
.corner::after { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, transparent 40%, rgb(18 16 14 / 0.9)); }
.corner .st { left: 50%; top: 50%; width: 44px; font-size: 44px; animation: drop 0.8s cubic-bezier(0.3, 0.7, 0.3, 1) 0.9s both; }
.corner .st::before { animation: fade 0.5s var(--ease) 1.6s both; }
.corner .ring { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%;
  border: 1.5px solid rgb(255 248 230 / 0.9); opacity: 0; animation: ripple 3s var(--ease) 1.5s infinite; }
@keyframes ripple { 0% { opacity: 0.8; transform: scale(0.8); } 70%, 100% { opacity: 0; transform: scale(3); } }
.ticket-os { display: flex; align-items: baseline; gap: 14px; }
.ticket-os h2 { font: 900 clamp(40px, 4vw, 56px)/1 var(--serif); }
.ticket-os span { font-size: 14px; letter-spacing: 0.08em; color: var(--accent); }
.ticket-meta { display: grid; grid-template-columns: auto auto 1fr; gap: 0 28px; margin: 24px 0 28px; padding: 16px 0; border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line); }
.ticket-meta dt { font-size: 12px; letter-spacing: 0.3em; color: var(--faint); }
.ticket-meta dd { margin: 4px 0 0; font-size: 15px; }
.ticket .btn { width: 100%; }
.ticket .btn span { flex: 1; text-align: center; padding-right: 38px; }
.alt { margin-top: 16px; font-size: 14px; color: var(--dim); }
.alt a { color: var(--fg); text-underline-offset: 4px; }
.ticket-file { margin-top: 22px; display: grid; gap: 6px; font: 12px/1.6 var(--mono); color: var(--faint); }
.ticket-file span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
code.sum { display: block; padding: 8px 10px; border-radius: 8px; background: rgb(236 231 221 / 0.05); font: 11.5px/1.6 var(--mono); color: var(--dim);
  word-break: break-all; user-select: all; }
.ticket.empty { padding-bottom: 36px; }
@keyframes ticket-in { from { opacity: 0; transform: perspective(1200px) rotateY(-14deg) rotateX(6deg) translateY(40px); } to { opacity: 1; transform: none; } }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgb(214 169 100 / 0.6); } 100% { box-shadow: 0 0 0 14px rgb(214 169 100 / 0); } }
`;

const guide = `
.guide, .all, .more { padding: clamp(100px, 15vh, 180px) var(--gut); }
.guide > *, .all > *, .more > * { max-width: var(--max); margin-left: auto; margin-right: auto; }
.os-pick { position: relative; }
.os-pick > input { position: absolute; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.tabs { display: flex; gap: 8px; margin-top: clamp(40px, 7vh, 72px); }
.tabs label { padding: 9px 22px; border: 1px solid var(--line); border-radius: 999px; font-size: 14px; letter-spacing: 0.08em; color: var(--dim);
  cursor: pointer;
  transition: background 0.35s var(--ease), color 0.35s var(--ease), border-color 0.35s var(--ease); }
.tabs label:hover { border-color: var(--fg); color: var(--fg); }
.steps { list-style: none; display: none; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: clamp(20px, 3vw, 48px); margin-top: 40px; padding: 0;
  counter-reset: step; }
.steps li { position: relative; padding-top: 34px; border-top: 1px solid var(--fg); color: var(--dim); counter-increment: step;
  animation: rise 0.7s var(--ease) both; }
.steps li::before { content: counter(step, cjk-decimal); display: grid; place-items: center; width: 56px; height: 56px; margin-bottom: 20px;
  border-radius: 50%; font: 900 22px/1 var(--serif); color: #f3efe7;
  background: radial-gradient(circle at 34% 30%, #6a6a6a 0, #262626 24%, #0d0d0d 60%, #000 100%); box-shadow: 0 10px 18px -8px rgb(0 0 0 / 0.55); }
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
.row details { grid-column: 1 / -1; font-size: 13px; color: var(--faint); }
.row summary { cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 8px; transition: color 0.3s var(--ease); }
.row summary::-webkit-details-marker { display: none; }
.row summary::before { content: ""; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: rotate(-45deg); transition: transform 0.35s var(--ease); }
.row details[open] summary::before { transform: rotate(45deg); }
.row summary:hover { color: var(--fg); }
.row .file { display: block; margin-top: 10px; font: 12px/1.6 var(--mono); }
.row code.sum { margin-top: 6px; max-width: 46em; }
.none { margin-top: 48px; color: var(--dim); }
@media (max-width: 860px) {
  .dl-hero-in { grid-template-columns: 1fr; padding-top: 120px; min-height: 0; }
  .steps { grid-template-columns: 1fr; }
  .row { grid-template-columns: 1fr auto; }
  .row-req, .row-meta { grid-column: 1; }
  .row .btn { grid-column: 2; grid-row: 1 / span 3; }
}
@media (max-width: 520px) {
  .ticket { padding: 0 22px 24px; }
  .ticket .corner { width: calc(100% + 44px); margin: 0 -22px 24px; }
  .ticket-meta { grid-template-columns: 1fr 1fr; row-gap: 12px; }
  .ticket-meta div:last-child { grid-column: 1 / -1; }
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

/** 帮助目录与问题页样式：复用文书阅读布局，只保留检索、分组与棋谱雨装饰。 */
import { agreementStyle } from './agreementStyle';
import { minify } from './pageStyle';

const STYLE = `
.support-hero { background: radial-gradient(54% 96% at 82% 48%, rgb(214 169 100 / 0.065), transparent 74%); }
.support-ornaments { position: absolute; z-index: 1; inset: 0; overflow: hidden; pointer-events: none; }
.support-grid { position: absolute; inset: 0 0 0 34%;
  background: linear-gradient(rgb(236 231 221 / 0.08) 1px, transparent 1px) 0 0 / 56px 56px,
    linear-gradient(90deg, rgb(236 231 221 / 0.08) 1px, transparent 1px) 0 0 / 56px 56px;
  -webkit-mask: radial-gradient(ellipse 78% 96% at 80% 46%, #000 8%, transparent 74%);
  mask: radial-gradient(ellipse 78% 96% at 80% 46%, #000 8%, transparent 74%); }
.support-rain { position: absolute; inset: 0 -2% 0 38%; overflow: hidden;
  -webkit-mask: linear-gradient(90deg, transparent, #000 48%); mask: linear-gradient(90deg, transparent, #000 48%); }
.support-stream { position: absolute; top: -360px; display: flex; flex-direction: column; align-items: center; gap: 13px;
  color: var(--kaya); font: 400 16px/1.2 var(--serif); opacity: 0; text-shadow: 0 0 14px rgb(214 169 100 / 0.18);
  animation: support-rain 16s linear infinite; }
.support-stream i { font-style: normal; opacity: 0.045; }
.support-stream i:nth-last-child(5) { opacity: 0.09; }
.support-stream i:nth-last-child(4) { opacity: 0.16; }
.support-stream i:nth-last-child(3) { opacity: 0.26; }
.support-stream i:nth-last-child(2) { opacity: 0.44; }
.support-stream i:last-child { opacity: 0.88; }
.support-stream:nth-child(1) { left: 1%; animation-duration: 15s; animation-delay: -8s; }
.support-stream:nth-child(2) { left: 10%; animation-duration: 18s; animation-delay: -2s; }
.support-stream:nth-child(3) { left: 19%; animation-duration: 13s; animation-delay: -11s; }
.support-stream:nth-child(4) { left: 28%; animation-duration: 20s; animation-delay: -6s; }
.support-stream:nth-child(5) { left: 37%; animation-duration: 16s; animation-delay: -14s; }
.support-stream:nth-child(6) { left: 46%; animation-duration: 19s; animation-delay: -4s; }
.support-stream:nth-child(7) { left: 55%; animation-duration: 14s; animation-delay: -10s; }
.support-stream:nth-child(8) { left: 64%; animation-duration: 17s; animation-delay: -7s; }
.support-stream:nth-child(9) { left: 73%; animation-duration: 21s; animation-delay: -16s; }
.support-stream:nth-child(10) { left: 82%; animation-duration: 15s; animation-delay: -3s; }
.support-stream:nth-child(11) { left: 91%; animation-duration: 18s; animation-delay: -12s; }
.support-stream:nth-child(12) { left: 97%; animation-duration: 14s; animation-delay: -5s; }
@keyframes support-rain { 0% { transform: translateY(0); opacity: 0; } 10% { opacity: 0.72; }
  86% { opacity: 0.72; } 100% { transform: translateY(1040px); opacity: 0; } }
.support-search { max-width: 840px; margin-bottom: 36px; }
.support-search label { display: block; margin-bottom: 12px; }
.support-search-row { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 14px; align-items: center;
  min-height: 66px; padding: 8px 22px; border: 1px solid rgb(20 18 16 / 0.13); border-radius: 20px;
  background: rgb(255 255 255 / 0.4); box-shadow: 0 8px 24px rgb(40 32 22 / 0.045), inset 0 1px 0 rgb(255 255 255 / 0.5);
  transition: border-color 0.3s var(--ease), box-shadow 0.3s var(--ease), background 0.3s var(--ease); }
.support-search-row:focus-within { border-color: rgb(181 132 67 / 0.65); background: rgb(255 255 255 / 0.54);
  box-shadow: 0 0 0 3px rgb(181 132 67 / 0.09), 0 10px 28px rgb(40 32 22 / 0.055); }
.support-search-icon { display: grid; place-items: center; width: 22px; height: 22px; color: var(--faint); }
.support-search-icon svg { width: 22px; height: 22px; }
.support-search input { width: 100%; min-width: 0; height: 48px; padding: 0; border: 0; border-radius: 0;
  color: var(--fg); background: transparent; font: 16px/1.5 var(--sans); color-scheme: light; }
.support-search input::placeholder { color: var(--faint); }
.support-search input:focus { outline: none; }
.support-catalog { max-width: var(--max); margin: 0 auto; }
.support-catalog .document-link[hidden] { display: none; }
@media (min-width: 721px) {
  .support-catalog .document-description { width: calc(100% - 32px); transition: width 0.55s var(--ease); }
  .support-catalog .document-link:hover .document-description { width: 100%; }
}
.support-group { margin-top: 64px; }
.support-group:first-child { margin-top: 0; }
.support-group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; padding-bottom: 16px;
  border-bottom: 1px solid var(--fg); scroll-margin-top: 96px; }
.support-group-head h2 { font: 900 clamp(24px, 2.8vw, 34px)/1.5 var(--serif); }
.support-group-head span { color: var(--faint); font-size: 13px; }
.document-description h3 { font: 900 clamp(21px, 2.4vw, 30px)/1.5 var(--serif); text-wrap: balance; }
.support-empty { max-width: var(--max); margin: 0 auto; padding: 56px 0; border-top: 1px solid var(--line); }
.support-empty h2 { font: 900 clamp(26px, 3vw, 38px)/1.5 var(--serif); }
.support-empty p { margin: 16px 0 28px; color: var(--dim); }
@media (max-width: 720px) {
  .support-grid { left: 18%; background-size: 44px 44px; }
  .support-rain { left: 24%; opacity: 0.65; }
  .support-stream { font-size: 14px; }
  .support-search-row { grid-template-columns: 20px minmax(0, 1fr); gap: 10px; min-height: 58px; padding: 6px 16px; border-radius: 16px; }
  .support-search-icon, .support-search-icon svg { width: 20px; height: 20px; }
  .support-search input { height: 44px; }
  .support-group { margin-top: 48px; }
  .support-group-head { scroll-margin-top: 136px; }
}
@media (prefers-reduced-motion: reduce) {
  .support-stream { animation: none; opacity: 0.16; transform: translateY(340px); }
}
@media print {
  .support-search, .support-ornaments { display: none; }
}
`;

export const supportStyle = () => minify(agreementStyle() + STYLE);

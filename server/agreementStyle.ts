/** 文书目录与文件页：官网同源的墨黑、贝白、渐入与字形纵向视差，无脚本交互。 */
import { minify } from './pageStyle';

/** 页面载入渐入；字形保持正向，仅随滚动上下移动，减弱动态效果时静止。 */
export const agreementStyle = () => minify(STYLE);

const STYLE = `
.bar nav { gap: 24px; font-size: 13px; letter-spacing: 0.06em; }
.bar nav a { line-height: 1.5; }
.agreement-hero { position: relative; isolation: isolate; overflow: hidden; padding: 152px var(--gut) 84px;
  background: radial-gradient(62% 100% at 78% 42%, rgb(214 169 100 / 0.16), rgb(156 108 47 / 0.06) 42%, transparent 74%),
    radial-gradient(42% 72% at 12% 82%, rgb(156 108 47 / 0.05), transparent 76%); }
.agreement-hero-in { position: relative; z-index: 2; max-width: var(--max); margin: 0 auto; }
.agreement-kicker { margin-bottom: 28px; animation: rise 0.9s var(--ease) 0.08s both; }
.agreement-hero h1 { max-width: 15em; font: 900 clamp(42px, 6.7vw, 88px)/1.3 var(--serif); letter-spacing: 0.035em; text-wrap: balance;
  animation: rise 1.2s var(--ease) 0.18s both; }
.agreement-file h1 { max-width: 12em; }
.agreement-lead { max-width: 38em; color: var(--dim); margin-top: 26px; font-size: 17px; animation: rise 1.2s var(--ease) 0.34s both; }
.agreement-ornaments { position: absolute; z-index: 1; inset: 0; pointer-events: none; user-select: none; overflow: hidden;
  animation: fade 2.4s var(--ease) both; }
.agreement-ornaments span { position: absolute; font: 400 56px/1 var(--serif); color: var(--kaya); }
.agreement-ornaments .depth-far { z-index: 1; opacity: 0.032; filter: blur(0.8px); }
.agreement-ornaments .depth-middle { z-index: 2; opacity: 0.065; }
.agreement-ornaments .depth-near { z-index: 3; opacity: 0.105; text-shadow: 0 2px 12px var(--ink), 0 0 4px var(--ink); }
.agreement-ornaments span:nth-child(1) { right: 10%; top: 20%; font-size: clamp(72px, 8vw, 112px); --travel: 90px; }
.agreement-ornaments span:nth-child(2) { right: 29%; top: 61%; font-size: clamp(48px, 5.4vw, 76px); --travel: -62px; }
.agreement-ornaments span:nth-child(3) { right: 24%; top: 8%; font-size: clamp(56px, 6.2vw, 88px); --travel: -24px; }
.agreement-ornaments span:nth-child(4) { right: 2%; top: 68%; font-size: clamp(44px, 4.6vw, 66px); --travel: 110px; }
.agreement-ornaments span:nth-child(5) { right: 45%; top: 76%; font-size: 48px; --travel: -56px; }
.agreement-ornaments span:nth-child(6) { right: 52%; top: 23%; font-size: 56px; --travel: 28px; }
.agreement-ornaments span:nth-child(7) { right: 9%; top: 53%; font-size: 38px; --travel: -56px; }
.agreement-ornaments span:nth-child(8) { right: 37%; top: 29%; font-size: 56px; --travel: 84px; }
.agreement-ornaments span:nth-child(9) { right: 67%; top: 73%; font-size: 36px; --travel: -20px; }
.agreement-ornaments span:nth-child(10) { right: 16%; top: 82%; font-size: 50px; --travel: 52px; }
.agreement-ornaments span:nth-child(11) { right: 57%; top: 64%; font-size: 28px; --travel: 88px; }
.agreement-ornaments span:nth-child(12) { right: 77%; top: 16%; font-size: 44px; --travel: -16px; }
.agreement-ornaments span:nth-child(13) { right: 30%; top: 18%; font-size: 34px; --travel: 38px; }
.agreement-ornaments span:nth-child(14) { right: 22%; top: 44%; font-size: 44px; --travel: -48px; }
.agreement-ornaments span:nth-child(15) { right: 4%; top: 38%; font-size: 32px; --travel: 64px; }
.agreement-ornaments span:nth-child(16) { right: 18%; top: 78%; font-size: 40px; --travel: -34px; }
@keyframes document-depth { from { transform: translateY(0); } to { transform: translateY(var(--travel)); } }
@supports (animation-timeline: view()) {
  @media (prefers-reduced-motion: no-preference) {
    .agreement-hero { view-timeline: --document-hero block; }
    .agreement-ornaments span { animation: document-depth linear both; animation-timeline: --document-hero; animation-range: exit 0% exit 100%; }
  }
}
.agreement-catalog, .agreement-content { padding: 64px var(--gut) 100px; scroll-margin-top: 64px; }
.agreement-catalog-in { max-width: var(--max); margin: 0 auto; animation: rise 1.2s var(--ease) 0.5s both; }
.catalog-caption { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between; padding-bottom: 24px;
  color: var(--faint); font-size: 13px; border-bottom: 1px solid var(--line); }
.document-link { display: grid; grid-template-columns: 64px minmax(0, 1fr) 52px; gap: 24px; align-items: center; padding: 36px 0;
  border-bottom: 1px solid var(--line);
  text-decoration: none; transition: padding 0.55s var(--ease), background 0.55s var(--ease); }
.document-link:hover { padding-left: 16px; padding-right: 16px; background: rgb(214 169 100 / 0.055); }
.document-number { align-self: start; margin-top: 8px; }
.document-description h2 { font: 900 clamp(24px, 2.8vw, 36px)/1.5 var(--serif); text-wrap: balance; }
.document-description p { margin-top: 6px; color: var(--dim); font-size: 15px; }
.document-status { display: inline-block; margin-top: 12px; color: var(--faint); font-size: 12px; letter-spacing: 0.12em; }
.document-arrow { display: grid; place-items: center; width: 48px; height: 48px; border: 1px solid var(--line); border-radius: 50%;
  transition: background 0.4s var(--ease), color 0.4s var(--ease), transform 0.55s var(--ease); }
.document-arrow svg { width: 24px; height: 24px; }
.document-link:hover .document-arrow { transform: rotate(-35deg); background: var(--fg); color: var(--bg); }
.document-intro, .document-layout { max-width: var(--max); margin: 0 auto; }
.document-meta { display: flex; flex-wrap: wrap; gap: 8px 24px; color: var(--faint); font-size: 13px; }
.document-meta span:first-child { color: #8a5422; }
.document-notice { margin: 24px 0 48px; padding: 18px 22px; max-width: 68em; border-left: 2px solid var(--kaya);
  color: var(--dim); background: rgb(214 169 100 / 0.07); font-size: 14px; line-height: 1.9; }
.document-layout { display: grid; grid-template-columns: 200px minmax(0, 1fr); gap: clamp(36px, 5vw, 72px); }
.document-toc { position: sticky; top: 96px; max-height: calc(100vh - 124px); overflow-y: auto; align-self: start; padding-bottom: 12px; }
.document-toc .label { display: block; margin-bottom: 20px; }
.document-toc nav { display: grid; gap: 12px; }
.document-toc a { color: var(--dim); font-size: 14px; text-decoration: none; text-underline-offset: 4px; }
.document-toc a:hover { color: var(--fg); text-decoration: underline; }
.document-article { min-width: 0; max-width: 54em; color: var(--dim); font-size: 16px; line-height: 2; overflow-wrap: anywhere; }
.document-article h2 { margin-top: 48px; margin-bottom: 18px; font: 900 28px/1.6 var(--serif); color: var(--fg); scroll-margin-top: 96px; }
.document-article h3 { margin-top: 32px; margin-bottom: 12px; font: 900 21px/1.7 var(--serif); color: var(--fg); scroll-margin-top: 96px; }
.document-article p, .document-article ul, .document-article ol { margin: 16px 0; }
.document-article ul, .document-article ol { padding-left: 1.5em; }
.document-article li { margin: 8px 0; }
.document-article strong { color: var(--fg); font-weight: 600; }
.document-article a { text-underline-offset: 4px; text-decoration-thickness: 1px; }
.document-end { margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--line); }
.document-back { color: var(--dim); font-size: 14px; text-underline-offset: 5px; }
.document-link.rv:focus { animation: none; opacity: 1; transform: none; }
@media (max-width: 960px) {
  .document-layout { grid-template-columns: 1fr; gap: 32px; }
  .document-toc { position: static; max-height: none; border-bottom: 1px solid var(--line); padding-bottom: 28px; }
  .document-toc nav { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 24px; }
}
@media (max-width: 720px) {
  .bar { height: 108px; display: grid; grid-template-rows: 36px minmax(0, 1fr); padding-top: 10px; padding-bottom: 8px; gap: 4px 20px; }
  .bar nav { display: flex; grid-row: 2; gap: 24px; margin-left: 0; font-size: 12px; letter-spacing: 0.08em;
    overflow-x: auto; white-space: nowrap; scrollbar-width: none; }
  .bar nav::-webkit-scrollbar { display: none; }
  .bar nav a { flex: none; padding: 4px 0; }
  .agreement-hero { padding-top: 158px; padding-bottom: 60px; }
  .agreement-catalog, .agreement-content { scroll-margin-top: 108px; }
  .agreement-ornaments { opacity: 0.8; }
  .agreement-ornaments span:nth-child(1) { right: 8%; top: 24%; font-size: 64px; }
  .agreement-ornaments span:nth-child(2) { right: 28%; top: 64%; font-size: 46px; }
  .agreement-ornaments span:nth-child(3) { right: 25%; top: 31%; font-size: 52px; }
  .agreement-ornaments span:nth-child(4) { right: 0; top: 83%; font-size: 38px; }
  .agreement-ornaments span:nth-child(5) { right: 46%; top: 88%; font-size: 32px; }
  .agreement-ornaments span:nth-child(6) { right: 60%; top: 34%; font-size: 34px; }
  .agreement-ornaments span:nth-child(7) { right: 7%; top: 64%; font-size: 28px; }
  .agreement-ornaments span:nth-child(8) { right: 41%; top: 46%; font-size: 38px; }
  .agreement-ornaments span:nth-child(9) { right: 72%; top: 80%; font-size: 28px; }
  .agreement-ornaments span:nth-child(10) { right: 19%; top: 92%; font-size: 34px; }
  .agreement-ornaments span:nth-child(11) { right: 58%; top: 69%; font-size: 20px; }
  .agreement-ornaments span:nth-child(12) { right: 84%; top: 30%; font-size: 30px; }
  .agreement-ornaments span:nth-child(13) { right: 30%; top: 18%; font-size: 24px; }
  .agreement-ornaments span:nth-child(14) { right: 22%; top: 44%; font-size: 28px; }
  .agreement-ornaments span:nth-child(15) { right: 4%; top: 38%; font-size: 22px; }
  .agreement-ornaments span:nth-child(16) { right: 18%; top: 78%; font-size: 26px; }
  .agreement-catalog, .agreement-content { padding-top: 40px; padding-bottom: 64px; }
  .document-link { grid-template-columns: 34px minmax(0, 1fr) 36px; gap: 14px; padding: 30px 0; }
  .document-link:hover { padding-left: 0; padding-right: 0; }
  .document-number { margin-top: 4px; }
  .document-description h2 { font-size: clamp(22px, 5.8vw, 28px); }
  .document-description p { font-size: 14px; }
  .document-arrow { width: 34px; height: 34px; }
  .document-arrow svg { width: 19px; height: 19px; }
  .document-article h2 { font-size: 24px; scroll-margin-top: 136px; }
  .document-article h3 { font-size: 20px; scroll-margin-top: 136px; }
  .document-notice { margin-bottom: 32px; padding: 14px 16px; }
}
@media print {
  html, body { background: white; color: black; }
  *, *::before, *::after { animation: none !important; transition: none !important; }
  .bar, .foot, .skip, .agreement-ornaments, .document-back, .document-arrow, .document-toc { display: none; }
  .agreement-hero, .agreement-catalog, .agreement-content { padding: 24px 0; background: white; color: black; }
  .agreement-hero h1 { font-size: 32px; }
  .agreement-hero .label, .agreement-lead, .document-description p, .document-status { color: #333; }
  .rv { opacity: 1; transform: none; }
  .document-link { break-inside: avoid; }
  .document-layout { display: block; }
  .document-article { max-width: none; color: #333; }
  .document-article h2, .document-article h3 { break-after: avoid; }
  .document-article p, .document-article li { orphans: 3; widows: 3; }
}
`;

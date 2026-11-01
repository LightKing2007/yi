/** 官网默认 404：沿用首页终章的深色背景、金色字形与放射几何。 */
import { BURST } from './geometry';
import { homeStyle } from './homeStyle';
import { shell } from './page';
import { minify } from './pageStyle';

const STYLE = `
.not-found { min-height: 100svh; display: grid; align-items: center;
  padding: clamp(96px, 12vh, 144px) var(--gut) clamp(72px, 9vh, 108px); }
.not-found .finale-title { animation: none; }
.not-found .cta .btn { width: 180px; justify-content: center; }
.not-found .burst::before { animation: spin-plain 240s linear infinite; }
`;

/** 未知页面使用统一的官网外观；HTTP 状态与 HEAD 语义由响应层保证。 */
export function notFoundPage(assetVersion: string) {
  return shell({
    title: '弈 · 页面未找到',
    description: '你访问的页面不存在，或已经移至其他地址。返回“弈”的主页、下载页面或帮助与支持。',
    assetVersion,
    nav: [
      ['/support', '帮助与支持'],
      ['/agreement', '政策与条款'],
    ],
    style: homeStyle() + minify(STYLE),
    body: `<section class="finale ink not-found" id="top">${BURST}<div class="finale-in">
<span class="label">页面未找到</span><h1 class="finale-title">404</h1>
<p class="finale-lead">这一手落在了棋盘之外。<br>你访问的页面不存在，或已经移至其他地址。</p>
<div class="cta"><a class="btn ghost" href="/"><span>返回主页</span></a><a class="btn ghost" href="/support"><span>帮助与支持</span></a></div>
<div class="os-row"><span>检查地址</span><span>返回主页</span><span>继续浏览</span></div>
</div></section>`,
  });
}

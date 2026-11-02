/** 官网默认 404：复用共享终章、按钮与放射几何，不加载主页私有样式。 */
import { BURST } from './geometry';
import { notFoundStyle } from './notFoundStyle';
import { shell } from './page';
import { btn } from './webUi';

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
    style: notFoundStyle(),
    body: `<section class="finale ink not-found" id="top">${BURST}<div class="finale-in">
<span class="label">页面未找到</span><h1 class="finale-title">404</h1>
<p class="finale-lead">这一手落在了棋盘之外。<br>你访问的页面不存在，或已经移至其他地址。</p>
<div class="cta">${btn({ href: '/', text: '返回主页', ghost: true })}${btn({ href: '/support', text: '帮助与支持', ghost: true })}</div>
<div class="os-row"><span>检查地址</span><span>返回主页</span><span>继续浏览</span></div>
</div></section>`,
  });
}

/**
 * 全站共享的可选增强包：磁性按钮、手机导航的关闭方式与悬停预取。
 * 零脚本基线不变：本文件只做增强，不承载任何内容与功能；禁用 JavaScript 时页面完整可用。
 * 同源、外部、defer 加载（page.ts 的 shell()），不 import 任何服务端模块。
 */

const MAGNET_X_LIMIT = 6;
const MAGNET_Y_LIMIT = 4;
const MAGNET_X_RATIO = 0.16;
const MAGNET_Y_RATIO = 0.3;
const PREFETCH_DELAY_MS = 65;
const finePointer = window.matchMedia('(pointer: fine)').matches;
const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * 磁性按钮：鼠标靠近时棋子般被轻轻吸住，离开后弹性归位。
 * 横向跟随 16% 限幅 ±6px，纵向 30% 限幅 ±4px；translate 与 transform 分离，回弹由 CSS 的 --ease-spring 完成。
 * 仅在精确指针且未要求减弱动态效果时启用；触屏与 reduced-motion 下按钮行为不变。
 */
function magnetize(el: HTMLElement) {
  let rect: DOMRect | null = null;
  el.addEventListener('pointerenter', () => {
    rect = el.getBoundingClientRect();
  });
  el.addEventListener('pointermove', event => {
    rect ??= el.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const x = Math.max(-MAGNET_X_LIMIT, Math.min(MAGNET_X_LIMIT, dx * MAGNET_X_RATIO));
    const y = Math.max(-MAGNET_Y_LIMIT, Math.min(MAGNET_Y_LIMIT, dy * MAGNET_Y_RATIO));
    el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
  });
  el.addEventListener('pointerleave', () => {
    rect = null;
    el.style.translate = '';
  });
}

if (finePointer && !calm) {
  document.querySelectorAll<HTMLElement>('.btn, .stone-btn').forEach(magnetize);
}

const MOBILE_NAV_QUERY = '(max-width: 720px)';

/**
 * 手机导航使用原生 details，关闭脚本仍可展开；脚本只补齐桌面常见的关闭方式。
 * 同页锚点跳转后收起面板，避免遮住刚到达的章节；Escape 关闭后把焦点还给菜单按钮。
 */
function enhanceMobileNavigation() {
  const menu = document.querySelector<HTMLDetailsElement>('details.nav-menu');
  if (!menu) return;
  const summary = menu.querySelector('summary');
  const compact = window.matchMedia(MOBILE_NAV_QUERY);
  document.addEventListener('pointerdown', event => {
    if (menu.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !menu.open) return;
    menu.open = false;
    summary?.focus();
  });
  menu.addEventListener('click', event => {
    if ((event.target as Element | null)?.closest('.nav-panel a')) menu.open = false;
  });
  compact.addEventListener('change', () => {
    if (!compact.matches) menu.open = false;
  });
}

enhanceMobileNavigation();

/**
 * 悬停预取：指针在同源链接上停留 65ms 即预取目标文档，点击时近似秒开。
 * 每个地址只预取一次；仅处理导航类 GET 链接，下载文件与锚点不预取。
 */
const prefetched = new Set<string>();
const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
let timer = 0;
if (finePointer && !connection?.saveData) {
  document.addEventListener('pointerover', event => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname === window.location.pathname || link.hasAttribute('download')) return;
    if (/\.(dmg|zip|AppImage|exe|tar|png|woff2)$/i.test(url.pathname)) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (prefetched.has(url.href)) return;
      prefetched.add(url.href);
      const tag = document.createElement('link');
      tag.rel = 'prefetch';
      tag.href = url.href;
      document.head.appendChild(tag);
    }, PREFETCH_DELAY_MS);
  });
  document.addEventListener('pointerout', event => {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
    if (link && !link.contains(event.relatedTarget as Node | null)) window.clearTimeout(timer);
  });
}

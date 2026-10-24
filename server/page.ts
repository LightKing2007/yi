/**
 * 网站页面（主页 homePage.ts、下载页面 downloadPage.ts）共用的部分：安装程序与平台的描述、文档外壳、顶栏、页脚、棋盘与棋子。
 * 页面不含任何脚本（API-063）：交互与动画全部以 CSS 实现，访客的操作系统由服务端按请求头推断（platform.ts）。
 */
import { siteStyle } from './pageStyle';

/** 页面上的一个安装程序；sha256 为 null 表示校验值尚在计算 */
export interface PagePkg {
  file: string;
  version: string;
  platform: string;
  size: number;
  sha256: string | null;
}

/** 平台的描述：名称、芯片或架构、系统要求、按钮上的简称 */
export interface PlatformInfo {
  label: string;
  tag: string;
  req: string;
  short: string;
}

/** 各平台的描述，按页面上的顺序排列 */
export const PLATFORMS: Record<string, PlatformInfo> = {
  'win-x64': { label: 'Windows', tag: 'x64', req: 'Windows 10 或更高版本', short: 'Windows 版' },
  'mac-arm64': { label: 'macOS', tag: 'Apple 芯片', req: 'macOS 13 或更高版本', short: 'macOS 版' },
  'mac-x64': { label: 'macOS', tag: 'Intel 芯片', req: 'macOS 13 或更高版本', short: 'macOS 版' },
  'linux-x86_64': { label: 'Linux', tag: 'x86_64', req: '可运行 AppImage 的桌面发行版', short: 'Linux 版' },
};

/** 域名 lightking.com.cn 的 ICP 备案号（2026-10-12 通过）：以域名对外提供网页时须在页面底部展示，并链接到工信部的备案管理系统 */
const ICP_NUMBER = '渝ICP备2025066996号-2';
const ICP_URL = 'https://beian.miit.gov.cn/';
/** GitHub 上发布说明的地址前缀 */
export const RELEASES = 'https://github.com/LightKing2007/yi/releases/tag/v';
const BYTES_PER_MB = 1048576;

/** 转义写入 HTML 的文字 */
export const esc = (text: string) => text.replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`);
/** 安装程序的大小，以 MB 计 */
export const megabytes = (bytes: number) => `${(bytes / BYTES_PER_MB).toFixed(0)} MB`;
/** 安装程序的下载地址 */
export const fileUrl = (p: PagePkg) => `/${encodeURIComponent(p.file)}`;
/** 各安装程序中最新的版本号 */
export const latestVersion = (pkgs: PagePkg[]) => pkgs.map(p => p.version).sort((older, newer) => newer.localeCompare(older, 'en', { numeric: true }))[0];

/** 下载图标 */
export const ARROW =
  '<svg class="ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" ' +
  'aria-hidden="true">' +
  '<path d="M8 2.5v8.5M4.5 7.5 8 11l3.5-3.5M3 13.5h10"/></svg>';

/** 顶栏的一个链接：地址与文字 */
export type NavLink = [href: string, text: string];

/** 文档外壳的选项 */
export interface ShellSpec {
  title: string;
  description: string;
  /** 资源地址的版本参数 */
  assetVersion: string;
  nav: NavLink[];
  /** 顶栏右侧按钮的地址与文字 */
  action: NavLink;
  /** 页面专有的样式 */
  style: string;
  body: string;
  /** 页面载入后自动打开的地址（下载页面借此开始下载，不用脚本） */
  refresh?: string;
}

/** 完整的 HTML 文档：头部、顶栏、正文与页脚 */
export function shell(spec: ShellSpec) {
  const version = spec.assetVersion;
  const nav = spec.nav.map(([href, text]) => `<a href="${href}">${text}</a>`).join('');
  const refresh = spec.refresh ? `<meta http-equiv="refresh" content="1;url=${spec.refresh}">` : '';
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${spec.title}</title><meta name="description" content="${spec.description}">${refresh}
<meta name="color-scheme" content="dark light"><meta name="theme-color" content="#0b0a09"><link rel="icon" href="/assets/icon.png?v=${version}">
<style>${siteStyle(version)}${spec.style}</style></head>
<body>
<a class="skip" href="#main">跳至正文</a>
<header class="bar"><a class="logo" href="/" aria-label="弈 主页"><span class="glyph"></span><span class="seal">棋</span></a>
<nav aria-label="页面导航">${nav}</nav><a class="pill" href="${spec.action[0]}">${spec.action[1]}</a></header>
<main id="main">${spec.body}</main>
<footer class="foot"><div class="foot-in">
<div class="foot-brand"><span class="glyph"></span><span class="foot-motto">以木为枰，以石为子</span></div>
<div class="foot-links"><a href="/">主页</a><a href="/download/">下载</a><a href="/SHA256SUMS">SHA256SUMS</a>
<a href="https://github.com/LightKing2007/yi" target="_blank" rel="noopener noreferrer">GitHub</a></div>
<div class="foot-legal"><span>Copyright © 2026 LightKing。保留所有权利。</span>
<span>游戏附带思源黑体、思源宋体的子集，依 SIL Open Font License 1.1 授权使用。</span>
<a class="icp" href="${ICP_URL}" target="_blank" rel="noopener noreferrer">
<img src="/assets/icp.png?v=${version}" alt="" width="16" height="16">${ICP_NUMBER}</a></div>
</div></footer>
</body></html>`;
}

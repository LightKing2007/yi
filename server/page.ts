/**
 * 网站页面共用部分：安装程序与平台描述、推荐程序、文档外壳、顶栏与页脚；协议页也复用同一外壳。
 * 动效优先以 CSS 实现，访客的操作系统由服务端按请求头推断（platform.ts）；全站使用同源外部增强脚本，帮助目录另有检索脚本（API-063）。
 */
import { siteStyle } from './pageStyle';
import { siteNavigation } from './webUi';
import { AGREEMENT_INFO } from './agreementText';
import { esc } from './webHtml';
import type { Detected } from './platform';

export { esc } from './webHtml';

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

/** 安装程序的大小，以 MB 计 */
export const megabytes = (bytes: number) => `${(bytes / BYTES_PER_MB).toFixed(0)} MB`;
/** 安装程序的下载地址 */
export const fileUrl = (p: PagePkg) => `/${encodeURIComponent(p.file)}`;
/** 推荐给访客的安装程序：与推断的操作系统对应；手机与无法推断时没有（此时 platform 为 null） */
export const recommended = (pkgs: PagePkg[], detected: Detected) => pkgs.find(p => p.platform === detected.platform);
/** 各安装程序中最新的版本号 */
export const latestVersion = (pkgs: PagePkg[]) => pkgs.map(p => p.version).sort((older, newer) => newer.localeCompare(older, 'en', { numeric: true }))[0];

/** 顶栏的一个链接：地址与文字 */
export type NavLink = [href: string, text: string];

/** 文档外壳的选项 */
export interface ShellSpec {
  title: string;
  description: string;
  /** 资源地址的版本参数 */
  assetVersion: string;
  nav: NavLink[];
  /** 当前页面对应的导航地址，用于 aria-current */
  current?: string;
  /** 页面专有的样式 */
  style: string;
  body: string;
  /** 页面载入后自动打开的地址（下载页面借此开始下载，不用脚本） */
  refresh?: string;
  /** 页面私有的同源外部脚本；全站增强包由外壳统一加入 */
  script?: string;
  /** 页脚内容层之前的装饰；由页面生成，不进入无障碍树 */
  footerVisual?: string;
}

/** 完整的 HTML 文档：头部、顶栏、正文与页脚 */
export function shell(spec: ShellSpec) {
  const version = esc(spec.assetVersion);
  const refresh = spec.refresh ? `<meta http-equiv="refresh" content="1;url=${esc(spec.refresh)}">` : '';
  /** 全站可选增强包：磁性按钮、手机导航与悬停预取；无脚本时页面功能完整（规范 11 第 2.3 节） */
  const enhance = `<script defer src="/assets/site-enhance.js?v=${version}"></script>`;
  const script = `${enhance}${spec.script ? `<script defer src="${esc(spec.script)}"></script>` : ''}`;
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(spec.title)}</title><meta name="description" content="${esc(spec.description)}">${refresh}
<meta name="color-scheme" content="dark light"><meta name="theme-color" content="#0b0a09"><link rel="icon" href="/assets/icon.png?v=${version}">
<link rel="preload" href="/assets/yi-serif-900.woff2?v=${version}" as="font" type="font/woff2" crossorigin>
<style>${siteStyle(version)}${spec.style}</style>${script}</head>
<body>
<a class="skip" href="#main">跳至正文</a>
<header class="bar"><a class="logo" href="/" aria-label="弈 主页"><span class="glyph"></span></a>
${siteNavigation(spec.nav, spec.current)}</header>
<main id="main">${spec.body}</main>
<footer class="foot">${spec.footerVisual ?? ''}<div class="foot-in">
<div class="foot-brand"><span class="glyph"></span><span class="foot-motto">以木为枰，以石为子</span></div>
<div class="foot-links"><a href="/">主页</a><a href="/download/">下载</a><a href="/donate">支持作者</a><a href="/support">帮助与支持</a>
<a href="/agreement">${esc(AGREEMENT_INFO.title)}</a>
<a href="https://github.com/LightKing2007/yi" target="_blank" rel="noopener noreferrer">GitHub</a></div>
<div class="foot-legal"><span>Copyright © 2026 LightKing。保留所有权利。</span>
<span>游戏附带思源黑体、思源宋体的子集，依 SIL Open Font License 1.1 授权使用。</span>
<a class="icp" href="${ICP_URL}" target="_blank" rel="noopener noreferrer">
<img src="/assets/icp.png?v=${version}" alt="" width="16" height="16">${ICP_NUMBER}</a></div>
</div></footer>
</body></html>`;
}

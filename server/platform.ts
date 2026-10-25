/**
 * 按请求头推断访客的操作系统，供主页与下载页面推荐安装程序。页面不含脚本（API-063），只能在服务端判断：
 * 先看用户代理客户端提示（Sec-CH-UA-Platform、Sec-CH-UA-Arch，Chromium 系浏览器发送），再看 User-Agent。
 * Safari 与 Firefox 不发送芯片架构，Mac 上一律报告“Intel Mac OS X”，此时推荐 Apple 芯片版本并标为不确定，由页面请访客确认。
 */
import type { IncomingHttpHeaders } from 'node:http';

/** 页面响应附带的头：请浏览器在之后的请求中发送芯片架构（Chromium 系浏览器在 HTTPS 下遵从） */
export const CLIENT_HINT_HEADERS = {
  'Accept-CH': 'Sec-CH-UA-Platform, Sec-CH-UA-Arch, Sec-CH-UA-Mobile',
  Vary: 'User-Agent, Sec-CH-UA-Platform, Sec-CH-UA-Arch, Sec-CH-UA-Mobile',
};

/** 推断的结果：platform 为 PLATFORMS 中的键，无法推断或没有对应的安装程序时为 null */
export interface Detected {
  platform: string | null;
  /** 手机或平板：游戏只有桌面版 */
  mobile: boolean;
  /** 推断是否确定；Mac 的芯片架构为推测时为 false */
  sure: boolean;
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile/;
/** 客户端提示的取值带引号，如 "macOS" */
const unquote = (value: string | string[] | undefined) => (typeof value === 'string' ? value.replace(/"/g, '').trim() : '');

/** 按请求头推断访客的操作系统；只用于推荐，访客总可以改选其他版本 */
export function detectPlatform(headers: IncomingHttpHeaders): Detected {
  const ua = headers['user-agent'] ?? '';
  const hint = unquote(headers['sec-ch-ua-platform']);
  const arch = unquote(headers['sec-ch-ua-arch']);
  if (unquote(headers['sec-ch-ua-mobile']) === '?1' || hint === 'Android' || hint === 'iOS' || MOBILE_UA.test(ua)) {
    return { platform: null, mobile: true, sure: true };
  }
  if (hint === 'macOS' || /Macintosh|Mac OS X/.test(ua)) {
    if (arch === 'x86') return { platform: 'mac-x64', mobile: false, sure: true };
    return { platform: 'mac-arm64', mobile: false, sure: arch === 'arm' };
  }
  // ARM 版 Windows 11 可以运行 x64 程序
  if (hint === 'Windows' || /Windows NT/.test(ua)) return { platform: 'win-x64', mobile: false, sure: true };
  if (hint === 'Linux' || /Linux/.test(ua)) {
    const arm = arch === 'arm' || /aarch64|arm/i.test(ua);
    return { platform: arm ? null : 'linux-x86_64', mobile: false, sure: !arm };
  }
  return { platform: null, mobile: false, sure: false };
}

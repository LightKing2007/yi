/** 网站：按请求头推断访客的操作系统（platform.ts），下载页面据此推荐安装程序，带 ?start 时自动开始下载 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { startHost } from '../server/host';
import { detectPlatform } from '../server/platform';

const UA = {
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  winEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0',
  linuxArm: 'Mozilla/5.0 (X11; Linux aarch64; rv:144.0) Gecko/20100101 Firefox/144.0',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
};

describe('推断访客的操作系统 detectPlatform', () => {
  it('按 User-Agent 推断：Windows、Linux 确定；Mac 上的 Safari 与 Firefox 不报告芯片，推荐 Apple 芯片版本并标为不确定', () => {
    expect(detectPlatform({ 'user-agent': UA.winEdge })).toEqual({ platform: 'win-x64', mobile: false, sure: true });
    expect(detectPlatform({ 'user-agent': UA.linuxFirefox })).toEqual({ platform: 'linux-x86_64', mobile: false, sure: true });
    expect(detectPlatform({ 'user-agent': UA.macSafari })).toEqual({ platform: 'mac-arm64', mobile: false, sure: false });
  });

  it('按客户端提示推断 Mac 的芯片：arm 为 Apple 芯片，x86 为 Intel 芯片，均为确定', () => {
    const mac = { 'user-agent': UA.macChrome, 'sec-ch-ua-platform': '"macOS"' };
    expect(detectPlatform({ ...mac, 'sec-ch-ua-arch': '"arm"' })).toEqual({ platform: 'mac-arm64', mobile: false, sure: true });
    expect(detectPlatform({ ...mac, 'sec-ch-ua-arch': '"x86"' })).toEqual({ platform: 'mac-x64', mobile: false, sure: true });
    expect(detectPlatform({ 'sec-ch-ua-platform': '"Windows"' }).platform).toBe('win-x64');
  });

  it('手机与平板只标为移动设备；ARM 架构的 Linux 与无法识别的系统没有对应的安装程序', () => {
    for (const ua of [UA.iphone, UA.android]) expect(detectPlatform({ 'user-agent': ua })).toEqual({ platform: null, mobile: true, sure: true });
    expect(detectPlatform({ 'user-agent': UA.macChrome, 'sec-ch-ua-mobile': '?1' }).mobile).toBe(true);
    expect(detectPlatform({ 'user-agent': UA.linuxArm }).platform).toBeNull();
    expect(detectPlatform({})).toEqual({ platform: null, mobile: false, sure: false });
  });
});

describe('下载页面', () => {
  /** 在临时目录放好四个平台的安装程序并启动服务端，run 结束后关闭并删除目录 */
  async function withSite(run: (get: (route: string, headers?: Record<string, string>) => Promise<Response>) => Promise<void>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-site-'));
    for (const file of ['Yi-3.0.0-win-x64-setup.exe', 'Yi-3.0.0-mac-arm64.dmg', 'Yi-3.0.0-mac-x64.dmg', 'Yi-3.0.0-linux-x86_64.AppImage'])
      fs.writeFileSync(path.join(dir, file), file);
    const host = await startHost(0, { host: '127.0.0.1', files: dir });
    const get = (route: string, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${host.port}${route}`, { headers, redirect: 'manual' });
    try {
      // 校验值算完之后页面才进入缓存：先等它们算完，使缓存的行为也在检查之内
      for (let i = 0; i < 100 && (await get('/SHA256SUMS')).status !== 200; i++) await new Promise(r => setTimeout(r, 10));
      await run(get);
    } finally {
      await host.close();
      fs.rmSync(dir, { recursive: true });
    }
  }
  const refresh = (html: string) => /<meta http-equiv="refresh" content="1;url=([^"]+)">/.exec(html)?.[1];

  it('/download 重定向到 /download/；页面请求芯片架构的客户端提示，并按这些请求头区分缓存', async () => {
    await withSite(async get => {
      const moved = await get('/download');
      expect([moved.status, moved.headers.get('location')]).toEqual([301, '/download/']);
      for (const route of ['/', '/download/']) {
        const page = await get(route);
        expect(page.status).toBe(200);
        expect(page.headers.get('accept-ch')).toContain('Sec-CH-UA-Arch');
        expect(page.headers.get('vary')).toContain('User-Agent');
      }
    });
  });

  it('下载页面带 ?start 时，推断确定的访客进入页面即开始下载；Mac 的芯片不确定、手机与未带 ?start 时不自动下载', async () => {
    await withSite(async get => {
      const page = async (route: string, headers: Record<string, string>) => (await get(route, headers)).text();
      expect(refresh(await page('/download/?start', { 'user-agent': UA.winEdge }))).toBe('/Yi-3.0.0-win-x64-setup.exe');
      const armHints = { 'user-agent': UA.macChrome, 'sec-ch-ua-platform': '"macOS"', 'sec-ch-ua-arch': '"arm"' };
      expect(refresh(await page('/download/?start', armHints))).toBe('/Yi-3.0.0-mac-arm64.dmg');
      const safari = await page('/download/?start', { 'user-agent': UA.macSafari });
      expect(refresh(safari)).toBeUndefined();
      expect(safari).toContain('href="/Yi-3.0.0-mac-x64.dmg" download>下载 Intel 芯片版本</a>'); // 请访客确认芯片
      const phone = await page('/download/?start', { 'user-agent': UA.iphone });
      expect(refresh(phone)).toBeUndefined();
      expect(phone).toContain('“弈”为桌面游戏');
      expect(refresh(await page('/download/', { 'user-agent': UA.winEdge }))).toBeUndefined();
    });
  });
});

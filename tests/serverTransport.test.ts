/** 联机服务端：真实的 WebSocket 连接、端口占用、同一端口上的安装程序下载 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startHost } from '../server/host';
import { startWebsite } from '../server/websiteHost';
import { PROTO_VERSION, type S2C } from '../src/shared/protocol';
import { newUid, type Msg } from './serverWorld';

describe('WebSocket 传输', () => {
  it('两个真实连接开一局并在断线后重连', async () => {
    const host = await startHost(0, { host: '127.0.0.1' });
    const url = `ws://127.0.0.1:${host.port}`;
    const open = (name: string, token?: string) =>
      new Promise<{ ws: WebSocket; next: <T extends S2C['t']>(type: T) => Promise<Msg<T>> }>((res, rej) => {
        const ws = new WebSocket(url),
          inbox: S2C[] = [],
          waiters: [S2C['t'], (m: S2C) => void][] = [];
        ws.on('message', data => {
          const m = JSON.parse(String(data)) as S2C;
          const idx = waiters.findIndex(([type]) => type === m.t);
          if (idx >= 0) waiters.splice(idx, 1)[0]?.[1](m);
          else inbox.push(m);
        });
        /** 等到下一条该类型的消息 */
        const next = <T extends S2C['t']>(type: T) =>
          new Promise<Msg<T>>(r => {
            const deliver = (m: S2C) => r(m as Msg<T>);
            const i = inbox.findIndex(m => m.t === type);
            const found = i >= 0 ? inbox.splice(i, 1)[0] : undefined;
            if (found) deliver(found);
            else waiters.push([type, deliver]);
          });
        ws.on('open', () => {
          ws.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, name, uid: newUid(), token }));
          res({ ws, next });
        });
        ws.on('error', rej);
      });
    try {
      const jia = await open('甲'),
        yi = await open('乙');
      await jia.next('welcome');
      const wb = await yi.next('welcome');
      jia.ws.send(JSON.stringify({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 }));
      const { code } = await jia.next('created');
      yi.ws.send(JSON.stringify({ t: 'join', code }));
      expect((await yi.next('start')).color).toBe(2);
      jia.ws.send(JSON.stringify({ t: 'move', x: 7, y: 7 }));
      expect(await yi.next('moved')).toEqual({ t: 'moved', x: 7, y: 7 });
      jia.ws.send('不是 JSON'); // 不是 JSON 的内容按非法消息回复，连接照常
      expect(await jia.next('error')).toEqual({ t: 'error', text: '消息格式错误' });
      yi.ws.terminate();
      expect((await jia.next('peer')).online).toBe(false);
      const yi2 = await open('乙', wb.token);
      expect((await yi2.next('sync')).acts).toEqual([{ k: 'M', x: 7, y: 7 }]);
      expect((await jia.next('peer')).online).toBe(true);
      jia.ws.close();
      yi2.ws.close();
    } finally {
      await host.close();
    }
  });
});

describe('端口', () => {
  it('端口被占用时 startHost 以 EADDRINUSE 拒绝，不抛出未处理的异常；同时监听几个端口时也一样', async () => {
    const busy = await startHost(0, { host: '127.0.0.1' });
    try {
      await expect(startHost(busy.port, { host: '127.0.0.1' })).rejects.toMatchObject({ code: 'EADDRINUSE' });
      await expect(startHost([0, busy.port], { host: '127.0.0.1' })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await busy.close();
    }
  });
});

describe('安装包下载', () => {
  it('官网独立提供各平台最新安装程序与断点续传，其他文件拿不到；联机另用自己的端口', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-files-'));
    fs.writeFileSync(path.join(dir, 'Yi-2.0.0-win-x64-setup.exe'), 'old');
    fs.writeFileSync(path.join(dir, 'Yi-2.0.1-win-x64-setup.exe'), '0123456789');
    fs.writeFileSync(path.join(dir, 'Yi-2.0.1-mac-arm64.dmg'), 'mac');
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'no');
    const host = await startWebsite({ port: 0, commit: 'test', files: dir, now: () => 1 });
    const base = `http://127.0.0.1:${host.port}`;
    try {
      const page = await (await fetch(base + '/download/')).text();
      expect(page).toContain('Yi-2.0.1-win-x64-setup.exe');
      expect(page).toContain('Yi-2.0.1-mac-arm64.dmg');
      expect(page).not.toContain('2.0.0');
      expect(page).not.toContain('secret');
      const whole = await fetch(base + '/Yi-2.0.1-win-x64-setup.exe');
      expect(whole.status).toBe(200);
      expect(await whole.text()).toBe('0123456789');
      const part = await fetch(base + '/Yi-2.0.1-win-x64-setup.exe', { headers: { Range: 'bytes=4-' } });
      expect(part.status).toBe(206);
      expect(part.headers.get('content-range')).toBe('bytes 4-9/10');
      expect(await part.text()).toBe('456789');
      for (const bad of ['/secret.txt', '/Yi-2.0.0-win-x64-setup.exe', '/..%2Fetc%2Fpasswd', '/Yi-2.0.1-win-x64-setup.exe/x'])
        expect((await fetch(base + bad)).status).toBe(404);
      expect((await fetch(base + '/', { method: 'POST' })).status).toBe(405);
      const game = await startHost(0, { host: '127.0.0.1' });
      const ws = new WebSocket(`ws://127.0.0.1:${game.port}`); // 联机端口独立于官网
      await new Promise((res, rej) => {
        ws.on('open', res);
        ws.on('error', rej);
      });
      ws.close();
      await game.close();
    } finally {
      await host.close();
      fs.rmSync(dir, { recursive: true });
    }
  });
});

describe('网站页面', () => {
  it('主页与下载页面带安全响应头，只提供名单内的资源，页脚有 ICP 备案号；SHA256SUMS 与页面上的校验值一致（API-060、API-063、SEC-070）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-files-'));
    fs.writeFileSync(path.join(dir, 'Yi-2.0.3-win-x64-setup.exe'), 'windows');
    fs.writeFileSync(path.join(dir, 'Yi-2.0.3-linux-x86_64.AppImage'), 'linux');
    const host = await startWebsite({ port: 0, commit: 'test', files: dir, now: () => 1 });
    const base = `http://127.0.0.1:${host.port}`;
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    try {
      for (const route of ['/', '/download/', '/download/?start']) {
        const page = await fetch(base + route);
        expect(page.headers.get('content-security-policy'), route).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'");
        expect(page.headers.get('x-content-type-options')).toBe('nosniff');
        expect(page.headers.get('referrer-policy')).toBe('no-referrer');
        const html = await page.text();
        expect(html).not.toMatch(/<script/i);
        expect(html).toContain('/assets/title-yi.png');
        // 页脚展示 ICP 备案号并链接到工信部的备案管理系统（以域名对外提供网页的要求）
        expect(html).toMatch(
          /<a class="icp" href="https:\/\/beian\.miit\.gov\.cn\/"[^>]*>\s*<img src="\/assets\/icp\.png\?v=[^"]+"[^>]*>渝ICP备2025066996号-2<\/a>/,
        );
      }
      for (const [name, type] of [
        ['title-yi.png', 'image/png'],
        ['icon.png', 'image/png'],
        ['yi-serif-900.woff2', 'font/woff2'],
        ['yi-serif-400.woff2', 'font/woff2'],
        ['icp.png', 'image/png'],
      ]) {
        const r = await fetch(`${base}/assets/${name}?v=1`);
        expect(r.status, name).toBe(200);
        expect(r.headers.get('content-type')).toBe(type);
        expect((await r.arrayBuffer()).byteLength).toBeGreaterThan(1000);
      }
      for (const bad of ['/assets/nope.png', '/assets/', '/assets/..%2Fpackage.json', '/assets/toString'])
        expect((await fetch(base + bad)).status, bad).toBe(404);
      let sums = await fetch(base + '/SHA256SUMS');
      for (let i = 0; i < 50 && sums.status === 503; i++) {
        await new Promise(r => setTimeout(r, 20));
        sums = await fetch(base + '/SHA256SUMS');
      }
      expect(await sums.text()).toBe(`${sha('windows')}  Yi-2.0.3-win-x64-setup.exe\n${sha('linux')}  Yi-2.0.3-linux-x86_64.AppImage\n`);
      const again = await (await fetch(base + '/download/')).text();
      expect(again).toContain(sha('windows'));
      expect(again).toContain('macOS 13 Ventura 或更高版本');
    } finally {
      await host.close();
      fs.rmSync(dir, { recursive: true });
    }
  });
});

describe('下载名额与未设安装包目录', () => {
  it('经本机反向代理的下载按真实地址计数：同一地址同时至多 2 个，其他地址照常下载', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-files-'));
    fs.writeFileSync(path.join(dir, 'Yi-2.0.9-linux-x86_64.AppImage'), Buffer.alloc(16 * 1024 * 1024)); // 足够大，暂停读取时下载一直进行
    const host = await startWebsite({ port: 0, commit: 'test', files: dir, now: () => 1 });
    const pending: http.ClientRequest[] = [];
    /** 以代理转来的方式开始下载，收到响应头后暂停读取，返回状态码 */
    const download = (ip: string) =>
      new Promise<number>((res, rej) => {
        const req = http.get(
          { host: '127.0.0.1', port: host.port, path: '/Yi-2.0.9-linux-x86_64.AppImage', agent: false, headers: { 'X-Forwarded-For': ip } },
          r => {
            r.pause();
            res(r.statusCode ?? 0);
          },
        );
        req.on('error', rej);
        pending.push(req);
      });
    try {
      expect([await download('198.51.100.1'), await download('198.51.100.1')]).toEqual([200, 200]);
      expect(await download('198.51.100.1')).toBe(503);
      expect(await download('198.51.100.2')).toBe(200);
    } finally {
      for (const req of pending) req.destroy();
      await host.close();
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('联机端口不提供官网页面或安装程序', async () => {
    const host = await startHost(0, { host: '127.0.0.1' });
    try {
      for (const route of ['/', '/download/', '/agreement', '/agreement/privacy-policy'])
        expect((await fetch(`http://127.0.0.1:${host.port}${route}`)).status).toBe(404);
    } finally {
      await host.close();
    }
  });
});

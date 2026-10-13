/** HTTP 请求（下载页面、资源与安装程序）：按 IP 的频率限制（API-041）与目录列表的缓存（P2-17），经真实的 HTTP 连接 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { startHost } from '../server/host';
import type { Log } from '../server/log';
import { HTTP_BURST } from '../server/ratelimit';

describe('HTTP 请求', () => {
  it('同一 IP（经代理时按真实地址）的 HTTP 请求超出频率时返回 429 与 Retry-After，其他 IP 照常；本机直接发出的请求不计；日志至多每分钟一行（API-041）', async () => {
    let clock = 1000;
    const logs: string[] = [];
    const log: Log = (level, event, entry = {}) => logs.push(`${level} ${event} ${String(entry.count)}`);
    const host = await startHost(0, { host: '127.0.0.1', now: () => clock, log });
    const get = (ip?: string) => fetch(`http://127.0.0.1:${host.port}/`, { headers: ip ? { 'X-Forwarded-For': ip } : {} });
    /** 以 ip 连续请求 n 次，返回各次的状态码 */
    const burst = async (ip: string, n: number) => {
      const codes: number[] = [];
      for (let i = 0; i < n; i++) codes.push((await get(ip)).status);
      return codes;
    };
    try {
      expect(await burst('198.51.100.1', HTTP_BURST)).toEqual(Array(HTTP_BURST).fill(404)); // 没设安装包目录：放行的请求为 404
      const limited = await get('198.51.100.1');
      expect([limited.status, limited.headers.get('retry-after'), await limited.text()]).toEqual([429, '1', '请求过于频繁，请稍后再试。']);
      expect([(await get('198.51.100.1')).status, (await get('198.51.100.2')).status]).toEqual([429, 404]);
      for (let i = 0; i < HTTP_BURST + 10; i++) expect((await get()).status).toBe(404);
      expect(logs).toEqual(['warn http.limited 1']);
      clock += 60;
      expect((await burst('198.51.100.1', HTTP_BURST + 1)).at(-1)).toBe(429);
      expect(logs).toEqual(['warn http.limited 1', 'warn http.limited 2']); // 两行之间被拒 2 次
    } finally {
      await host.close();
    }
  });

  it('目录未变时不再读取目录；新增安装程序后页面随即列出；原地改写的安装程序按新的内容下载，已删掉的返回 404（P2-17）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-files-'));
    const exe = path.join(dir, 'Yi-2.0.1-win-x64-setup.exe');
    fs.writeFileSync(exe, '0123456789');
    const host = await startHost(0, { host: '127.0.0.1', files: dir });
    const base = `http://127.0.0.1:${host.port}`;
    const readdir = vi.spyOn(fs, 'readdirSync');
    const reads = () => readdir.mock.calls.filter(([at]) => at === dir).length;
    try {
      await (await fetch(base + '/')).text();
      await (await fetch(base + '/')).text();
      expect(await (await fetch(base + '/Yi-2.0.1-win-x64-setup.exe')).text()).toBe('0123456789');
      expect(reads()).toBe(1);
      fs.writeFileSync(path.join(dir, 'Yi-2.0.1-mac-arm64.dmg'), 'mac');
      expect(await (await fetch(base + '/')).text()).toContain('Yi-2.0.1-mac-arm64.dmg');
      fs.writeFileSync(exe, 'abc'); // 原地改写不改变目录
      const changed = await fetch(base + '/Yi-2.0.1-win-x64-setup.exe');
      expect([changed.headers.get('content-length'), await changed.text()]).toEqual(['3', 'abc']);
      fs.rmSync(exe); // 列出之后被删掉：下载前核对时发现，按不存在处理
      expect((await fetch(base + '/Yi-2.0.1-win-x64-setup.exe')).status).toBe(404);
    } finally {
      readdir.mockRestore();
      await host.close();
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('安装包目录在列出之后消失（例如切换版本的瞬间）时，页面照常显示，只是不再列出原来的安装程序', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-files-'));
    fs.writeFileSync(path.join(dir, 'Yi-2.0.1-win-x64-setup.exe'), 'win');
    const host = await startHost(0, { host: '127.0.0.1', files: dir });
    const base = `http://127.0.0.1:${host.port}`;
    try {
      expect(await (await fetch(base + '/')).text()).toContain('Yi-2.0.1-win-x64-setup.exe');
      fs.rmSync(dir, { recursive: true });
      const page = await fetch(base + '/');
      expect(page.status).toBe(200);
      expect(await page.text()).not.toContain('Yi-2.0.1-win-x64-setup.exe');
    } finally {
      await host.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

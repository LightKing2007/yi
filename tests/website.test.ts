/** 独立官网：配置隔离、真实 HTTP 页面、下载及健康检查，不启动联机服务。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseWebsiteConfig } from '../server/websiteConfig';
import { startWebsite } from '../server/websiteHost';

describe('独立官网', () => {
  it('网站配置只读取自身端口和目录，错误参数拒绝启动，版本查询不受部署配置影响', () => {
    const config = parseWebsiteConfig([], { PORT: 'bad', YI_DB: '/private/game.db', YI_WEB_PORT: '8445', YI_WEB_FILES: 'packages' }, '/srv/site');
    expect(config).toEqual({ version: false, port: 8445, files: '/srv/site/packages', errors: [] });
    expect(parseWebsiteConfig([], {}, '/srv/site').port).toBe(8444);
    expect(parseWebsiteConfig([], {}, '/srv/site').files).toBe('/srv/site/downloads/current');
    for (const port of ['0', '65536', 'bad', '1.5', '']) expect(parseWebsiteConfig([], { YI_WEB_PORT: port }, '/').errors).not.toEqual([]);
    expect(parseWebsiteConfig(['backup'], { YI_WEB_FILES: '' }, '/').errors).toHaveLength(2);
    expect(parseWebsiteConfig(['--version'], { YI_WEB_PORT: 'bad' }, '/').errors).toEqual([]);
  });

  it('官网独立提供主页和文书、校验后的安装包范围下载，健康检查不向代理请求公开', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-website-'));
    fs.writeFileSync(path.join(dir, 'Yi-3.1.0-win-x64-setup.exe'), '0123456789');
    const site = await startWebsite({ port: 0, files: dir, commit: 'web-commit', now: () => 1 });
    const base = `http://127.0.0.1:${site.port}`;
    try {
      for (const route of ['/', '/download/', '/agreement', '/privacy-policy', '/terms-of-service', '/minors-privacy-rules']) {
        const response = await fetch(base + route);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
        expect(await response.text()).toContain('隐私政策与服务条款');
      }
      const part = await fetch(base + '/Yi-3.1.0-win-x64-setup.exe', { headers: { Range: 'bytes=4-6' } });
      expect([part.status, await part.text()]).toEqual([206, '456']);
      const health = await fetch(base + '/healthz');
      expect(health.headers.get('x-content-type-options')).toBe('nosniff');
      expect(await health.json()).toEqual({ service: 'yi-web', commit: 'web-commit' });
      expect((await fetch(base + '/healthz', { headers: { 'X-Forwarded-For': '198.51.100.1' } })).status).toBe(404);
      expect((await fetch(base + '/metrics')).status).toBe(404);
      expect(fs.readdirSync(dir)).toEqual(['Yi-3.1.0-win-x64-setup.exe']);
    } finally {
      await site.close();
      fs.rmSync(dir, { recursive: true });
    }
  });

  it('官网独立监听本机端口，端口占用时明确失败', async () => {
    const opt = { port: 0, files: '/nonexistent/website', commit: 'test', now: () => 1 };
    const site = await startWebsite(opt);
    try {
      await expect(startWebsite({ ...opt, port: site.port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await site.close();
    }
  });
});

describe('官网访问记录清理', () => {
  it('按注入时间定期清理失效的访问记录，关闭官网时释放调度器', async () => {
    let clock = 1;
    let prune = () => {};
    let stopped = false;
    const site = await startWebsite({
      port: 0,
      files: '/nonexistent/website',
      commit: 'test',
      now: () => clock,
      every: (task, ms) => {
        prune = task;
        expect(ms).toBe(10_000);
        return () => {
          stopped = true;
        };
      },
    });
    try {
      const response = await fetch(`http://127.0.0.1:${site.port}/agreement`, { headers: { 'X-Forwarded-For': '198.51.100.2' } });
      await response.text();
      expect(site.trackedIps()).toBe(1);
      clock = 3600;
      prune();
      expect(site.trackedIps()).toBe(0);
    } finally {
      await site.close();
    }
    expect(stopped).toBe(true);
  });
});

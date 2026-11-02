/** 官网固定更新清单的 HTTP 白名单、缓存与 HEAD；不使用外网（API-060、TST-032）。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { startWebsite } from '../server/websiteHost';

it('更新清单只允许固定路径，GET 与 HEAD 长度一致、禁止缓存，缺失和过大时拒绝', async () => {
  fs.mkdirSync(path.join(__dirname, '../.cache'), { recursive: true });
  const dir = fs.mkdtempSync(path.join(__dirname, '../.cache/feed-test-'));
  fs.writeFileSync(path.join(dir, 'latest.yml'), 'version: 4.1.0\n');
  fs.writeFileSync(path.join(dir, 'latest-linux.yml'), 'x'.repeat(65_537));
  fs.writeFileSync(path.join(dir, 'secret.yml'), 'private');
  const host = await startWebsite({ port: 0, commit: 'test', files: dir, now: () => 1 });
  const base = `http://127.0.0.1:${host.port}`;
  try {
    const response = await fetch(`${base}/latest.yml?noCache=1`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.text()).toBe('version: 4.1.0\n');
    const head = await fetch(`${base}/latest.yml`, { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe(response.headers.get('content-length'));
    expect(await head.text()).toBe('');
    for (const name of ['latest-linux.yml', 'secret.yml', 'latest-mac.yml', 'nested/latest.yml', 'latest.yml/']) {
      expect((await fetch(`${base}/${name}`)).status).toBe(404);
    }
    fs.renameSync(path.join(dir, 'latest.yml'), path.join(dir, 'saved.yml'));
    expect((await fetch(`${base}/latest.yml`)).status).toBe(404);
  } finally {
    await host.close();
    if (process.platform === 'darwin') execFileSync('/usr/bin/trash', [dir]);
    else fs.rmSync(dir, { recursive: true });
  }
});

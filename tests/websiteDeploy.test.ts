/** 独立官网部署：校验失败不切换，健康检查失败回滚，网站回滚不操作联机服务。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { installWebsite, rollbackWebsite, verifyWebsiteFiles, websiteCommit, websiteLink, type WebsiteDeployment } from '../scripts/website-deploy';

/** 构造虚构网站产物；静态页面也按真实发布形式打包和展开。 */
function release(dir: string, digit: string) {
  const commit = digit.repeat(40);
  fs.mkdirSync(path.join(dir, 'site/assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'web.cjs'), `website ${digit}`);
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ service: 'yi-web', commit }));
  for (const name of ['agreement.html', 'support.html', '404.html', 'assets/support-search.js']) fs.writeFileSync(path.join(dir, 'site', name), name);
  execFileSync('tar', ['-cf', path.join(dir, 'site.tar'), '-C', path.join(dir, 'site'), '.']);
  fs.writeFileSync(
    path.join(dir, 'SHA256SUMS'),
    ['web.cjs', 'manifest.json', 'site.tar']
      .map(
        name =>
          `${createHash('sha256')
            .update(fs.readFileSync(path.join(dir, name)))
            .digest('hex')}  ${name}`,
      )
      .join('\n') + '\n',
  );
  return { commit, tag: `web-${commit.slice(0, 12)}` };
}

/** 只有服务操作和等待为假边界，目录切换与内容校验使用真实文件系统。 */
function world(root: string) {
  const actions: string[] = [];
  const ctx: WebsiteDeployment = {
    root,
    copy: fs.copyFileSync,
    extract: (archive, target) => execFileSync('tar', ['-xf', archive, '-C', target]),
    service: action => {
      actions.push(action);
    },
    healthy: async () => true,
    wait: async () => {},
    now: () => '2026-10-31T00:00:00Z',
  };
  return { ctx, actions };
}

it('通过校验才切换版本，保留上一版并可单独回滚；损坏文件和标签不符不会触碰现行版本', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-web-deploy-'));
  const { ctx, actions } = world(path.join(dir, 'site'));
  const old = release(path.join(dir, 'old'), 'a');
  const next = release(path.join(dir, 'next'), 'b');
  try {
    await installWebsite(ctx, path.join(dir, 'old'), old.tag);
    await installWebsite(ctx, path.join(dir, 'old'), old.tag);
    await expect(installWebsite(ctx, path.join(dir, 'next'), old.tag)).rejects.toThrow('标签');
    expect(websiteLink(ctx.root, 'current')).toBe(`releases/${old.commit}`);
    await installWebsite(ctx, path.join(dir, 'next'), next.tag);
    expect(websiteLink(ctx.root, 'previous')).toBe(`releases/${old.commit}`);
    await rollbackWebsite(ctx);
    expect(websiteLink(ctx.root, 'current')).toBe(`releases/${old.commit}`);
    fs.appendFileSync(path.join(dir, 'next', 'web.cjs'), 'corrupt');
    await expect(installWebsite(ctx, path.join(dir, 'next'), next.tag)).rejects.toThrow('校验不符');
    expect(websiteLink(ctx.root, 'current')).toBe(`releases/${old.commit}`);
    expect(actions).toEqual(['restart', 'restart', 'restart', 'restart']);
    expect(fs.readdirSync(ctx.root).filter(name => name.startsWith('.incoming-'))).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

it('新网站启动后不健康时恢复旧网站，首次安装不健康时移除链接并停止网站', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-web-fail-'));
  const { ctx, actions } = world(path.join(dir, 'site'));
  const old = release(path.join(dir, 'old'), 'a');
  const next = release(path.join(dir, 'next'), 'b');
  try {
    await installWebsite(ctx, path.join(dir, 'old'), old.tag);
    ctx.healthy = async commit => commit === old.commit;
    await expect(installWebsite(ctx, path.join(dir, 'next'), next.tag)).rejects.toThrow('健康检查');
    expect(websiteLink(ctx.root, 'current')).toBe(`releases/${old.commit}`);
    expect(actions).toEqual(['restart', 'restart', 'restart']);
    const fresh = world(path.join(dir, 'fresh'));
    fresh.ctx.healthy = async () => false;
    await expect(installWebsite(fresh.ctx, path.join(dir, 'next'), next.tag)).rejects.toThrow('健康检查');
    expect(websiteLink(fresh.ctx.root, 'current')).toBeNull();
    expect(fresh.actions).toEqual(['restart', 'stop']);
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

it('拒绝缺项、重复、越界与错误清单，且没有上一版时明确拒绝回滚', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-web-invalid-'));
  try {
    release(dir, 'c');
    const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8');
    for (const text of ['', sums.split('\n')[0] + '\n', sums.replace('manifest.json', 'web.cjs'), sums.replace('web.cjs', '../web.cjs')]) {
      fs.writeFileSync(path.join(dir, 'SHA256SUMS'), text);
      expect(() => verifyWebsiteFiles(dir)).toThrow();
    }
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ service: 'game', commit: 'bad' }));
    expect(() => websiteCommit(path.join(dir, 'manifest.json'))).toThrow();
    fs.symlinkSync('/outside/site', path.join(dir, 'previous'));
    expect(() => websiteLink(dir, 'previous')).toThrow();
    await expect(rollbackWebsite(world(path.join(dir, 'missing')).ctx)).rejects.toThrow('没有');
  } finally {
    fs.rmSync(dir, { recursive: true });
  }
});

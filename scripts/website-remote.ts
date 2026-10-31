/** 官网部署的服务器入口；由 root 所有的白名单包装器加锁调用，网站程序以独立身份运行。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { installWebsite, rollbackWebsite, type WebsiteDeployment } from './website-deploy';
import { installWebsiteDownloads } from './website-downloads';

const ROOT = '/opt/www/yi.lightking.com.cn';
const WAIT_MS = 1000;
const ARG_COUNT = 5;
const UPLOAD_MAX_BYTES = 8388608;
const [command, tag, source] = process.argv.slice(2);
const uploader = process.env.SUDO_USER;
if (uploader && uploader !== 'deploy') throw new Error('仅允许部署用户调用');
/** 上传内容按部署用户权限读取，不能借助 root 读取其无权读取的文件。 */
function uploaded(source: string): string {
  const real = fs.realpathSync(source);
  if (uploader && (path.dirname(real) !== '/home/deploy/incoming' || !path.basename(real).startsWith('run.'))) throw new Error('上传目录不合法');
  return real;
}
const ctx: WebsiteDeployment = {
  root: ROOT,
  copy: (from, to) => {
    if (uploader) fs.writeFileSync(to, execFileSync('runuser', ['-u', uploader, '--', 'cat', from], { maxBuffer: UPLOAD_MAX_BYTES }));
    else fs.copyFileSync(from, to);
  },
  service: action => {
    execFileSync('systemctl', [action, 'yi-web']);
  },
  healthy: async commit => {
    try {
      const response = await fetch('http://127.0.0.1:8444/healthz', { signal: AbortSignal.timeout(WAIT_MS) });
      const body: unknown = await response.json();
      return response.ok && !!body && typeof body === 'object' && 'service' in body && body.service === 'yi-web' && 'commit' in body && body.commit === commit;
    } catch {
      return false;
    }
  },
  wait: () => new Promise(resolve => setTimeout(resolve, WAIT_MS)),
  now: () => new Date().toISOString(),
};
if (command === 'install' && tag && /^web-[a-f0-9]{12}$/.test(tag) && source && process.argv.length === ARG_COUNT) {
  void installWebsite(ctx, uploaded(source), tag).catch(err => {
    process.stderr.write(String(err) + '\n');
    process.exitCode = 1;
  });
} else if (command === 'downloads' && tag && source && process.argv.length === ARG_COUNT) {
  const real = uploaded(source);
  const stage = fs.mkdtempSync(path.join(ROOT, '.sums-'));
  const sums = path.join(stage, 'SHA256SUMS');
  ctx.copy(path.join(real, 'SHA256SUMS'), sums);
  installWebsiteDownloads({
    root: ROOT,
    version: tag,
    sums: fs.readFileSync(sums, 'utf8'),
    fetch: (file, target) => {
      const cached = path.join('/opt/yi/releases', tag, 'download', file);
      if (fs.existsSync(cached)) fs.copyFileSync(cached, target);
      else
        execFileSync(
          'curl',
          [
            '--fail',
            '--location',
            '--connect-timeout',
            '10',
            '--max-time',
            '600',
            '-o',
            target,
            `https://github.com/LightKing2007/yi/releases/download/v${tag}/${file}`,
          ],
          { stdio: 'inherit' },
        );
    },
  });
} else if (command === 'rollback' && !tag) {
  void rollbackWebsite(ctx).catch(err => {
    process.stderr.write(String(err) + '\n');
    process.exitCode = 1;
  });
} else throw new Error('只接受 install 网站标签 上传目录，或 rollback');

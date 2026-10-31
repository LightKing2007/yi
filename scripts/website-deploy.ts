/** 官网版本目录、校验与回滚；不执行网站代码、不访问游戏数据库，也不重启联机服务。 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const DIRECTORY_MODE = 0o755;
const FILE_MODE = 0o644;

const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const CACHE_ID_LENGTH = 12;
const FILES = ['web.cjs', 'manifest.json'];
const HEALTH_POLLS = 30;

/** 部署的系统边界；等待、时间和服务操作均可在测试中替换。 */
export interface WebsiteDeployment {
  root: string;
  copy: (source: string, target: string) => void;
  service: (action: 'restart' | 'stop') => void;
  healthy: (commit: string) => Promise<boolean>;
  wait: () => Promise<void>;
  now: () => string;
}

/** 读取已校验的官网清单；只接受完整提交号，不把清单字段当作命令执行。 */
export function websiteCommit(file: string): string {
  const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || !('service' in data) || data.service !== 'yi-web' || !('commit' in data)) throw new Error('官网清单类型无效');
  if (typeof data.commit !== 'string' || !COMMIT.test(data.commit)) throw new Error('官网提交号无效');
  return data.commit;
}

/** 校验固定文件清单；拒绝路径、重复条目、缺项或内容不符。 */
export function verifyWebsiteFiles(dir: string, files = FILES): void {
  const sums = fs.readFileSync(path.join(dir, 'SHA256SUMS'), 'utf8').trim().split('\n');
  if (sums.length !== files.length) throw new Error('校验清单项数不符');
  const seen = new Set<string>();
  for (const line of sums) {
    const [hash, file, extra] = line.trim().split(/\s+/);
    if (!hash || !HASH.test(hash) || !file || !files.includes(file) || seen.has(file) || extra) throw new Error('校验清单文件名或格式无效');
    seen.add(file);
    const content = fs.readFileSync(path.join(dir, file));
    if (createHash('sha256').update(content).digest('hex') !== hash) throw new Error(`校验不符：${file}`);
  }
}

/** 读取站内版本链接；不接受指向站点目录以外的链接。 */
export function websiteLink(root: string, name: string): string | null {
  const file = path.join(root, name);
  let target: string;
  try {
    target = fs.readlinkSync(file);
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ENOENT') return null;
    throw err;
  }
  const resolved = path.resolve(root, target);
  if (!resolved.startsWith(path.join(root, 'releases') + path.sep)) throw new Error('官网版本链接越界');
  return target;
}

/** 在同一文件系统内原子替换站内链接，避免请求读到半完成目录。 */
export function switchWebsiteLink(root: string, name: string, target: string): void {
  const temp = path.join(root, `.${name}-${process.pid}`);
  fs.symlinkSync(target, temp);
  fs.renameSync(temp, path.join(root, name));
}

/** 为新版本等待有界次数的健康检查；等待边界由运行入口提供。 */
async function healthyWebsite(ctx: WebsiteDeployment, commit: string): Promise<void> {
  for (let attempt = 0; attempt < HEALTH_POLLS; attempt++) {
    if (await ctx.healthy(commit)) return;
    await ctx.wait();
  }
  throw new Error('官网健康检查失败');
}

/** 记录网站独立的部署结果，不包含邮箱、请求地址或游戏数据。 */
function record(ctx: WebsiteDeployment, commit: string, result: string) {
  fs.appendFileSync(path.join(ctx.root, 'deploy.log'), JSON.stringify({ ts: ctx.now(), commit, result }) + '\n');
}

/** 切换并重启官网；新版本不可用时恢复原链接和原进程，首次安装失败则停止官网。 */
async function activateWebsite(ctx: WebsiteDeployment, target: string, commit: string) {
  const old = websiteLink(ctx.root, 'current');
  const previous = websiteLink(ctx.root, 'previous');
  switchWebsiteLink(ctx.root, 'current', target);
  try {
    ctx.service('restart');
    await healthyWebsite(ctx, commit);
  } catch (err) {
    if (old) {
      switchWebsiteLink(ctx.root, 'current', old);
      ctx.service('restart');
      await healthyWebsite(ctx, websiteCommit(path.join(ctx.root, old, 'manifest.json')));
    } else {
      fs.unlinkSync(path.join(ctx.root, 'current'));
      ctx.service('stop');
    }
    record(ctx, commit, 'rolled-back');
    throw err;
  }
  if (old && old !== target) switchWebsiteLink(ctx.root, 'previous', old);
  else if (previous) switchWebsiteLink(ctx.root, 'previous', previous);
  record(ctx, commit, 'ok');
}

/** 先复制并核对发布产物，再安装不可变版本目录；未通过校验时不触碰正在运行的版本。 */
export async function installWebsite(ctx: WebsiteDeployment, source: string, tag: string): Promise<string> {
  fs.mkdirSync(path.join(ctx.root, 'releases'), { recursive: true });
  const stage = fs.mkdtempSync(path.join(ctx.root, '.incoming-'));
  try {
    fs.chmodSync(path.join(ctx.root, 'releases'), DIRECTORY_MODE);
    for (const name of [...FILES, 'SHA256SUMS']) ctx.copy(path.join(source, name), path.join(stage, name));
    verifyWebsiteFiles(stage);
    const commit = websiteCommit(path.join(stage, 'manifest.json'));
    if (tag !== `web-${commit.slice(0, CACHE_ID_LENGTH)}`) throw new Error('官网标签与提交号不符');
    const target = path.join('releases', commit);
    const destination = path.join(ctx.root, target);
    if (fs.existsSync(destination)) {
      verifyWebsiteFiles(destination);
      if (fs.readFileSync(path.join(destination, 'SHA256SUMS'), 'utf8') !== fs.readFileSync(path.join(stage, 'SHA256SUMS'), 'utf8'))
        throw new Error('同一官网提交不能替换产物');
    } else {
      for (const file of [...FILES, 'SHA256SUMS']) fs.chmodSync(path.join(stage, file), FILE_MODE);
      fs.chmodSync(stage, DIRECTORY_MODE);
      fs.renameSync(stage, destination);
    }
    await activateWebsite(ctx, target, commit);
    return commit;
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/** 只回滚官网；核对旧产物后重启独立网站服务，游戏目录和数据库不在操作范围内。 */
export async function rollbackWebsite(ctx: WebsiteDeployment): Promise<void> {
  const target = websiteLink(ctx.root, 'previous');
  if (!target) throw new Error('没有可回滚的官网版本');
  verifyWebsiteFiles(path.join(ctx.root, target));
  await activateWebsite(ctx, target, websiteCommit(path.join(ctx.root, target, 'manifest.json')));
}

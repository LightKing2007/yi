/** 独立官网的部署命令；只接受已发布的官网或游戏 Release，配置安装和路由切换单独执行。 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPOSITORY = 'LightKing2007/yi';
const HOST = 'yi.lightking.com.cn';
const [command, version] = process.argv.slice(2);
if (process.argv.length > 4) throw new Error('参数过多');
const options = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=10'];
if (process.env.YI_WEB_HOST_KEY_ALIAS) options.push('-o', `HostKeyAlias=${process.env.YI_WEB_HOST_KEY_ALIAS}`);
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const run = (file, args) => execFileSync(file, args, { stdio: 'inherit' });
const ssh = (user, code) => run('ssh', [...options, `${user}@${HOST}`, code]);

/** 上传到身份所有的独立暂存目录；本机不创建全局缓存。 */
function upload(user, files) {
  const base = user === 'root' ? '/opt/www/yi.lightking.com.cn' : '/home/deploy/incoming';
  const code = `mkdir -p ${quote(base)} && mktemp -d ${quote(base + '/run.XXXXXX')}`;
  const dir = execFileSync('ssh', [...options, `${user}@${HOST}`, code], { encoding: 'utf8' }).trim();
  if (!dir.startsWith(base + '/run.') || dir.includes('\n')) throw new Error('服务器暂存目录无效');
  run('scp', [...options, ...files, `${user}@${HOST}:${dir}/`]);
  return dir;
}

/** 下载前拒绝草稿；网站的标签空间独立于游戏版本。 */
function release(tag, files) {
  const metadata = JSON.parse(execFileSync('gh', ['release', 'view', tag, '--repo', REPOSITORY, '--json', 'isDraft,tagName'], { encoding: 'utf8' }));
  if (metadata.isDraft || metadata.tagName !== tag) throw new Error('只接受已发布且标签匹配的 Release');
  const dir = path.resolve('.cache/website/releases', tag);
  fs.mkdirSync(dir, { recursive: true });
  run('gh', ['release', 'download', tag, '--repo', REPOSITORY, '--dir', dir, '--clobber', ...files.flatMap(file => ['--pattern', file])]);
  return files.map(file => path.join(dir, file));
}

if (command === 'bootstrap' && !version) {
  run('npm', ['run', 'build:website']);
  const dir = upload('root', [
    'dist-website/deploy.cjs',
    ...['yi-web.service', 'yi-web-deploy.sh', 'sudoers-yi-web', 'website-bootstrap.sh'].map(file => `scripts/server/${file}`),
  ]);
  ssh('root', `sh ${quote(dir + '/website-bootstrap.sh')} ${quote(dir)}`);
} else if (command === 'activate' && !version) {
  const dir = upload('root', ['scripts/server/website-activate.sh', 'scripts/server/yi.caddy']);
  ssh('root', `sh ${quote(dir + '/website-activate.sh')} ${quote(dir)}`);
} else if (command === 'install' && /^web-[a-f0-9]{12}$/.test(version ?? '')) {
  const dir = upload('deploy', release(version, ['web.cjs', 'manifest.json', 'SHA256SUMS']));
  ssh('deploy', `sudo -n /usr/local/sbin/yi-web-deploy install ${quote(version)} ${quote(dir)}`);
} else if (command === 'downloads' && /^\d+\.\d+\.\d+$/.test(version ?? '')) {
  const dir = upload('deploy', release(`v${version}`, ['SHA256SUMS']));
  ssh('deploy', `sudo -n /usr/local/sbin/yi-web-deploy downloads ${quote(version)} ${quote(dir)}`);
} else if (command === 'rollback' && !version) {
  ssh('deploy', 'sudo -n /usr/local/sbin/yi-web-deploy rollback');
} else if (command === 'status' && !version) {
  ssh('deploy', 'readlink /opt/www/yi.lightking.com.cn/current; curl --fail --silent http://127.0.0.1:8444/healthz');
} else throw new Error('用法：deploy:website -- bootstrap|activate|install web-提交号|downloads 游戏版本|rollback|status');

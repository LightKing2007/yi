/** 安装异地加密备份（deploy-remote.sh 的 offsite 与 deploy.sh 的 install-offsite，P1-13）；模拟的服务器见 tests/fakeServer.ts */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCRIPT, at, calls, deployLog, read, run, setupServer, teardownServer, write } from './fakeServer';

const SERVER_DIR = path.resolve(__dirname, '../scripts/server');
const ENV = 'YI_OSS_BUCKET=yi-backup-test\nYI_OSS_ACCESS_KEY_SECRET=secret\n';

/** 传到服务器的文件：程序、两个单元文件，以及（env 给定时）配置；返回脚本的路径 */
function upload(env?: string) {
  write(at('incoming/offsite.cjs'), '// offsite');
  for (const name of ['yi-offsite.service', 'yi-backup.service']) fs.copyFileSync(path.join(SERVER_DIR, name), at('incoming', name));
  if (env !== undefined) write(at('incoming/offsite.env'), env);
  fs.copyFileSync(SCRIPT, at('incoming/deploy-remote.sh'));
  return at('incoming/deploy-remote.sh');
}

beforeEach(() => {
  setupServer();
  fs.mkdirSync(at('opt'));
});
afterEach(teardownServer);

describe('服务器端（offsite）', () => {
  it('安装程序、单元文件与配置（root:yi、640），daemon-reload 后立即上传一次，记入部署日志', () => {
    const result = run(['offsite'], upload(ENV));
    expect(result).toMatchObject({ code: 0 });
    expect(read(at('etc-yi/offsite.env'))).toBe(ENV);
    expect(fs.statSync(at('etc-yi/offsite.env')).mode & 0o777).toBe(0o640);
    expect(fs.statSync(at('etc-yi')).mode & 0o777).toBe(0o750);
    expect(read(at('opt/offsite.cjs'))).toBe('// offsite');
    expect(read(at('systemd/yi-backup.service'))).toContain('OnSuccess=yi-offsite.service');
    expect(read(at('systemd/yi-offsite.service'))).toContain('ExecStart=/opt/node/bin/node /opt/yi/offsite.cjs upload');
    expect(
      calls()
        .filter(line => /^(chown|systemctl|flock)/.test(line))
        .map(line => line.replace(base(), '')),
    ).toEqual([
      'flock -n -E 75 /lock',
      'chown root:yi /etc-yi',
      'chown root:yi /etc-yi/offsite.env.new',
      'systemctl daemon-reload',
      'systemctl start yi-offsite.service',
    ]);
    expect(deployLog()).toEqual(['tester config P1-13 install-offsite ok']);
  });

  it('没有传配置时保留已有的配置；从未配置过时中止', () => {
    let result = run(['offsite'], upload());
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('首次安装须填写');
    expect(calls().some(line => line.startsWith('systemctl'))).toBe(false);
    write(at('etc-yi/offsite.env'), 'OLD=1\n');
    result = run(['offsite'], upload());
    expect(result).toMatchObject({ code: 0 });
    expect(read(at('etc-yi/offsite.env'))).toBe('OLD=1\n');
  });

  it('首次上传失败时报告，部署日志记为 fail', () => {
    write(at('sim/start-fails'), '');
    const result = run(['offsite'], upload(ENV));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('首次上传失败');
    expect(deployLog()).toEqual(['tester config P1-13 install-offsite fail']);
  });
});

describe('本机（install-offsite）', () => {
  const DEPLOY = path.resolve(__dirname, '../scripts/deploy.sh');
  it('逐项询问配置并传到服务器；配置不留在本机的临时目录中', () => {
    const answers = ['yi-backup-test', 'cn-hangzhou', 'LTAItestkey0001', 'secretsecretsecret01', 'age1abc'].join('\n') + '\n';
    const bundle = path.resolve(__dirname, '../dist-server/offsite.cjs');
    fs.rmSync(bundle, { force: true }); // 须由 install-offsite 当场打包
    const result = run(['install-offsite'], DEPLOY, answers);
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).toContain('AccessKey Secret（输入时不显示）');
    expect(read(at('etc-yi/offsite.env')).split('\n')).toEqual([
      'YI_OSS_BUCKET=yi-backup-test',
      'YI_OSS_REGION=cn-hangzhou',
      'YI_OSS_ACCESS_KEY_ID=LTAItestkey0001',
      'YI_OSS_ACCESS_KEY_SECRET=secretsecretsecret01',
      'YI_AGE_RECIPIENT=age1abc',
      '',
    ]);
    expect(read(at('opt/offsite.cjs'))).toContain('aliyun_v4_request');
    expect(read(at('opt/offsite.cjs'))).toBe(read(bundle));
    expect(fs.readdirSync(at('opt/.incoming'))).toEqual([]);
  }, 60_000);

  it('--keep-config 时不询问，只更新程序与单元文件', () => {
    write(at('etc-yi/offsite.env'), 'OLD=1\n');
    const result = run(['install-offsite', '--keep-config'], DEPLOY);
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).not.toContain('存储桶名称');
    expect(read(at('etc-yi/offsite.env'))).toBe('OLD=1\n');
  }, 60_000);
});

/** 模拟的服务器所在的临时目录（calls 中的路径去掉它后便于比较） */
function base() {
  return at('');
}

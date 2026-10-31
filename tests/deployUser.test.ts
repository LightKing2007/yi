/** 部署用户 deploy 与 sudo 白名单（SEC-044，整改项 P2-14）：建立用户、只经 root 所有的 yi-deploy 上线、上传文件的收取；模拟的服务器见 tests/fakeServer.ts */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCRIPT, at, attachments, calls, deployLog, layout, link, read, run, setupServer, teardownServer, write } from './fakeServer';

const SUDOERS = path.resolve(__dirname, '../scripts/server/sudoers-yi-deploy');
const DEPLOY = path.resolve(__dirname, '../scripts/deploy.sh');
const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample lightking@example';
/** 部署用户经 sudo 执行时的环境（sudo 设置 SUDO_USER） */
const AS_DEPLOY = { SUDO_USER: 'deploy' };

beforeEach(setupServer);
afterEach(teardownServer);

/** 以 root 执行 deploy-user：脚本与白名单放在传上来的目录中 */
function installUser(sudoers = read(SUDOERS)) {
  write(at('up/sudoers-yi-deploy'), sudoers);
  fs.copyFileSync(SCRIPT, at('up/deploy-remote.sh'));
  return run(['deploy-user'], at('up/deploy-remote.sh'));
}

/** 部署用户上传的目录：Release 的附件，外加 extra 中的文件 */
function upload(version: string, extra: Record<string, string> = {}) {
  const dir = at('sim/home/incoming/run.abc123');
  attachments(version, dir);
  for (const [name, text] of Object.entries(extra)) write(path.join(dir, name), text);
  return dir;
}

describe('sudo 白名单（scripts/server/sudoers-yi-deploy）', () => {
  it('只允许 deploy 以 root 执行 /usr/local/sbin/yi-deploy，只放行 YI_OPERATOR', () => {
    const rules = read(SUDOERS)
      .split('\n')
      .filter(line => line && !line.startsWith('#'));
    expect(rules).toEqual(['Defaults!/usr/local/sbin/yi-deploy env_keep += "YI_OPERATOR"', 'deploy ALL=(root) NOPASSWD: /usr/local/sbin/yi-deploy']);
  });
  it.runIf(spawnSync('sh', ['-c', 'command -v visudo']).status === 0)('visudo 校验语法通过', () => {
    expect(spawnSync('visudo', ['-c', '-q', '-f', SUDOERS]).status).toBe(0);
  });
});

describe('建立部署用户（deploy-user，以 root 执行）', () => {
  beforeEach(() => write(at('root-keys'), `ssh-rsa AAAAB3Nza old@example\n${KEY}\n`));

  it('建用户、加入 systemd-journal 组、只放入 Ed25519 公钥；安装 yi-deploy 与校验过的白名单，记入部署日志', () => {
    expect(installUser()).toMatchObject({ code: 0 });
    expect(calls()).toEqual(expect.arrayContaining(['useradd --create-home --shell /bin/bash deploy', 'usermod -a -G systemd-journal deploy']));
    expect(read(at('sim/home/.ssh/authorized_keys'))).toBe(`${KEY}\n`);
    expect(fs.statSync(at('sim/home/.ssh/authorized_keys')).mode & 0o777).toBe(0o600);
    expect(fs.statSync(at('sim/home/incoming')).mode & 0o777).toBe(0o700);
    expect(read(at('sbin/yi-deploy'))).toBe(read(SCRIPT));
    expect(fs.statSync(at('sbin/yi-deploy')).mode & 0o777).toBe(0o755);
    expect(read(at('sudoers.d/yi-deploy'))).toBe(read(SUDOERS));
    expect(fs.statSync(at('sudoers.d/yi-deploy')).mode & 0o777).toBe(0o440);
    expect(deployLog()).toEqual(['tester config P2-14 install-deploy-user ok']);
  });

  it('再次执行时不重建用户，只更新文件', () => {
    installUser();
    expect(installUser()).toMatchObject({ code: 0 });
    expect(calls().filter(line => line.startsWith('useradd'))).toHaveLength(1);
  });

  it('白名单校验不通过时不安装白名单，记为失败', () => {
    write(at('sim/visudo-fails'), '');
    const result = installUser();
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('sudo 白名单校验不通过');
    expect(fs.readdirSync(at('sudoers.d'))).toEqual([]);
    expect(deployLog()).toEqual(['tester config P2-14 install-deploy-user fail']);
  });

  it('root 没有 Ed25519 公钥时什么也不做', () => {
    write(at('root-keys'), 'ssh-rsa AAAAB3Nza old@example\n');
    expect(installUser().out).toContain('没有 Ed25519 公钥');
    expect(calls().some(line => line.startsWith('useradd'))).toBe(false);
    expect(fs.existsSync(at('sbin/yi-deploy'))).toBe(false);
  });
});

describe('部署用户经 sudo 执行 yi-deploy', () => {
  beforeEach(() => layout('2.0.4'));

  it('只允许 preflight、install、restart、rollback、status；安装配置的命令须以 root 执行', () => {
    for (const cmd of ['service', 'caddy', 'offsite', 'watch', 'deploy-user']) {
      const result = run([cmd], SCRIPT, '', AS_DEPLOY);
      expect([cmd, result.code]).not.toEqual([cmd, 0]);
      expect(result.out).toContain(`部署用户不能执行 ${cmd}`);
    }
    expect(run(['status'], SCRIPT, '', AS_DEPLOY)).toMatchObject({ code: 0 });
  });

  it('上线须以 --from 指定上传目录，不用与脚本同目录的文件', () => {
    const result = run(['install', '2.0.5'], SCRIPT, '', AS_DEPLOY);
    expect(result.out).toContain('须以 --from= 指定上传目录');
    expect(link('current')).toBe('releases/2.0.4');
  });

  it('以部署用户的身份读出上传的文件，只取服务端与 SHA256SUMS，上线后删除上传目录', () => {
    const dir = upload('2.0.5', { 'notes.txt': 'x' });
    expect(run(['install', '2.0.5', `--from=${dir}`], SCRIPT, '', AS_DEPLOY)).toMatchObject({ code: 0 });
    expect([link('current'), read(at('sim/running'))]).toEqual(['releases/2.0.5', '2.0.5 c205']);
    expect(calls().filter(line => line.startsWith('runuser'))).toEqual([
      'runuser deploy ls run.abc123',
      'runuser deploy cat SHA256SUMS',
      'runuser deploy cat yi-server-2.0.5.cjs',
      'runuser deploy rm run.abc123',
    ]);
    expect(fs.existsSync(dir)).toBe(false);
    expect(fs.readdirSync(at('opt/.incoming'))).toEqual([]);
    expect(fs.readdirSync(at('opt/releases/2.0.5')).sort()).toEqual(['env', 'server.cjs']);
    expect(fs.existsSync(at('opt/releases/2.0.5/download'))).toBe(false);
  });

  it('上传目录不在部署用户的 incoming/ 下、或名称含路径时拒绝', () => {
    upload('2.0.5');
    const cases = [
      [at('elsewhere/run.abc'), '上传目录须在'],
      ['run.abc123', '上传目录须在'], // 相对路径
      [at('sim/home/incoming/other'), '上传目录须在'],
      [`${at('sim/home/incoming')}/run.abc123/../run.abc123`, '上传目录的名称不合规'],
    ];
    for (const [from, reason] of cases) {
      const result = run(['install', '2.0.5', `--from=${from}`], SCRIPT, '', AS_DEPLOY);
      expect([from, result.code, result.out.includes(reason ?? '')]).toEqual([from, 1, true]);
    }
    expect(link('current')).toBe('releases/2.0.4');
  });

  it('以 root 执行时不接受 --from', () => {
    const result = run(['install', '2.0.5', `--from=${upload('2.0.5')}`]);
    expect(result.out).toContain('--from= 只用于部署用户经 sudo 上线');
    expect(link('current')).toBe('releases/2.0.4');
  });

  it('部署日志中的操作者：放行的 YI_OPERATOR 同样过滤；没有时记为发起 sudo 的用户', () => {
    run(['install', '2.0.5', `--from=${upload('2.0.5')}`], SCRIPT, '', { ...AS_DEPLOY, YI_OPERATOR: "x'; rm" });
    run(['rollback'], SCRIPT, '', { ...AS_DEPLOY, YI_OPERATOR: '' });
    expect(deployLog()).toEqual(['x___rm deploy 2.0.5 ok', 'deploy rollback 2.0.4 ok']);
  });
});

describe('本机脚本以部署用户上线（scripts/deploy.sh）', () => {
  const AS_USER = { YI_DEPLOY_SSH: 'deploy@test' };
  beforeEach(() => {
    layout('2.0.4', '2.0.3');
    attachments('2.0.5', at('sim/release'));
    fs.copyFileSync(SCRIPT, at('sbin/yi-deploy'));
    fs.chmodSync(at('sbin/yi-deploy'), 0o755);
  });

  it('文件传到部署用户的上传目录，经 sudo 执行 yi-deploy 上线', () => {
    expect(run(['2.0.5', '--restart'], DEPLOY, '', AS_USER)).toMatchObject({ code: 0 });
    expect([link('current'), read(at('sim/running'))]).toEqual(['releases/2.0.5', '2.0.5 c205']);
    expect(
      calls()
        .filter(line => line.startsWith('sudo'))
        .map(line => line.split(' ')[2]),
    ).toEqual(['preflight', 'install']);
    expect(fs.readdirSync(at('sim/home/incoming'))).toEqual([]);
    expect(deployLog()).toEqual(['tester deploy 2.0.5 ok']);
  });

  it('status、restart、rollback 同样经 sudo 执行', () => {
    for (const cmd of ['status', 'restart', 'rollback']) expect([cmd, run([cmd], DEPLOY, '', AS_USER).code]).toEqual([cmd, 0]);
    expect(
      calls()
        .filter(line => line.startsWith('sudo'))
        .map(line => line.split(' ')[2]),
    ).toEqual(['status', 'restart', 'rollback']);
  });

  it('服务器上的 yi-deploy 与本机的 deploy-remote.sh 不一致时，在上传前中止', () => {
    write(at('sbin/yi-deploy'), '#!/bin/sh\necho old\n');
    const result = run(['2.0.5', '--restart'], DEPLOY, '', AS_USER);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('install-deploy-user');
    expect(calls().some(line => line.startsWith('scp') || line.startsWith('sudo'))).toBe(false);
    expect(link('current')).toBe('releases/2.0.4');
  });
});

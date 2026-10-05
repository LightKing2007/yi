/** 安装 yi.service（scripts/server/deploy-remote.sh 的 service，SEC-045）；模拟的服务器见 tests/fakeServer.ts */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCRIPT, at, calls, deployLog, layout, read, run, setupServer, teardownServer, write } from './fakeServer';

const OLD = '[Service]\nExecStart=/opt/node/bin/node /opt/yi/current/server.cjs 8443\n';
const REPO_UNIT = path.resolve(__dirname, '../scripts/server/yi.service');

/** 传到服务器的文件：deploy-remote.sh 与 yi.service（内容为 unit），返回脚本的路径 */
function upload(unit: string) {
  write(at('incoming/yi.service'), unit);
  fs.copyFileSync(SCRIPT, at('incoming/deploy-remote.sh'));
  return at('incoming/deploy-remote.sh');
}

beforeEach(() => {
  setupServer();
  layout('2.0.5');
  write(at('yi.service'), OLD);
  write(at('sim/score'), '1.3');
});
afterEach(teardownServer);

describe('安装 yi.service（SEC-045）', () => {
  it('评分不高于 4.0 时安装：备份原文件，daemon-reload 后重启，健康检查通过，记入部署日志', () => {
    const unit = read(REPO_UNIT);
    const result = run(['service'], upload(unit));
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).toContain('评分：1.3（上限 4.0）');
    expect([read(at('yi.service')), read(at('opt/yi.service.prev'))]).toEqual([unit, OLD]);
    expect(
      calls()
        .filter(line => line.startsWith('systemctl') || line.startsWith('flock'))
        .map(line => line.split(' ').slice(0, 2).join(' ')),
    ).toEqual(['flock -n', 'systemctl daemon-reload', 'systemctl restart']);
    expect(deployLog()).toEqual(['tester config P1-11 install-service ok']);
  });

  it('有对局时先进入维护模式，等对局结束再重启', () => {
    write(at('sim/games'), '1');
    write(at('sim/drain'), '');
    expect(run(['service'], upload(read(REPO_UNIT)))).toMatchObject({ code: 0 });
    const seq = calls().filter(line => line.startsWith('systemctl'));
    expect(seq).toEqual(['systemctl daemon-reload', 'systemctl kill -s SIGUSR2 yi', 'systemctl restart yi']);
  });

  it('评分高于 4.0 或校验不通过时不安装', () => {
    write(at('sim/score'), '4.1');
    let result = run(['service'], upload(read(REPO_UNIT)));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('评分 4.1 高于 4.0（SEC-045），未安装');
    write(at('sim/score'), '4.0');
    write(at('sim/verify-fails'), '');
    result = run(['service'], upload(read(REPO_UNIT)));
    expect(result.out).toContain('校验不通过');
    expect([read(at('yi.service')), calls().some(line => line.startsWith('systemctl'))]).toEqual([OLD, false]);
  });

  it('评分恰为 4.0 时安装', () => {
    write(at('sim/score'), '4.0');
    expect(run(['service'], upload(read(REPO_UNIT)))).toMatchObject({ code: 0 });
  });

  it('装上后服务起不来：恢复原来的文件并再次重启，部署日志记为 restored', () => {
    const result = run(['service'], upload(read(REPO_UNIT) + '# BREAK\n'));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('已恢复原来的 yi.service');
    expect([read(at('yi.service')), read(at('sim/running'))]).toEqual([OLD, '2.0.5 c205']);
    expect(calls().filter(line => line === 'systemctl restart yi')).toHaveLength(2);
    expect(deployLog()).toEqual(['tester config P1-11 install-service restored']);
  });
});

describe('仓库中的 yi.service', () => {
  it('含 SEC-045 要求的全部选项，且仍经 /opt/yi/current 读取服务端、安装程序与 YI_LATEST', () => {
    const lines = read(REPO_UNIT).split('\n');
    const required = [
      'PrivateDevices=yes',
      'ProtectKernelTunables=yes',
      'ProtectKernelModules=yes',
      'ProtectKernelLogs=yes',
      'ProtectControlGroups=yes',
      'ProtectClock=yes',
      'ProtectHostname=yes',
      'RestrictNamespaces=yes',
      'RestrictRealtime=yes',
      'RestrictSUIDSGID=yes',
      'LockPersonality=yes',
      'MemoryDenyWriteExecute=no',
      'RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX',
      'CapabilityBoundingSet=',
      'SystemCallFilter=@system-service',
      'SystemCallArchitectures=native',
      'UMask=0077',
      'MemoryMax=512M',
      'TasksMax=64',
      'LimitNOFILE=65536',
      'ExecStart=/opt/node/bin/node /opt/yi/current/server.cjs 8443',
      'EnvironmentFile=/opt/yi/current/env',
      'Environment=YI_FILES=/opt/yi/current/download',
      'ReadWritePaths=/var/lib/yi',
    ];
    expect(required.filter(line => !lines.includes(line))).toEqual([]);
    expect(lines.filter(line => line.startsWith('Environment=YI_LATEST'))).toEqual([]);
  });
});

describe('本机脚本（scripts/deploy.sh）', () => {
  it('install-service 把仓库中的 yi.service 传到服务器端安装', () => {
    expect(run(['install-service'], path.resolve(__dirname, '../scripts/deploy.sh'))).toMatchObject({ code: 0 });
    expect(read(at('yi.service'))).toBe(read(REPO_UNIT));
    expect(deployLog()).toEqual(['tester config P1-11 install-service ok']);
  });
});

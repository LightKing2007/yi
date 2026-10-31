/** 上线在服务器上的部分（scripts/server/deploy-remote.sh，OPS-041 至 OPS-048）；模拟的服务器见 tests/fakeServer.ts */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCRIPT, at, calls, deployLog, incoming, layout, link, read, run, serviceCalls, setupServer, teardownServer, write } from './fakeServer';

beforeEach(setupServer);
afterEach(teardownServer);

describe('版本号比较', () => {
  const lt = (left: string, right: string) => {
    try {
      execFileSync('sh', ['-c', `. "${SCRIPT}" && version_lt "$1" "$2"`, 'sh', left, right], { env: { ...process.env, YI_DEPLOY_LIB: '1' }, stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  };
  it('逐段按数值比较', () => {
    expect([lt('2.0.4', '2.0.5'), lt('2.0.9', '2.0.10'), lt('2.0.9', '2.1.0'), lt('2.9.9', '3.0.0')]).toEqual([true, true, true, true]);
    expect([lt('2.0.5', '2.0.4'), lt('2.0.10', '2.0.9'), lt('2.1.0', '2.0.9'), lt('3.0.0', '2.9.9'), lt('2.0.5', '2.0.5')]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});

describe('上线（install）', () => {
  it('建版本目录、切换 current 与 previous、删除更早的版本、重启后健康检查通过，记入部署日志；做完删除传上来的目录', () => {
    layout('2.0.4', '2.0.3');
    const script = incoming('2.0.5');
    const result = run(['install', '2.0.5'], script);
    expect(result).toMatchObject({ code: 0 });
    expect([link('current'), link('previous')]).toEqual(['releases/2.0.5', 'releases/2.0.4']);
    expect(fs.readdirSync(at('opt/releases')).sort()).toEqual(['2.0.4', '2.0.5']);
    expect(read(at('opt/releases/2.0.5/server.cjs'))).toBe('2.0.5 c205');
    expect(fs.readdirSync(at('opt/releases/2.0.5')).sort()).toEqual(['env', 'server.cjs']);
    expect(fs.existsSync(at('opt/releases/2.0.5/download'))).toBe(false);
    expect(read(at('opt/releases/2.0.5/env'))).toBe('YI_LATEST=2.0.5\n');
    expect(read(at('sim/running'))).toBe('2.0.5 c205');
    expect(calls()).toContain('flock -n -E 75 ' + at('lock'));
    expect(serviceCalls()).toEqual(['systemctl restart yi']);
    expect(deployLog()).toEqual(['tester deploy 2.0.5 ok']);
    expect(fs.existsSync(at('incoming'))).toBe(true); // 不在 /opt/yi/.incoming/ 下：不删
  });

  it('在 /opt/yi/.incoming/ 下执行时，做完删除所在的目录', () => {
    layout('2.0.4');
    const script = incoming('2.0.5');
    fs.mkdirSync(at('opt/.incoming'));
    fs.renameSync(at('incoming'), at('opt/.incoming/run.x'));
    expect(run(['install', '2.0.5'], at('opt/.incoming/run.x', path.basename(script)))).toMatchObject({ code: 0 });
    expect(fs.readdirSync(at('opt/.incoming'))).toEqual([]);
  });

  it('--no-restart：只切换，不重启；此后 restart 完成上线', () => {
    layout('2.0.4');
    expect(run(['install', '2.0.5', '--no-restart'], incoming('2.0.5'))).toMatchObject({ code: 0 });
    expect([link('current'), read(at('sim/running'))]).toEqual(['releases/2.0.5', '2.0.4 c204']);
    expect(run(['restart'])).toMatchObject({ code: 0 });
    expect(read(at('sim/running'))).toBe('2.0.5 c205');
    expect(deployLog()).toEqual(['tester deploy 2.0.5 installed', 'tester restart 2.0.5 ok']);
  });
});

describe('上线前的检查：加锁、版本、校验和、目录结构', () => {
  it('另一个上线过程持有锁时报告后退出，什么也不改', () => {
    layout('2.0.4');
    write(at('sim/locked'), '');
    const result = run(['install', '2.0.5'], incoming('2.0.5'));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('另一个上线过程正在进行');
    expect(link('current')).toBe('releases/2.0.4');
  });

  it('版本低于线上时须加 --allow-downgrade；与线上相同时拒绝（OPS-042）', () => {
    layout('2.0.5');
    let result = run(['install', '2.0.4'], incoming('2.0.4'));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('2.0.4 低于线上的 2.0.5，确需降级时加 --allow-downgrade');
    expect([link('current'), calls().some(line => line.startsWith('systemctl'))]).toEqual(['releases/2.0.5', false]);
    result = run(['install', '2.0.5'], incoming('2.0.5'));
    expect(result.out).toContain('线上已是 2.0.5');
    expect(run(['install', '2.0.4', '--allow-downgrade'], incoming('2.0.4'))).toMatchObject({ code: 0 });
    expect([link('current'), link('previous')]).toEqual(['releases/2.0.4', 'releases/2.0.5']);
  });

  it('传到服务器的文件与 SHA256SUMS 不符时中止，线上不变', () => {
    layout('2.0.4');
    const result = run(['install', '2.0.5'], incoming('2.0.5', true));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('与 SHA256SUMS 不符');
    expect([link('current'), fs.existsSync(at('opt/releases/2.0.5'))]).toEqual(['releases/2.0.4', false]);
  });

  it('不是版本目录的结构时中止', () => {
    write(at('opt/server.cjs'), '2.0.4 c204');
    const result = run(['install', '2.0.5'], incoming('2.0.5'));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('服务器上没有版本目录');
  });
});

describe('维护模式（OPS-045）', () => {
  it('有对局时先进入维护模式，每 10 秒查一次，对局全部结束后才重启', () => {
    layout('2.0.4');
    write(at('sim/games'), '2');
    write(at('sim/drain'), '');
    expect(run(['install', '2.0.5'], incoming('2.0.5'))).toMatchObject({ code: 0 });
    const seq = calls().filter(line => !line.startsWith('flock') && line !== 'sleep 1' && !/yi-watch/.test(line));
    expect(seq).toEqual(['systemctl kill -s SIGUSR2 yi', 'sleep 10', 'sleep 10', 'systemctl restart yi']);
  });

  it('等满 30 分钟仍有对局时强制重启', () => {
    layout('2.0.4');
    write(at('sim/games'), '1');
    const result = run(['install', '2.0.5'], incoming('2.0.5'));
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).toContain('等满 30 分钟仍有 1 局，强制重启');
    expect(calls().filter(line => line === 'sleep 10')).toHaveLength(3); // 测试中 YI_WAIT_POLLS=3
    expect(calls().indexOf('systemctl restart yi')).toBeGreaterThan(calls().lastIndexOf('sleep 10'));
  });

  it('默认至多等待 180 次、每次 10 秒，即 30 分钟', () => {
    expect(read(SCRIPT)).toContain('WAIT_STEP=10 ');
    expect(read(SCRIPT)).toContain('WAIT_POLLS=${YI_WAIT_POLLS:-180}');
  });

  it('连不上线上服务端的健康检查（服务端未在运行）时不发 SIGUSR2，直接重启', () => {
    layout('2.0.4');
    write(at('sim/nohealth-2.0.4'), '');
    write(at('sim/games'), '1');
    expect(run(['install', '2.0.5'], incoming('2.0.5'))).toMatchObject({ code: 0 });
    expect(serviceCalls()).toEqual(['systemctl restart yi']);
  });
});

describe('健康检查与自动回滚（OPS-046）', () => {
  it('默认重启后至多查 30 次健康检查、每次 1 秒，即 30 秒', () => {
    expect(read(SCRIPT)).toContain('HEALTH_POLLS=${YI_HEALTH_POLLS:-30}');
  });

  it('重启后 30 秒内健康检查不通过：回滚到上一版本，写 deploy.rolled-back 日志，部署日志记为 rolled-back', () => {
    layout('2.0.4');
    write(at('sim/broken-2.0.5'), '');
    const result = run(['install', '2.0.5'], incoming('2.0.5'));
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('已回滚到 2.0.4');
    expect([link('current'), link('previous'), read(at('sim/running'))]).toEqual(['releases/2.0.4', 'releases/2.0.5', '2.0.4 c204']);
    expect(calls().filter(line => line === 'sleep 1').length).toBeGreaterThanOrEqual(3); // 测试中 YI_HEALTH_POLLS=3
    expect(calls()).toContain('systemd-cat -t yi-deploy -p err');
    expect(JSON.parse(read(at('sim/journal')))).toMatchObject({ level: 'error', event: 'deploy.rolled-back', version: '2.0.5', target: '2.0.4' });
    expect(deployLog()).toEqual(['tester deploy 2.0.5 rolled-back']);
  });

  it('健康检查返回的提交号与目标版本不符时同样回滚', () => {
    layout('2.0.4');
    write(at('sim/commit-override'), 'other');
    const result = run(['install', '2.0.5'], incoming('2.0.5'));
    expect(result.code).not.toBe(0);
    expect(link('current')).toBe('releases/2.0.4');
  });

  it('没有上一版本时无法回滚，部署日志记为 fail', () => {
    layout('2.0.5');
    write(at('sim/broken-2.0.5'), '');
    const result = run(['restart']);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('没有上一版本可以回滚');
    expect(deployLog()).toEqual(['tester restart 2.0.5 fail']);
  });
});

describe('回滚（OPS-044）', () => {
  it('立即换回上一版本并重启，不等待对局结束；再执行一次又换回来', () => {
    layout('2.0.5', '2.0.4');
    write(at('sim/games'), '3');
    expect(run(['rollback'])).toMatchObject({ code: 0 });
    expect([link('current'), link('previous'), read(at('sim/running'))]).toEqual(['releases/2.0.4', 'releases/2.0.5', '2.0.4 c204']);
    expect(calls().some(line => line.includes('SIGUSR2'))).toBe(false);
    expect(run(['rollback'])).toMatchObject({ code: 0 });
    expect(link('current')).toBe('releases/2.0.5');
    expect(deployLog()).toEqual(['tester rollback 2.0.4 ok', 'tester rollback 2.0.5 ok']);
  });

  it('上一版本的健康检查能连上但版本不符时，回滚记为 fail', () => {
    layout('2.0.5', '2.0.4');
    write(at('sim/commit-override'), 'other');
    const result = run(['rollback']);
    expect(result.code).not.toBe(0);
    expect(deployLog()).toEqual(['tester rollback 2.0.4 fail']);
  });

  it('没有上一版本时拒绝', () => {
    layout('2.0.5');
    const result = run(['rollback']);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('没有上一版本可以换回');
  });
});

describe('上线前检查（preflight）', () => {
  it('打出线上版本、对局数与连接数；磁盘空间不足时中止', () => {
    layout('2.0.4');
    write(at('sim/games'), '2');
    const result = run(['preflight', '2.0.5', '1']);
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).toContain('线上 2.0.4（c204）：2 局正在进行');
    expect(result.out).toContain('3 条连接');
    const full = run(['preflight', '2.0.5', String(1e12)]);
    expect(full.code).not.toBe(0);
    expect(full.out).toContain('磁盘空间不足');
    expect(run(['preflight', '2.0.3', '1']).out).toContain('--allow-downgrade');
  });
});

/** 上线后的检查与自动回滚（deploy-remote.sh 的 watch，OPS-047）；模拟的服务器见 tests/fakeServer.ts，时刻由 sim/now 给出 */
import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCRIPT, at, calls, deployLog, incoming, layout, link, read, run, setupServer, teardownServer, write } from './fakeServer';

const START = 1_000_000;
let now = START;
/** 过了 minutes 分钟后运行一次检查（与定时器每分钟运行一次相同），返回结果 */
function tick(minutes = 1) {
  now += minutes * 60;
  write(at('sim/now'), String(now));
  return run(['watch'], SCRIPT, '', 'watch');
}
/** 上线后的检查是否仍在进行 */
const watching = () => fs.existsSync(at('state/watch/started'));
const journal = () => (read(at('sim/journal')) ? JSON.parse(read(at('sim/journal'))) : null);

beforeEach(() => {
  setupServer();
  now = START;
  layout('2.0.6', '2.0.5');
  write(at('state/watch/started'), `${START} 2.0.6\n`);
});
afterEach(teardownServer);

describe('建立上线后的检查', () => {
  it('上线成功后建立定时器 yi-watch：每分钟以 watch 运行本脚本留在 /opt/yi 的副本，操作者记为 watch', () => {
    fs.rmSync(at('state/watch'), { recursive: true });
    fs.unlinkSync(at('opt/current'));
    fs.unlinkSync(at('opt/previous'));
    layout('2.0.5');
    expect(run(['install', '2.0.6'], incoming('2.0.6'))).toMatchObject({ code: 0 });
    const started = calls().find(line => line.startsWith('systemd-run')) ?? '';
    for (const part of ['--unit=yi-watch', '--on-active=60', '--on-unit-active=60', '--setenv=YI_OPERATOR=watch', `sh ${at('opt/deploy-remote.sh')} watch`])
      expect(started).toContain(part);
    expect(read(at('opt/deploy-remote.sh'))).toBe(read(SCRIPT));
    expect(read(at('state/watch/started'))).toBe(`${START} 2.0.6\n`);
  });

  it('上线失败而回滚时不建立；手动回滚时停止', () => {
    write(at('sim/broken-2.0.6'), '');
    fs.rmSync(at('state/watch'), { recursive: true });
    run(['restart']);
    expect(calls().some(line => line.startsWith('systemd-run'))).toBe(false);
    write(at('state/watch/started'), `${START} 2.0.5\n`);
    expect(run(['rollback'])).toMatchObject({ code: 0 });
    expect(watching()).toBe(false);
    expect(calls()).toContain('systemctl stop yi-watch.timer yi-watch.service');
  });
});

describe('检查（OPS-047）：重启次数', () => {
  it('一切正常时什么也不做', () => {
    for (let i = 0; i < 10; i++) expect(tick()).toMatchObject({ code: 0 });
    expect([link('current'), deployLog(), watching()]).toEqual(['releases/2.0.6', [], true]);
  });

  it('5 分钟内重启 3 次即回滚到上一版本，写 deploy.rolled-back 日志并停止检查', () => {
    tick();
    for (const restarts of [1, 2]) {
      write(at('sim/nrestarts'), String(restarts));
      expect(tick()).toMatchObject({ code: 0 });
    }
    write(at('sim/nrestarts'), '3');
    const result = tick();
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('上线后 5 分钟内重启 3 次');
    expect([link('current'), read(at('sim/running'))]).toEqual(['releases/2.0.5', '2.0.5 c205']);
    expect(journal()).toMatchObject({ event: 'deploy.rolled-back', version: '2.0.6', target: '2.0.5', reason: 'restarts' });
    expect(deployLog()).toEqual(['watch watch 2.0.6 rolled-back']);
    expect(watching()).toBe(false);
  });

  it('重启分散在 5 分钟以外的不累计', () => {
    tick();
    for (const restarts of [1, 2, 3, 4]) {
      write(at('sim/nrestarts'), String(restarts));
      expect(tick(3)).toMatchObject({ code: 0 });
    }
    expect(link('current')).toBe('releases/2.0.6');
  });
});

describe('检查（OPS-047）：健康检查、错误占比与结束', () => {
  it('健康检查连续 3 次失败即回滚；中间成功一次则重新计数', () => {
    write(at('sim/broken-2.0.6'), '');
    tick();
    tick();
    fs.unlinkSync(at('sim/broken-2.0.6'));
    tick();
    write(at('sim/broken-2.0.6'), '');
    expect([tick().code, tick().code, link('current')]).toEqual([0, 0, 'releases/2.0.6']);
    const result = tick();
    expect(result.out).toContain('上线后健康检查连续 3 次失败');
    expect(link('current')).toBe('releases/2.0.5');
    expect(journal()).toMatchObject({ reason: 'healthz' });
  });

  it('5 分钟内服务端内部错误占消息 ≥ 1% 即回滚；消息少于 100 条时不计；没有 /metrics 时跳过', () => {
    const errorLine = '{"level":"error","event":"internal.error","msg":"x"}\n';
    write(at('sim/yi-journal'), errorLine.repeat(5));
    tick(); // 没有 /metrics
    write(at('sim/messages'), '1000');
    tick();
    write(at('sim/messages'), '1099');
    expect(tick()).toMatchObject({ code: 0 }); // 99 条消息，不计比例
    write(at('sim/messages'), '1300');
    const noise = '{"level":"warn","event":"proto.invalid","msg":"internal"}\n'; // 其他事件不计入
    write(at('sim/yi-journal'), errorLine.repeat(2) + noise.repeat(3));
    expect(tick()).toMatchObject({ code: 0 }); // 300 条消息中 2 次，不到 1%
    write(at('sim/messages'), '1400');
    write(at('sim/yi-journal'), errorLine.repeat(4));
    const result = tick(); // 400 条消息中 4 次，达到 1%
    expect(result.out).toContain('服务端内部错误 4 次，占 400 条消息的 1% 以上');
    expect(journal()).toMatchObject({ reason: 'errors' });
    expect(
      calls()
        .filter(line => line.startsWith('journalctl -u yi'))
        .at(-1),
    ).toContain(`--since @${now - 300}`);
  });

  it('满 60 分钟或线上已换成别的版本时结束检查', () => {
    expect(tick(59)).toMatchObject({ code: 0 });
    expect(watching()).toBe(true);
    expect(tick(1).out).toContain('上线后的检查结束');
    expect(watching()).toBe(false);
    write(at('state/watch/started'), `${now} 2.0.7\n`);
    expect(tick().out).toContain('上线后的检查结束');
    expect(calls()).toContain('systemctl stop yi-watch.timer yi-watch.service');
  });

  it('另一个上线过程持有锁时跳过这一次，不报错；没有检查记录时停止定时器', () => {
    write(at('sim/locked'), '');
    expect(tick()).toEqual({ code: 0, out: '' });
    fs.unlinkSync(at('sim/locked'));
    fs.rmSync(at('state/watch'), { recursive: true });
    expect(tick()).toMatchObject({ code: 0 });
    expect(calls()).toContain('systemctl stop yi-watch.timer yi-watch.service');
  });
});

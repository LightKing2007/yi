/** 本机的上线脚本（scripts/deploy.sh）：gh、ssh、scp 换成桩程序，经模拟的服务器（tests/fakeServer.ts）走完整条流程 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { at, attachments, calls, deployLog, layout, link, read, run, setupServer, teardownServer, write } from './fakeServer';

beforeEach(setupServer);
afterEach(teardownServer);

describe('本机脚本（scripts/deploy.sh）', () => {
  const DEPLOY = path.resolve(__dirname, '../scripts/deploy.sh');
  beforeEach(() => {
    layout('2.0.4');
    attachments('2.0.5', at('sim/release'));
  });

  it('下载并核对后传到服务器，由 deploy-remote.sh 加锁上线；--restart 时不问', () => {
    const result = run(['2.0.5', '--restart'], DEPLOY);
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).toContain('线上 2.0.4（c204）：0 局正在进行');
    expect([link('current'), read(at('sim/running'))]).toEqual(['releases/2.0.5', '2.0.5 c205']);
    expect(calls().filter(line => line.startsWith('flock'))).toHaveLength(1);
    expect(fs.readdirSync(at('opt/.incoming'))).toEqual([]);
    expect(deployLog()).toEqual(['tester deploy 2.0.5 ok']);
  });

  it('不带 --restart 时询问；回答不重启时只切换', () => {
    const result = run(['2.0.5'], DEPLOY, 'n\n');
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).toContain('上线后立即重启吗');
    expect([link('current'), read(at('sim/running'))]).toEqual(['releases/2.0.5', '2.0.4 c204']);
    expect(deployLog()).toEqual(['tester deploy 2.0.5 installed']);
  });

  it('版本低于线上时在上传前中止；--allow-downgrade 传到服务器端', () => {
    fs.rmSync(at('sim/release'), { recursive: true });
    attachments('2.0.3', at('sim/release'));
    let result = run(['2.0.3', '--restart'], DEPLOY);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('--allow-downgrade');
    expect(calls().filter(line => line.startsWith('scp'))).toEqual(['scp 1']); // 只传了 deploy-remote.sh
    expect(fs.existsSync(at('opt/releases/2.0.3'))).toBe(false);
    result = run(['2.0.3', '--restart', '--allow-downgrade'], DEPLOY);
    expect(result).toMatchObject({ code: 0 });
    expect(link('current')).toBe('releases/2.0.3');
  });

  it('status 打出线上的版本、对局数与连接数，不加锁', () => {
    write(at('sim/games'), '1');
    const result = run(['status'], DEPLOY);
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).toContain('线上 2.0.4（c204）：1 局正在进行');
    expect(result.out).toContain('3 条连接');
    expect(calls().some(line => line.startsWith('flock'))).toBe(false);
  });

  it('rollback、restart 交给服务器端；不认识的参数被拒', () => {
    run(['2.0.5', '--restart'], DEPLOY);
    expect(run(['rollback'], DEPLOY)).toMatchObject({ code: 0 });
    expect(link('current')).toBe('releases/2.0.4');
    expect(run(['restart'], DEPLOY)).toMatchObject({ code: 0 });
    expect(deployLog().slice(1)).toEqual(['tester rollback 2.0.4 ok', 'tester restart 2.0.4 ok']);
    expect(run(['2.0.5', '--force'], DEPLOY).out).toContain('不认识的参数：--force');
  });

  it('部署日志中的操作者只留字母、数字与 ._-', () => {
    expect(run(['2.0.5', '--restart'], DEPLOY, '', "Light King'; x")).toMatchObject({ code: 0 });
    expect(read(at('state/deploy.log'))).toMatch(/^\S+ Light_King___x deploy 2\.0\.5 ok\n$/);
  });
});

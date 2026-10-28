/** 联机服务端：2.0.1 的联机修复与重连令牌的换发、作废（SEC-020、SEC-022） */
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../server/rooms';
import { GRACE_SECS } from '../src/shared/protocol';
import { must } from './must';
import { Client, clientAt, world, startGame, matchUp } from './serverWorld';

describe('2.0.1 联机修复：重连与计时', () => {
  it('令牌已经失效（服务器重启过或掉线太久）：告诉客户端原来的对局不在了', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲', 'f'.repeat(32));
    expect(jia.id).toBeGreaterThan(0);
    expect(jia.expect('resumeFailed')).toBeTruthy();
    const yi = new Client(srv, '乙');
    expect(yi.has('resumeFailed')).toBe(false);
  });

  it('旧连接其实已经断了但还没被发现：新连接用令牌接管，旧连接迟到的断开被忽略', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi);
    jia.send({ t: 'move', x: 7, y: 7 });
    yi.drain();
    jia.silence();
    const jia2 = new Client(srv, '甲', jia.token, jia.uid);
    expect(jia2.id).toBe(jia.id);
    expect(jia2.expect('start')?.color).toBe(1);
    expect(jia2.expect('sync')?.acts).toEqual([{ k: 'M', x: 7, y: 7 }]);
    expect(yi.expect('peer')).toEqual({ t: 'peer', online: true });
    srv.disconnect(jia.sess, jia.conn); // 旧连接这时才被发现断开
    expect(yi.has('peer')).toBe(false);
    yi.send({ t: 'move', x: 8, y: 8 });
    expect(jia2.expect('moved')).toEqual({ t: 'moved', x: 8, y: 8 });
  });

  it('断线期间对局结束：重连后补发结果与排位结算', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    matchUp(jia, yi, 'ranked');
    jia.drop();
    yi.send({ t: 'resign' });
    expect(yi.expect('over')?.reason).toBe('resign');
    const jia2 = new Client(srv, '甲', jia.token, jia.uid);
    expect(jia2.expect('start')).toBeTruthy();
    expect(jia2.expect('over')).toEqual({ t: 'over', winner: expect.any(Number), reason: 'resign' });
    expect(jia2.expect('rated')?.delta).toBe(16);
    expect(jia2.has('turn')).toBe(false);
  });

  it('掉线的一方不在时不计时，回来后才开始计时', () => {
    const { srv, idle } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi, { moveTime: 30 });
    jia.send({ t: 'move', x: 7, y: 7 });
    jia.drop();
    yi.drain();
    yi.send({ t: 'move', x: 8, y: 8 }); // 轮到掉线的黑棋
    expect(yi.expect('turn', m => m.color === 1)?.secs).toBe(-1);
    idle(50, yi); // 比每步限时长，但在掉线宽限之内
    expect(yi.has('over')).toBe(false);
    const jia2 = new Client(srv, '甲', jia.token, jia.uid);
    expect(jia2.expect('turn')).toEqual({ t: 'turn', color: 1, secs: 30 });
    expect(yi.expect('turn')).toEqual({ t: 'turn', color: 1, secs: 30 });
    idle(31, jia2, yi);
    expect(yi.expect('over')).toEqual({ t: 'over', winner: 2, reason: 'timeout' });
  });
});

describe('2.0.1 联机修复：加入房间的失败次数', () => {
  it('加入房间失败太多次后暂时不能再试', () => {
    const { srv, advance } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    jia.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 });
    const { code } = must(jia.expect('created'), '开房间的回应');
    const wrong = code === '1234' ? '4321' : '1234';
    for (let i = 0; i < 5; i++) {
      yi.send({ t: 'join', code: wrong });
      expect(yi.expect('joinNo')?.reason).toBe('房号不存在，或房间已经开始');
    }
    yi.send({ t: 'join', code });
    expect(yi.expect('joinNo')?.reason).toBe('尝试次数太多，请稍后再试');
    jia.send({ t: 'ping' });
    yi.send({ t: 'ping' });
    advance(30);
    jia.send({ t: 'ping' });
    yi.send({ t: 'ping' });
    advance(31);
    yi.send({ t: 'join', code });
    expect(yi.expect('start')).toBeTruthy();
  });

  it('加入房间的失败按 IP 合计：同一 IP 换连接重试也躲不开，其他 IP 不受影响；一分钟后恢复（原问题 A6）', () => {
    const { srv, idle } = world();
    const host = new Client(srv, '房主');
    host.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 });
    const { code } = must(host.expect('created'), '开房间的回应');
    const wrong = code === '1234' ? '4321' : '1234';
    const IP = '203.0.113.7';
    // 每条连接失败 4 次（不触发每条连接 5 次的限制），5 条连接合计 20 次
    for (let n = 0; n < 5; n++) {
      const tryer = clientAt(srv, `试${n}`, IP);
      for (let i = 0; i < 4; i++) {
        tryer.send({ t: 'join', code: wrong });
        expect(tryer.expect('joinNo')?.reason).toBe('房号不存在，或房间已经开始');
      }
    }
    const again = clientAt(srv, '又来', IP);
    again.send({ t: 'join', code });
    expect(again.expect('joinNo')?.reason).toBe('尝试次数太多，请稍后再试');
    const other = clientAt(srv, '别处', '198.51.100.1');
    other.send({ t: 'join', code: wrong });
    expect(other.expect('joinNo')?.reason).toBe('房号不存在，或房间已经开始');
    expect(srv.joinFailIpCount()).toBe(2);
    idle(61, host, again, other);
    expect(srv.joinFailIpCount()).toBe(0); // 滑出窗口的 IP 已清理，不一直占着内存
    again.send({ t: 'join', code });
    expect(again.expect('start')).toBeTruthy();
  });
});

describe('2.0.1 联机修复：同一台设备、新版本提示', () => {
  it('同一台设备的两个窗口不能同时排位', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      jia2 = new Client(srv, '甲', undefined, jia.uid);
    jia.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    jia2.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    expect(jia2.expect('error')?.text).toBe('这台设备已经在排位中了');
    jia2.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    expect(jia2.expect('queued')?.mode).toBe('match');
  });

  it('配置了最新版本时，welcome 带上版本号与下载地址', () => {
    const { srv } = world(new MemoryStore(), { latest: '2.0.1', download: 'https://example.com/yi' });
    const jia = new Client(srv, '甲');
    expect(jia.welcome?.latest).toBe('2.0.1');
    expect(jia.welcome?.url).toBe('https://example.com/yi');
    const { srv: plain } = world();
    expect(new Client(plain, '乙').welcome?.latest).toBeUndefined();
  });
});

describe('重连令牌（SEC-020、SEC-022）', () => {
  /** 甲（gone）与乙（stay）开局后甲掉线 */
  const dropped = () => {
    const env = world();
    const gone = new Client(env.srv, '甲'),
      stay = new Client(env.srv, '乙');
    startGame(gone, stay);
    gone.drop();
    return { ...env, gone, stay };
  };

  it('重连成功后换发新令牌：随 welcome 下发，与原来的不同，格式不变', () => {
    const { srv, gone } = dropped();
    const back = new Client(srv, '甲', gone.token, gone.uid);
    expect(back.id).toBe(gone.id);
    expect(back.token).not.toBe(gone.token);
    expect(back.token).toMatch(/^[0-9a-f]{32}$/);
  });

  it('收到新连接上的下一条消息后，原来的令牌作废；新令牌照常可用', () => {
    const { srv, gone } = dropped();
    const back = new Client(srv, '甲', gone.token, gone.uid);
    back.send({ t: 'ping' });
    back.drop();
    const stale = new Client(srv, '甲', gone.token, gone.uid);
    expect(stale.has('resumeFailed')).toBe(true);
    expect(stale.id).not.toBe(gone.id);
    const again = new Client(srv, '甲', back.token, gone.uid);
    expect(again.id).toBe(gone.id);
    expect(again.has('start')).toBe(true);
  });

  it('新令牌没送到（重连后连接随即中断）：仍可用原来的令牌找回对局，并再换发一枚；没送到的那枚作废', () => {
    const { srv, gone } = dropped();
    const lost = new Client(srv, '甲', gone.token, gone.uid);
    lost.drop(); // 新令牌随这条连接一起丢了
    const again = new Client(srv, '甲', gone.token, gone.uid);
    expect(again.id).toBe(gone.id);
    expect(new Set([gone.token, lost.token, again.token]).size).toBe(3);
    again.send({ t: 'ping' });
    again.drop();
    for (const token of [gone.token, lost.token]) expect(new Client(srv, '甲', token, gone.uid).has('resumeFailed'), token).toBe(true);
    expect(new Client(srv, '甲', again.token, gone.uid).id).toBe(gone.id);
  });

  it('反复重连都没送到新令牌：确认后只留下最新的一枚，作废的令牌不在服务端残留', () => {
    const { srv, gone } = dropped();
    for (let i = 0; i < 5; i++) new Client(srv, '甲', gone.token, gone.uid).drop();
    expect(srv.tokenCount()).toBe(3); // 甲的新令牌与待确认的原令牌，加上乙的一枚
    const back = new Client(srv, '甲', gone.token, gone.uid);
    back.send({ t: 'ping' });
    expect(srv.tokenCount()).toBe(2);
  });

  it('掉线太久被移除后，令牌随之作废', () => {
    const { srv, idle, gone, stay } = dropped();
    idle(GRACE_SECS + 1, stay);
    expect(stay.expect('over')).toEqual({ t: 'over', winner: 2, reason: 'disconnect' });
    expect(srv.tokenCount()).toBe(1); // 只剩乙的一枚
    const late = new Client(srv, '甲', gone.token, gone.uid);
    expect(late.has('resumeFailed')).toBe(true);
    expect(late.id).not.toBe(gone.id);
  });
});

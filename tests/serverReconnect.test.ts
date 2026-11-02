/** 联机服务端：2.0.1 的联机修复与重连令牌的换发、作废（SEC-020、SEC-022） */
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../server/rooms';
import { CLOSE_CODE, GRACE_SECS, PROTO_VERSION } from '../src/shared/protocol';
import { must } from './must';
import { Client, clientAt, loginOf, sessionOf, world, startGame, matchUp } from './serverWorld';

describe('2.0.1 联机修复：重连与计时', () => {
  it('令牌已经失效（服务器重启过或掉线太久）：告诉客户端原来的对局不在了', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲', 'f'.repeat(32));
    expect(jia.id).toBeGreaterThan(0);
    expect(jia.expect('resumeFailed')).toBeTruthy();
    const yi = new Client(srv, '乙');
    expect(yi.has('resumeFailed')).toBe(false);
  });

  it('旧连接其实已经断了但还没被发现：新连接接管，对方看来一直在线；旧连接迟到的断开被忽略', () => {
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
    expect(yi.has('peer')).toBe(false); // 服务端没发现过掉线，不通知对方
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
      expect(yi.expect('joinNo')?.code).toBe('room.not-found');
    }
    yi.send({ t: 'join', code });
    expect(yi.expect('joinNo')?.code).toBe('room.join-throttled');
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
        expect(tryer.expect('joinNo')?.code).toBe('room.not-found');
      }
    }
    const again = clientAt(srv, '又来', IP);
    again.send({ t: 'join', code });
    expect(again.expect('joinNo')?.code).toBe('room.join-throttled');
    const other = clientAt(srv, '别处', '198.51.100.1');
    other.send({ t: 'join', code: wrong });
    expect(other.expect('joinNo')?.code).toBe('room.not-found');
    expect(srv.joinFailIpCount()).toBe(2);
    idle(61, host, again, other);
    expect(srv.joinFailIpCount()).toBe(0); // 滑出窗口的 IP 已清理，不一直占着内存
    again.send({ t: 'join', code });
    expect(again.expect('start')).toBeTruthy();
  });
});

describe('一个账号一条连接（protocol-v4.md 第 4 章）、新版本提示', () => {
  it('同一账号在别处连上：先前的连接收到 auth.replaced 并以 4002 关闭，排位随账号转到新连接，不会两处同时排位', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲');
    jia.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    expect(jia.expect('queued')).toBeTruthy();
    const jia2 = new Client(srv, '甲', undefined, jia.uid);
    expect(jia.inbox).toEqual([{ t: 'error', code: 'auth.replaced', level: 'E2' }]);
    expect(jia.closeCode).toBe(CLOSE_CODE.replaced);
    expect(jia2.id).toBe(jia.id);
    expect(srv.queued('ranked', 0)).toBe(1);
    const yi = new Client(srv, '乙');
    yi.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    expect(jia2.expect('found')?.opp.name).toBe('乙'); // 配对的通知发到新连接
    expect(srv.health().players).toBe(2);
  });

  it('先前连接迟到的消息与关闭事件不影响接管后的玩家', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi);
    const old = { sess: jia.sess, conn: jia.conn };
    const jia2 = new Client(srv, '甲', undefined, jia.uid);
    expect(jia2.expect('sync')).toBeTruthy();
    srv.message(old.sess, { t: 'resign' }, old.conn); // 旧连接上迟到的认输
    srv.disconnect(old.sess, old.conn);
    expect(yi.has('over')).toBe(false);
    expect(yi.has('peer')).toBe(false);
    jia2.send({ t: 'move', x: 7, y: 7 });
    expect(yi.expect('moved')).toBeTruthy();
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

  it('收到新连接上的下一条消息后，原来的令牌作废；令牌只对它的账号有效，别的账号拿着它也回不到这一局', () => {
    const { srv, gone } = dropped();
    const back = new Client(srv, '甲', gone.token, gone.uid);
    back.send({ t: 'ping' });
    back.drop();
    expect(srv.tokenCount()).toBe(2); // 原令牌已作废：甲的新令牌与乙的一枚
    const thief = new Client(srv, '丁', back.token);
    expect(thief.has('resumeFailed')).toBe(true);
    expect(thief.id).not.toBe(gone.id);
    const again = new Client(srv, '甲', undefined, gone.uid); // 同一账号重新登录，不带令牌也回到原来的对局
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
    expect(srv.tokenCount()).toBe(2); // 作废的两枚都已删除，只剩甲的最新一枚与乙的一枚
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

describe('账号握手与登录撤销（protocol-v4.md 第 3、4 章）', () => {
  it('账号功能未开启时不能联机：server.maintenance，以 1001 关闭', () => {
    const { srv } = world(new MemoryStore(), { gate: undefined });
    const jia = new Client(srv, '甲');
    expect(jia.welcome).toBeUndefined();
    expect(jia.inbox).toEqual([{ t: 'error', code: 'server.maintenance', level: 'E2' }]);
    expect(jia.closeCode).toBe(CLOSE_CODE.restart);
    expect(srv.health().players).toBe(0);
  });

  it('登录令牌无效或已撤销：auth.invalid，以 4001 关闭；未同意当前协议：consent.outdated，以 4001 关闭；都不上线', () => {
    const { srv, gate } = world();
    gate.revoked.add(loginOf('revoked-account-0001', '甲'));
    const revoked = new Client(srv, '甲', undefined, 'revoked-account-0001');
    expect([revoked.inbox, revoked.closeCode]).toEqual([[{ t: 'error', code: 'auth.invalid', level: 'E4' }], CLOSE_CODE.authFailed]);
    gate.consentPending.add('pending-account-0001');
    const pending = new Client(srv, '乙', undefined, 'pending-account-0001');
    expect([pending.inbox, pending.closeCode]).toEqual([[{ t: 'error', code: 'consent.outdated', level: 'E2' }], CLOSE_CODE.authFailed]);
    expect(srv.health().players).toBe(0);
  });

  it('退出（撤销一个会话）只关闭以该会话握手的连接；改密（撤销全部会话）关闭该账号的连接；对局席位按掉线保留', () => {
    const { srv, gate } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    startGame(jia, yi);
    const userId = gate.idOf(jia.uid, '甲');
    srv.revoke({ userId, sessionId: sessionOf(userId, 2) }); // 别的会话退出：这条连接不受影响
    expect(jia.closed).toBe(false);
    srv.revoke({ userId, sessionId: sessionOf(userId) });
    expect(jia.inbox.at(-1)).toEqual({ t: 'error', code: 'auth.invalid', level: 'E4' });
    expect(jia.closeCode).toBe(CLOSE_CODE.authFailed);
    expect(yi.expect('peer')).toEqual({ t: 'peer', online: false, wait: GRACE_SECS });
    const back = new Client(srv, '甲', undefined, jia.uid); // 重新登录后回来
    expect(back.expect('sync')).toBeTruthy();
    srv.revoke({ userId }); // 改密：不论会话
    expect(back.closeCode).toBe(CLOSE_CODE.authFailed);
    srv.revoke({ userId: 999 }); // 没有在线连接的账号：什么也不做
  });

  it('换一次登录（新的会话）接管后：退出先前的会话不再影响这条连接，退出新的会话才断开；不在房间时取最新的雅号', () => {
    const { srv, gate } = world();
    const jia = new Client(srv, '甲');
    const userId = gate.idOf(jia.uid, '甲');
    // 同一账号在另一台设备上以新的登录连上，期间改了雅号
    const conn = { inbox: [] as unknown[], closed: undefined as number | undefined };
    const sess = srv.connect({ send: m => conn.inbox.push(m), close: code => (conn.closed = code) });
    if (!sess) throw new Error('服务端拒绝了连接');
    srv.message(sess, { t: 'hello', v: PROTO_VERSION, auth: loginOf(jia.uid, '甲改', 2) });
    expect(conn.inbox[0]).toMatchObject({ t: 'welcome', id: jia.id, user: { name: '甲改' } });
    srv.revoke({ userId, sessionId: sessionOf(userId) });
    expect(conn.closed).toBeUndefined();
    srv.revoke({ userId, sessionId: sessionOf(userId, 2) });
    expect(conn.closed).toBe(CLOSE_CODE.authFailed);
  });
});

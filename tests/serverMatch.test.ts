/** 联机服务端：匹配与排位、配对确认、好友房间、段位（以假时钟直接驱动 RoomServer） */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../server/rooms';
import { CLOSE_CODE, newRating, type LegacyS2C, type S2C } from '../src/shared/protocol';
import { must } from './must';
import { expectClientAccepts, newUid, Client, world, startGame, matchUp } from './serverWorld';

/** 服务端存放段位所用的玩家键：`sha256('yi:' + uid)` 的前 32 位十六进制（DAT-075） */
const uidHash = (uid: string) =>
  createHash('sha256')
    .update('yi:' + uid)
    .digest('hex')
    .slice(0, 32);

describe('匹配', () => {
  it('两人进入队列即配对，看到对方后双方接受才开局', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    jia.send({ t: 'queue', mode: 'match', type: 0, size: 19 });
    expect(jia.expect('queued')).toEqual({ t: 'queued', mode: 'match', type: 0, size: 15 });
    yi.send({ t: 'queue', mode: 'match', type: 0, size: 19 });
    expect(jia.expect('found')).toEqual({ t: 'found', opp: { name: '乙' }, secs: 15 });
    expect(yi.expect('found')?.opp).toEqual({ name: '甲' });
    jia.send({ t: 'confirm', ok: true });
    expect(yi.expect('accepted')).toBeTruthy();
    expect(jia.has('start')).toBe(false);
    yi.send({ t: 'confirm', ok: true });
    const sa = must(jia.expect('start'), '甲的开局消息'),
      sb = must(yi.expect('start'), '乙的开局消息');
    expect(sa.kind).toBe('match');
    expect(sa.color + sb.color).toBe(3);
    expect(sa.moveTime).toBe(30);
    expect(jia.expect('turn')?.secs).toBe(30);
  });

  it('与等得最久的人配对；拒绝的退出，另一方继续匹配', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙'),
      bing = new Client(srv, '丙');
    jia.send({ t: 'queue', mode: 'match', type: 1, size: 9 });
    yi.send({ t: 'queue', mode: 'match', type: 1, size: 19 }); // 路数不同，不配对
    expect(yi.expect('queued')?.size).toBe(19);
    bing.send({ t: 'queue', mode: 'match', type: 1, size: 9 });
    expect(bing.expect('found')?.opp.name).toBe('甲');
    bing.send({ t: 'confirm', ok: false });
    expect(bing.expect('unmatched')).toEqual({ t: 'unmatched', requeued: false });
    expect(jia.expect('unmatched')).toEqual({ t: 'unmatched', requeued: true, reason: 'match.declined' });
    expect(jia.expect('queued')).toBeTruthy();
    const ding = new Client(srv, '丁');
    ding.send({ t: 'queue', mode: 'match', type: 1, size: 9 });
    expect(ding.expect('found')?.opp.name).toBe('甲'); // 甲仍排在最前
    ding.drop(); // 等确认时掉线：另一方得知对方已离开，继续匹配
    expect(jia.expect('unmatched')).toEqual({ t: 'unmatched', requeued: true, reason: 'match.left' });
  });

  it('确认超时：没接受的退出，接受了的继续匹配', () => {
    const { srv, idle } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    jia.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    yi.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    yi.send({ t: 'confirm', ok: true });
    idle(16, jia, yi);
    expect(jia.expect('unmatched')?.requeued).toBe(false);
    expect(yi.expect('unmatched')).toEqual({ t: 'unmatched', requeued: true, reason: 'match.unconfirmed' });
    expect(srv.queued('match', 0)).toBe(1);
  });
});

describe('离开队列与排位', () => {
  it('取消匹配、掉线都会离开队列', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    jia.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    jia.send({ t: 'unqueue' });
    yi.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    yi.drop();
    expect(srv.queued('ranked', 0)).toBe(0);
  });
  it('排位：同一台设备不和自己配对；胜负按 Elo 计分并存档', () => {
    const store = new MemoryStore();
    const { srv } = world(store);
    const jia = new Client(srv, '甲'),
      jia2 = new Client(srv, '甲的小号', undefined, jia.uid);
    jia.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    jia2.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    expect(jia.has('found')).toBe(false);
    jia2.send({ t: 'unqueue' });
    jia.send({ t: 'unqueue' });

    const yi = new Client(srv, '乙');
    const { sa, sb } = matchUp(jia, yi, 'ranked');
    expect(sa.kind).toBe('ranked');
    expect(sa.black.points).toBe(1200);
    const [blk, wht] = sa.color === 1 ? [jia, yi] : [yi, jia];
    blk.send({ t: 'resign' });
    expect(wht.expect('rated')).toEqual({ t: 'rated', type: 0, rating: { points: 1216, win: 1, loss: 0, draw: 0 }, delta: 16 });
    expect(blk.expect('rated')?.rating).toEqual({ points: 1184, win: 0, loss: 1, draw: 0 });
    wht.send({ t: 'rematch' });
    expect(wht.expect('error')?.code).toBe('game.rematch-ranked');

    const again = new Client(srv, '胜者', undefined, wht.uid); // 重新登录读回段位
    expect(again.welcome?.ratings.gomoku.points).toBe(1216);
    expect(again.welcome?.ratings.go.points).toBe(1200);
    expect(sb).toBeTruthy();
  });
});

describe('排位的计分', () => {
  it('排位中途离开按输棋计分', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    matchUp(jia, yi, 'ranked', 1);
    jia.send({ t: 'leave' });
    expect(jia.expect('rated')?.delta).toBe(-16);
    expect(yi.expect('over')?.reason).toBe('left');
    expect(yi.expect('rated')?.rating.points).toBe(1216);
  });

  it('分差悬殊时 Elo 算出的变化为 0：胜方仍加 1 分、负方仍扣 1 分，执黑执白都一样', () => {
    const strongPoints = 3000; // 与 1200 相差 1800 分，期望得分约 0.99997，按 K = 32 四舍五入为 0
    const colors = new Set<number>();
    for (const strongFirst of [true, false]) {
      const store = new MemoryStore();
      const { srv } = world(store);
      const uid = newUid(),
        rating = { points: strongPoints, win: 0, loss: 0, draw: 0 };
      store.set(uidHash(uid), { gomoku: rating, go: { ...rating, points: 1200 } });
      const strong = new Client(srv, '强', undefined, uid),
        weak = new Client(srv, '弱');
      expect(strong.welcome?.ratings.gomoku.points).toBe(strongPoints);
      const { sa, sb } = strongFirst ? matchUp(strong, weak, 'ranked') : matchUp(weak, strong, 'ranked');
      colors.add((strongFirst ? sa : sb).color);
      weak.send({ t: 'resign' });
      expect(strong.expect('rated')?.delta).toBe(1);
      expect(weak.expect('rated')?.delta).toBe(-1);
    }
    expect(colors).toEqual(new Set([1, 2])); // 两轮中强者分别执黑、执白，两处取整的下限都经过
  });
});

describe('好友房间', () => {
  it('输入房号即开局；错误房号、自己的房号被拒；房主可以关闭', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    jia.send({ t: 'create', type: 1, size: 13, hostColor: 1, renju: false, moveTime: 60 });
    const { code } = must(jia.expect('created'), '开房间的回应');
    expect(code).toMatch(/^\d{4}$/);
    jia.send({ t: 'join', code });
    expect(jia.expect('joinNo')?.code).toBe('room.already-in');
    yi.send({ t: 'join', code: '0000' });
    expect(yi.expect('joinNo')?.code).toBe('room.not-found');
    jia.send({ t: 'close' });
    yi.send({ t: 'join', code });
    expect(yi.expect('joinNo')).toBeTruthy();

    const { sa, sb } = startGame(jia, yi, { type: 1, size: 13, hostColor: 1, moveTime: 60 });
    expect(sa).toMatchObject({ kind: 'friend', color: 2, type: 1, size: 13, moveTime: 60 });
    expect(sb.color).toBe(1);
    expect(sb.white.points).toBeUndefined();
  });

  it('不在房间里时可以改名', () => {
    const { srv } = world();
    const jia = new Client(srv, '甲'),
      yi = new Client(srv, '乙');
    jia.send({ t: 'name', name: '甲甲' });
    const { sb } = startGame(jia, yi);
    jia.send({ t: 'name', name: '不生效' });
    expect(sb.black.name).toBe('甲甲');
  });

  it('名字里的控制字符被清掉并截短', () => {
    const { srv } = world();
    const jia = new Client(srv, '\n\t一二三四五六七八九十一二三四五六七八九十'),
      yi = new Client(srv, '');
    const { sb } = startGame(jia, yi);
    expect(sb.black.name).toBe('一二三四五六七八九十一二三四五六');
    expect(sb.white.name).toBe('棋手');
  });

  it('等待中的房间很多、随机房号接连撞上时，仍然发出可以加入的四位房号', () => {
    const { srv } = world(); // 假随机数恒为 0.3：每次随机出的房号都相同
    const hosts = Array.from({ length: 3 }, (_, i) => new Client(srv, `房主${i}`));
    const codes = hosts.map(host => {
      host.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 });
      return must(host.expect('created'), '开房间的回应').code;
    });
    expect(new Set(codes).size).toBe(3);
    for (const code of codes) expect(code).toMatch(/^\d{4}$/);
    const guest = new Client(srv, '客');
    guest.send({ t: 'join', code: codes[2] ?? '' });
    expect(guest.expect('start')?.white.name).toBe('客');
  });
});

describe('协议版本不符（API-004）', () => {
  it('版本不一致被拒：下发 proto.version-mismatch，附最新版本号与下载地址，以 4000 关闭，不创建玩家（API-004）', () => {
    const { srv } = world(new MemoryStore(), { latest: '4.0.1', download: 'https://yi.lightking.com.cn/download/' });
    const inbox: S2C[] = [];
    const closed: (number | undefined)[] = [];
    const sess = must(srv.connect({ send: m => inbox.push(expectClientAccepts(m)), close: code => closed.push(code) }) ?? undefined, '服务端接受的连接');
    srv.message(sess, { t: 'hello', v: 5, name: 'x', uid: '' });
    expect(inbox).toEqual([
      { t: 'error', code: 'proto.version-mismatch', level: 'E4', params: { latest: '4.0.1', url: 'https://yi.lightking.com.cn/download/' } },
    ]);
    expect(closed).toEqual([CLOSE_CODE.version]);
    expect(srv.health().players).toBe(0);
  });

  it('第 3 版客户端：以它能理解的 welcome（带下载地址）与文本错误提示更新，再以 4000 关闭（protocol-v4.md 第 8 章）', () => {
    const { srv } = world(new MemoryStore(), { latest: '4.0.1', download: 'https://yi.lightking.com.cn/download/' });
    const inbox: S2C[] = [];
    const legacy: LegacyS2C[] = [];
    const closed: (number | undefined)[] = [];
    const conn = { send: (m: S2C) => inbox.push(m), sendLegacy: (m: LegacyS2C) => legacy.push(m), close: (code?: number) => closed.push(code) };
    const sess = must(srv.connect(conn) ?? undefined, '服务端接受的连接');
    srv.message(sess, { t: 'hello', v: 3, name: '旧版', uid: 'legacy-device-0001' });
    expect(inbox).toEqual([]);
    expect(legacy).toEqual([
      {
        t: 'welcome',
        id: 1,
        token: expect.stringMatching(/^[0-9a-f]{32}$/),
        ratings: { gomoku: newRating(), go: newRating() },
        latest: '4.0.1',
        url: 'https://yi.lightking.com.cn/download/',
      },
      { t: 'error', text: '客户端版本与服务器不一致，请更新游戏' },
    ]);
    expect(closed).toEqual([CLOSE_CODE.version]);
    expect(srv.health().players).toBe(0);
  });
});

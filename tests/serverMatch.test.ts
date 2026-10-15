/** 联机服务端：匹配与排位、配对确认、好友房间、段位（以假时钟直接驱动 RoomServer） */
import { describe, expect, it } from 'vitest';
import { MemoryStore } from '../server/rooms';
import { type S2C } from '../src/shared/protocol';
import { expectClientAccepts, Client, world, startGame, matchUp } from './serverWorld';

describe('匹配与排位', () => {
  it('两人进入队列即配对，看到对方后双方接受才开局', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    a.send({ t: 'queue', mode: 'match', type: 0, size: 19 });
    expect(a.expect('queued')).toEqual({ t: 'queued', mode: 'match', type: 0, size: 15 });
    b.send({ t: 'queue', mode: 'match', type: 0, size: 19 });
    expect(a.expect('found')).toEqual({ t: 'found', opp: { name: '乙' }, secs: 15 });
    expect(b.expect('found')?.opp).toEqual({ name: '甲' });
    a.send({ t: 'confirm', ok: true });
    expect(b.expect('accepted')).toBeTruthy();
    expect(a.has('start')).toBe(false);
    b.send({ t: 'confirm', ok: true });
    const sa = a.expect('start')!,
      sb = b.expect('start')!;
    expect(sa.kind).toBe('match');
    expect(sa.color + sb.color).toBe(3);
    expect(sa.moveTime).toBe(30);
    expect(a.expect('turn')?.secs).toBe(30);
  });

  it('与等得最久的人配对；拒绝的退出，另一方继续匹配', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙'),
      c = new Client(srv, '丙');
    a.send({ t: 'queue', mode: 'match', type: 1, size: 9 });
    b.send({ t: 'queue', mode: 'match', type: 1, size: 19 }); // 路数不同，不配对
    expect(b.expect('queued')?.size).toBe(19);
    c.send({ t: 'queue', mode: 'match', type: 1, size: 9 });
    expect(c.expect('found')?.opp.name).toBe('甲');
    c.send({ t: 'confirm', ok: false });
    expect(c.expect('unmatched')).toEqual({ t: 'unmatched', requeued: false, reason: '' });
    expect(a.expect('unmatched')).toEqual({ t: 'unmatched', requeued: true, reason: '对方未接受' });
    expect(a.expect('queued')).toBeTruthy();
    const d = new Client(srv, '丁');
    d.send({ t: 'queue', mode: 'match', type: 1, size: 9 });
    expect(d.expect('found')?.opp.name).toBe('甲'); // 甲仍排在最前
  });

  it('确认超时：没接受的退出，接受了的继续匹配', () => {
    const { srv, idle } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    a.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    b.send({ t: 'queue', mode: 'match', type: 0, size: 15 });
    b.send({ t: 'confirm', ok: true });
    idle(16, a, b);
    expect(a.expect('unmatched')?.requeued).toBe(false);
    expect(b.expect('unmatched')).toEqual({ t: 'unmatched', requeued: true, reason: '对方未确认' });
    expect(srv.queued('match', 0)).toBe(1);
  });

  it('取消匹配、掉线都会离开队列', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    a.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    a.send({ t: 'unqueue' });
    b.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    b.drop();
    expect(srv.queued('ranked', 0)).toBe(0);
  });

  it('排位：同一台设备不和自己配对；胜负按 Elo 计分并存档', () => {
    const store = new MemoryStore();
    const { srv } = world(store);
    const a = new Client(srv, '甲'),
      a2 = new Client(srv, '甲的小号', undefined, a.uid);
    a.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    a2.send({ t: 'queue', mode: 'ranked', type: 0, size: 15 });
    expect(a.has('found')).toBe(false);
    a2.send({ t: 'unqueue' });
    a.send({ t: 'unqueue' });

    const b = new Client(srv, '乙');
    const { sa, sb } = matchUp(a, b, 'ranked');
    expect(sa.kind).toBe('ranked');
    expect(sa.black.points).toBe(1200);
    const [blk, wht] = sa.color === 1 ? [a, b] : [b, a];
    blk.send({ t: 'resign' });
    expect(wht.expect('rated')).toEqual({ t: 'rated', type: 0, rating: { points: 1216, win: 1, loss: 0, draw: 0 }, delta: 16 });
    expect(blk.expect('rated')?.rating).toEqual({ points: 1184, win: 0, loss: 1, draw: 0 });
    wht.send({ t: 'rematch' });
    expect(wht.expect('info')?.text).toBe('排位赛不能再来一局');

    const again = new Client(srv, '胜者', undefined, wht.uid); // 重新登录读回段位
    expect(again.welcome?.ratings.gomoku.points).toBe(1216);
    expect(again.welcome?.ratings.go.points).toBe(1200);
    expect(sb).toBeTruthy();
  });

  it('排位中途离开按输棋计分', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    matchUp(a, b, 'ranked', 1);
    a.send({ t: 'leave' });
    expect(a.expect('rated')?.delta).toBe(-16);
    expect(b.expect('over')?.reason).toBe('left');
    expect(b.expect('rated')?.rating.points).toBe(1216);
  });
});

describe('好友房间', () => {
  it('输入房号即开局；错误房号、自己的房号被拒；房主可以关闭', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    a.send({ t: 'create', type: 1, size: 13, hostColor: 1, renju: false, moveTime: 60 });
    const code = a.expect('created')!.code;
    expect(code).toMatch(/^\d{4}$/);
    a.send({ t: 'join', code });
    expect(a.expect('joinNo')?.reason).toBe('你已经在一个房间里了');
    b.send({ t: 'join', code: '0000' });
    expect(b.expect('joinNo')?.reason).toBe('房号不存在，或房间已经开始');
    a.send({ t: 'close' });
    b.send({ t: 'join', code });
    expect(b.expect('joinNo')).toBeTruthy();

    const { sa, sb } = startGame(a, b, { type: 1, size: 13, hostColor: 1, moveTime: 60 });
    expect(sa).toMatchObject({ kind: 'friend', color: 2, type: 1, size: 13, moveTime: 60 });
    expect(sb.color).toBe(1);
    expect(sb.white.points).toBeUndefined();
  });

  it('不在房间里时可以改名', () => {
    const { srv } = world();
    const a = new Client(srv, '甲'),
      b = new Client(srv, '乙');
    a.send({ t: 'name', name: '甲甲' });
    const { sb } = startGame(a, b);
    a.send({ t: 'name', name: '不生效' });
    expect(sb.black.name).toBe('甲甲');
  });

  it('名字里的控制字符被清掉并截短', () => {
    const { srv } = world();
    const a = new Client(srv, '\n\t一二三四五六七八九十一二三四五六七八九十'),
      b = new Client(srv, '');
    const { sb } = startGame(a, b);
    expect(sb.black.name).toBe('一二三四五六七八九十一二三四五六');
    expect(sb.white.name).toBe('棋手');
  });

  it('版本不一致被拒', () => {
    const { srv } = world();
    const inbox: S2C[] = [];
    const s = srv.connect({ send: m => inbox.push(expectClientAccepts(m)), close: () => {} })!;
    srv.message(s, { t: 'hello', v: 1, name: 'x', uid: '' });
    expect(inbox[0]).toEqual({ t: 'error', text: '客户端版本与服务器不一致，请更新游戏' });
  });

  it('等待中的房间很多、随机房号接连撞上时，仍然发出可以加入的四位房号', () => {
    const { srv } = world(); // 假随机数恒为 0.3：每次随机出的房号都相同
    const hosts = Array.from({ length: 3 }, (_, i) => new Client(srv, `房主${i}`));
    const codes = hosts.map(h => {
      h.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0 });
      return h.expect('created')!.code;
    });
    expect(new Set(codes).size).toBe(3);
    for (const c of codes) expect(c).toMatch(/^\d{4}$/);
    const guest = new Client(srv, '客');
    guest.send({ t: 'join', code: codes[2] ?? '' });
    expect(guest.expect('start')?.white.name).toBe('客');
  });
});

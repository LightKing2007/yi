/**
 * 大厅中的请求（整改项 P2-12 自 rooms.ts 拆出）：心跳、离开、改名、进入与退出匹配、配对确认、开房间、关房间、
 * 凭房号加入好友房间。维护模式中不再开始新的对局（OPS-045），加入失败过多时暂时拒绝（防止遍历房号）。
 */
import { BLACK, WHITE } from '../src/core/types';
import { cleanName, queueRules, type C2S } from '../src/shared/protocol';
import { allow, violate } from './hub';
import { confirm, enqueue, rankedElsewhere, unqueue } from './matchmaking';
import { MAINTENANCE_TEXT } from './play';
import { byId, freeRoom, leaveRoom, newRoom, roomCode, seatPlayers } from './room';
import { RoomState, type Player, type QEntry, type ServerContext } from './roomTypes';

const MAX_ROOMS = 1024;
const JOIN_FAILS = 5; // 一条连接一分钟内最多几次加入失败，超过就暂时不让再试（防止遍历房号）；同一 IP 合计另有上限（JOIN_FAILS_PER_IP）
/** 统计加入失败次数的时间窗 */
const JOIN_WINDOW_SECS = 60;

/** 玩家是否已在房间里或已配对、等确认：这时不能再进入匹配、开房间或加入房间 */
export function busy(p: Player) {
  return !!(p.room || p.match);
}

/** 不在对局中也能发的消息（匹配、房间、改名、心跳）；处理了返回 true */
export function lobby(ctx: ServerContext, p: Player, m: C2S): boolean {
  switch (m.t) {
    case 'ping':
      ctx.send(p, { t: 'pong' });
      return true;
    case 'leave':
      leaveRoom(ctx, p);
      return true;
    case 'name':
      rename(ctx, p, m.name);
      return true;
    case 'queue':
      if (allow(ctx, p, 'queue')) queueFor(ctx, p, { mode: m.mode, type: m.type, size: m.size });
      return true;
    case 'unqueue':
      if (allow(ctx, p, 'queue')) unqueue(ctx, p);
      return true;
    case 'confirm':
      confirm(ctx, p, m.ok);
      return true;
    case 'create':
      createRoom(ctx, p, m);
      return true;
    case 'close':
      closeRoom(ctx, p);
      return true;
    case 'join':
      joinRoom(ctx, p, m.code);
      return true;
    default:
      return false;
  }
}

/**
 * 改名（不在房间里时）。客户端每次匹配、开房、加入前都会先发一次 name，与当前昵称相同的不算改名，
 * 不计入频率；真正改名的每 10 秒至多 1 次（API-044）
 */
export function rename(ctx: ServerContext, p: Player, raw: string) {
  if (busy(p)) return;
  const name = cleanName(raw, p.name);
  if (name !== p.name && allow(ctx, p, 'name')) p.name = name;
}

/** 进入匹配或排位：维护模式中、已在房间里、同一台设备已在排位时拒绝；否则重新排队 */
export function queueFor(ctx: ServerContext, p: Player, { mode, type, size }: Pick<QEntry, 'mode' | 'type' | 'size'>) {
  if (ctx.maintenance) {
    ctx.send(p, { t: 'error', text: MAINTENANCE_TEXT });
    return;
  }
  if (busy(p)) {
    ctx.send(p, { t: 'error', text: '你已经在一个房间里了' });
    return;
  }
  if (mode === 'ranked' && rankedElsewhere(ctx, p)) {
    ctx.send(p, { t: 'error', text: '这台设备已经在排位中了' });
    return;
  }
  unqueue(ctx, p);
  enqueue(ctx, p, { mode, type, size });
}

/** 开好友房间：维护模式中、已在房间里、房间数已满时拒绝；路数与匹配相同，禁手与每步限时由房主选 */
export function createRoom(ctx: ServerContext, p: Player, m: Extract<C2S, { t: 'create' }>) {
  if (ctx.maintenance) {
    ctx.send(p, { t: 'error', text: MAINTENANCE_TEXT });
    return;
  }
  if (busy(p)) {
    ctx.send(p, { t: 'error', text: '你已经在一个房间里了' });
    return;
  }
  if (ctx.rooms.size >= MAX_ROOMS) {
    ctx.send(p, { t: 'error', text: '服务器房间已满，请稍后再试' });
    return;
  }
  unqueue(ctx, p);
  // 路数与匹配相同：五子棋只有 15 路，围棋没有 15 路；禁手与每步限时由房主选
  const { size } = queueRules('match', m.type, m.size);
  const r = newRoom(ctx, 'friend', { type: m.type, size, renju: m.type === 0 && m.renju, moveTime: m.moveTime }, { hostColor: m.hostColor, host: p.id });
  r.code = roomCode(ctx);
  p.room = r.id;
  ctx.send(p, { t: 'created', code: r.code });
  ctx.log('info', 'room.created', { msg: `${p.name} 开房间 ${r.code}`, roomId: r.id, playerId: p.id });
}

/** 房主关闭尚未开始的房间 */
export function closeRoom(ctx: ServerContext, p: Player) {
  const r = ctx.rooms.get(p.room);
  if (r && r.state === RoomState.Wait && r.host === p.id) {
    p.room = 0;
    freeRoom(ctx, r);
  }
}

/** 凭房号加入好友房间：本连接或同一 IP 一分钟内失败过多时暂时拒绝并累计违规；房主已离开时释放房间；成功即入座开局 */
export function joinRoom(ctx: ServerContext, p: Player, code: string) {
  if (ctx.maintenance) {
    ctx.send(p, { t: 'joinNo', reason: MAINTENANCE_TEXT });
    return;
  }
  const now = ctx.now();
  p.joinFails = p.joinFails.filter(t0 => now - t0 < JOIN_WINDOW_SECS);
  const ip = p.conn?.ip; // 按 IP 计数：换一条连接也躲不开（原问题 A6）
  if (p.joinFails.length >= JOIN_FAILS || (ip !== undefined && ctx.joinFailsByIp.full(ip, now))) {
    ctx.send(p, { t: 'joinNo', reason: '尝试次数太多，请稍后再试' });
    violate(ctx, p);
    return;
  } // E3
  const r = [...ctx.rooms.values()].find(room => room.state === RoomState.Wait && room.code === code);
  if (busy(p)) {
    ctx.send(p, { t: 'joinNo', reason: '你已经在一个房间里了' });
    return;
  }
  const noRoom = () => {
    p.joinFails.push(now);
    if (ip !== undefined) ctx.joinFailsByIp.hit(ip, now);
    ctx.send(p, { t: 'joinNo', reason: '房号不存在，或房间已经开始' });
  };
  if (!r) {
    noRoom();
    return;
  }
  const host = byId(ctx, r.host);
  if (!host || !host.conn) {
    freeRoom(ctx, r);
    noRoom();
    return;
  }
  if (host === p) {
    ctx.send(p, { t: 'joinNo', reason: '这是你自己的房间' });
    return;
  }
  unqueue(ctx, p);
  const hostColor = r.hostColor === 2 ? randomColor(ctx) : r.hostColor === 1 ? WHITE : BLACK; // hostColor：0 执黑 1 执白 2 随机
  seatPlayers(ctx, r, [host, p], hostColor);
}

/** 随机分先：黑白各半 */
export function randomColor(ctx: ServerContext) {
  return ctx.random() < 1 / 2 ? BLACK : WHITE;
}

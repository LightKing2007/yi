/**
 * 连接与玩家（整改项 P2-12 自 rooms.ts 拆出）：握手与匿名身份、玩家数与未握手连接的上限、重连令牌的签发与查找、
 * 带令牌重连回到原来的对局、断线与玩家时限，以及限流与违规累计（API-042 至 API-046、SEC-020、SEC-022）。
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { other } from '../src/core/types';
import type { Invalid } from '../src/shared/parse';
import { CLOSE_CODE, GRACE_SECS, HELLO_SECS, IDLE_SECS, LEGACY_PROTO_VERSION, cleanName, newRating, type C2S } from '../src/shared/protocol';
import { errorMsg } from './errorMsg';
import { dropMatch, unqueue } from './matchmaking';
import { BAN_SECS, type LimitedOp } from './ratelimit';
import { bothOnline, colorOf, finish, leaveRoom, resync, seat } from './room';
import { RoomState, type Conn, type Player, type Room, type ServerContext } from './roomTypes';

const MAX_PLAYERS = 2048;
/**
 * 尚未握手的连接最多几条（API-046）：玩家数上限在握手时才检查，满员时带令牌的重连仍能回到原来的对局；
 * 未握手的连接另设上限，使服务端保存的连接总数仍然有界。它们须在 HELLO_SECS 内握手，同一 IP 的连接数与新建频率另有限制。
 * 取与玩家上限相同的值：满员服务器的全部玩家同时重连（如服务器重启、网络抖动后）也不会被拒；每条未握手的连接约占 1 KB
 */
export const PENDING_MAX = MAX_PLAYERS;
/** 重连令牌的随机字节数：16 字节，即 32 位十六进制（API-013、SEC-020） */
const TOKEN_BYTES = 16;
/** 匿名身份散列保留的十六进制位数（DAT-075） */
const UID_HASH_CHARS = 32;
/** 第 3 版客户端的更新提示（protocol-v4.md 第 8 章）：以它能显示的文本下发 */
const LEGACY_UPDATE_TEXT = '客户端版本与服务器不一致，请更新游戏';
/** 令牌的散列（十六进制）：按令牌查找时以它为键（SEC-022） */
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
/** 两个十六进制散列是否相同：常量时间比较（SEC-022）；长度不同（含空串）时不同 */
const sameHash = (left: string, right: string) => left.length === right.length && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
/** 十六进制的基数 */
const HEX_RADIX = 16;
/** n 个随机字节的十六进制表示（2n 位） */
const hex = (n: number) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, byte => byte.toString(HEX_RADIX).padStart(2, '0')).join('');
};

/** 连接断了：未握手的直接移除；对局中保留席位并暂停计时、告诉对方；其余离开房间并移除 */
export function goOffline(ctx: ServerContext, p: Player, conn?: Conn, code?: number) {
  if (!ctx.players.has(p) || !p.conn || (conn && p.conn !== conn)) return;
  p.conn = null;
  p.offAt = ctx.now();
  if (!p.id) {
    forget(ctx, p);
    return;
  }
  ctx.log('info', 'player.offline', { msg: `${p.name} 断开`, playerId: p.id, code });
  unqueue(ctx, p);
  if (p.match) dropMatch(ctx, p.match, [p], 'match.left');
  const r = ctx.rooms.get(p.room);
  if (r && r.state === RoomState.Play) {
    if (r.deadline) {
      r.paused = r.deadline - ctx.now();
      r.deadline = 0;
    } // 有人掉线时双方都不计时
    const opp = seat(ctx, r, other(colorOf(r, p)));
    ctx.send(opp, { t: 'peer', online: false, wait: GRACE_SECS });
    if (r.paused > 0) ctx.send(opp, { t: 'turn', color: r.g.cur.toMove, secs: -1 });
    return;
  }
  leaveRoom(ctx, p);
  forget(ctx, p);
}

/** 玩家的时限：握手超时（API-042）；太久没消息，当作断线；掉线太久，对局判负并清理 */
export function tickPlayer(ctx: ServerContext, p: Player, now: number) {
  if (p.conn && !p.id && now - p.since > HELLO_SECS) drop(ctx, p, CLOSE_CODE.helloTimeout);
  else if (p.conn && now - p.lastSeen > IDLE_SECS) drop(ctx, p);
  else if (!p.conn && now - p.offAt > GRACE_SECS) {
    const r = ctx.rooms.get(p.room);
    if (r && r.state === RoomState.Play) finish(ctx, r, { winner: other(colorOf(r, p)), reason: 'disconnect' });
    leaveRoom(ctx, p);
    forget(ctx, p);
  }
}

/** 服务端主动断开一条连接：先按断线处理（对局中保留席位），再关闭；code 为关闭码，不带时直接切断 */
export function drop(ctx: ServerContext, p: Player, code?: number) {
  const conn = p.conn;
  if (!conn) return;
  ctx.disconnect(p, conn, code);
  conn.close(code);
}

/** 超出频率限制（E3）：丢弃这次请求，1 秒内只提示一次，并累计一次违规 */
export function limited(ctx: ServerContext, p: Player) {
  ctx.metrics?.inc('yi_rate_limited_total');
  const now = ctx.now();
  if (p.limits.notice(now)) {
    ctx.send(p, errorMsg('rate.limited'));
    // 随提示每秒至多记一行；count 含本次即将累计的这一次违规
    ctx.log('warn', 'rate.limited', { playerId: p.id || undefined, count: p.limits.violations(now) + 1 });
  }
  violate(ctx, p);
}

/**
 * 累计一次违规（E3、E4）；60 秒内达到 10 次时以 1008 断开，并在 5 分钟内拒绝同一匿名身份再连上（API-045）。
 * 断开后对局照常保留席位，但被拒期间无法重连，到时按掉线判负
 */
export function violate(ctx: ServerContext, p: Player) {
  if (!p.conn || !p.limits.violate(ctx.now())) return;
  if (p.key) ctx.banned.set(p.key, ctx.now() + BAN_SECS);
  ctx.log('warn', 'conn.kicked', { msg: `${p.id ? p.name : '未握手的连接'} 累计违规过多，已断开`, playerId: p.id || undefined, code: CLOSE_CODE.policy });
  drop(ctx, p, CLOSE_CODE.policy);
}

/** 受频率限制的操作（API-044）：没超出时返回 true；超出时按限流处理并返回 false */
export function allow(ctx: ServerContext, p: Player, op: LimitedOp) {
  if (p.limits.allow(op, ctx.now())) return true;
  limited(ctx, p);
  return false;
}

/**
 * 非法消息（API-015）：版本不符时提示更新并以 4000 关闭（API-004）；其余回复格式错误后丢弃并累计一次违规。
 * 每条连接只记第一条的日志，免得被刷屏
 */
export function rejectInvalid(ctx: ServerContext, p: Player, m: Invalid) {
  if (m.invalid === 'version') {
    outdated(ctx, p, m.version);
    return;
  }
  ctx.send(p, errorMsg('proto.invalid-message'));
  if (p.invalid++ === 0) ctx.log('warn', 'proto.invalid', { msg: '非法消息', playerId: p.id || undefined, reason: m.why });
  violate(ctx, p);
}

/**
 * 协议版本不符（API-004）：第 3 版客户端收到它能理解的 welcome（带最新版本号与下载地址，使其显示下载提示）与文本错误
 * （protocol-v4.md 第 8 章），不创建玩家；其他版本收到 proto.version-mismatch，附最新版本号与下载地址。都以 4000 关闭；
 * 版本不符不是对方的过错，不累计违规
 */
export function outdated(ctx: ServerContext, p: Player, version: number | undefined) {
  const conn = p.conn;
  if (!conn) return;
  const { latest, url } = ctx.latest;
  if (version === LEGACY_PROTO_VERSION) {
    conn.sendLegacy?.({ t: 'welcome', id: 1, token: hex(TOKEN_BYTES), ratings: { gomoku: newRating(), go: newRating() }, ...ctx.latest });
    conn.sendLegacy?.({ t: 'error', text: LEGACY_UPDATE_TEXT });
  } else ctx.send(p, errorMsg('proto.version-mismatch', latest && url ? { params: { latest, url } } : {}));
  ctx.log('info', 'proto.outdated', { msg: `协议版本 ${String(version)} 的客户端，已提示更新`, version });
  drop(ctx, p, CLOSE_CODE.version);
}

/** 握手（hello）：校验匿名身份是否被暂时拒绝；带有效令牌时回到原来的会话，否则在玩家数上限内作为新玩家上线 */
export function hello(ctx: ServerContext, p: Player, m: C2S): Player {
  if (m.t !== 'hello') {
    ctx.send(p, errorMsg('proto.not-hello'));
    violate(ctx, p);
    return p;
  }
  // 匿名身份：只存散列，存档里看不出原来的 uid（DAT-075）
  const key = createHash('sha256')
    .update('yi:' + m.uid)
    .digest('hex')
    .slice(0, UID_HASH_CHARS);
  if ((ctx.banned.get(key) ?? 0) > ctx.now()) {
    // 刚因累计违规被断开（API-045）
    ctx.send(p, errorMsg('rate.limited'));
    drop(ctx, p, CLOSE_CODE.policy);
    return p;
  }
  p.lastSeen = ctx.now();
  const found = m.token === undefined ? null : findByToken(ctx, m.token);
  if (found) return resume(ctx, p, found.player, found.hash); // p 还没握手，不会是 found.player
  if (ctx.players.size - ctx.pending() >= MAX_PLAYERS) {
    // 满员（API-046）：只拒绝新来的玩家；带令牌重连的已在上一行回到原来的会话，不占新的名额
    ctx.send(p, errorMsg('server.full'));
    drop(ctx, p, CLOSE_CODE.overload);
    return p;
  }
  p.name = cleanName(m.name, '棋手');
  p.id = ctx.nextPlayer++;
  const token = issueToken(ctx, p);
  p.key = key;
  ctx.store.seen(p.key, p.name); // 找到或新建游客用户（roadmap.md 第 5.4 节）
  const saved = ctx.store.get(p.key);
  p.ratings = { gomoku: { ...newRating(), ...saved?.gomoku }, go: { ...newRating(), ...saved?.go } };
  ctx.send(p, { t: 'welcome', id: p.id, token, ratings: p.ratings, ...ctx.latest });
  if (m.token !== undefined) ctx.send(p, { t: 'resumeFailed' }); // 原来的对局已经不在了（服务器重启过，或掉线太久）
  if (ctx.maintenance) ctx.send(p, { t: 'notice', code: 'server.maintenance' });
  ctx.log('info', 'player.online', { msg: `${p.name} 上线`, playerId: p.id });
  return p;
}

/**
 * 带令牌重连，找回掉线的玩家 back：由新连接（p 的连接）接管，并换发新令牌（SEC-020）。usedHash 为这次所用令牌的散列，
 * 在收到新连接上的下一条消息之前仍然有效：新令牌若随连接再次中断而没送到，客户端仍可用原来的令牌回来
 */
export function resume(ctx: ServerContext, p: Player, back: Player, usedHash: string): Player {
  const old = back.conn;
  if (old) {
    // 旧连接其实已经断了，只是还没被发现：由新连接接管
    back.conn = null;
    old.close();
  }
  back.conn = p.conn;
  back.lastSeen = ctx.now();
  ctx.players.delete(p); // p 还没握手，没有令牌
  p.conn = null;
  ctx.send(back, { t: 'welcome', id: back.id, token: issueToken(ctx, back, usedHash), ratings: back.ratings, ...ctx.latest });
  const r = ctx.rooms.get(back.room);
  if (r && r.state !== RoomState.Wait) resumeRoom(ctx, r, back);
  ctx.log('info', 'player.resumed', { msg: `${back.name} 重新连上`, playerId: back.id, roomId: back.room || undefined });
  return back;
}

/** 重连的玩家回到房间：回放整局；双方都在线时恢复计时，并告诉对方 */
export function resumeRoom(ctx: ServerContext, r: Room, back: Player) {
  const resume = r.state === RoomState.Play && r.paused > 0 && bothOnline(ctx, r);
  if (resume) {
    r.deadline = ctx.now() + r.paused;
    r.paused = 0;
  }
  resync(ctx, r, back);
  const opp = seat(ctx, r, other(colorOf(r, back)));
  ctx.send(opp, { t: 'peer', online: true });
  if (resume) ctx.send(opp, { t: 'turn', color: r.g.cur.toMove, secs: Math.round(r.deadline - ctx.now()) });
}

/** 给玩家换发一枚新令牌并返回原文（只随 welcome 下发一次）；keep 为仍须保留的旧令牌散列，其余旧令牌立即作废 */
export function issueToken(ctx: ServerContext, p: Player, keep = ''): string {
  for (const hash of [p.tokenHash, p.prevTokenHash]) if (hash && hash !== keep) ctx.byToken.delete(hash);
  const token = hex(TOKEN_BYTES);
  p.tokenHash = tokenHash(token);
  p.prevTokenHash = keep;
  ctx.byToken.set(p.tokenHash, p);
  return token;
}

/** 按令牌找到玩家：以散列查表，再以常量时间比较确认；找不到时返回 null */
export function findByToken(ctx: ServerContext, token: string): { player: Player; hash: string } | null {
  const hash = tokenHash(token),
    player = ctx.byToken.get(hash);
  if (!player || (!sameHash(hash, player.tokenHash) && !sameHash(hash, player.prevTokenHash))) return null;
  return { player, hash };
}

/** 新连接上收到了重连之后的消息：连接确实通了，新令牌已送到，上一枚令牌作废 */
export function confirmToken(ctx: ServerContext, p: Player) {
  if (!p.prevTokenHash) return;
  ctx.byToken.delete(p.prevTokenHash);
  p.prevTokenHash = '';
}

/** 移除玩家，连同他的令牌 */
export function forget(ctx: ServerContext, p: Player) {
  ctx.players.delete(p);
  for (const hash of [p.tokenHash, p.prevTokenHash]) if (hash) ctx.byToken.delete(hash);
}

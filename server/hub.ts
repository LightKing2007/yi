/**
 * 连接与玩家（整改项 P2-12 自 rooms.ts 拆出）：以账号的登录令牌握手、一个账号一名玩家与接管、登录撤销时断开、
 * 玩家数与未握手连接的上限、重连令牌的签发与查找、回到原来的对局、断线与玩家时限，以及限流与违规累计
 * （protocol-v4.md 第 3、4 章，API-042 至 API-046、SEC-020、SEC-022）。
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { other } from '../src/core/types';
import type { Invalid } from '../src/shared/parse';
import { CLOSE_CODE, GRACE_SECS, HELLO_SECS, IDLE_SECS, LEGACY_PROTO_VERSION, newRating, type C2S } from '../src/shared/protocol';
import { errorMsg } from './errorMsg';
import { dropMatch, unqueue } from './matchmaking';
import { BAN_SECS, type LimitedOp } from './ratelimit';
import { bothOnline, colorOf, finish, leaveRoom, resync, seat } from './room';
import { RoomState, type Conn, type OnlineIdentity, type Player, type Revocation, type Room, type ServerContext } from './roomTypes';

const MAX_PLAYERS = 2048;
/**
 * 尚未握手的连接最多几条（API-046）：玩家数上限在握手时才检查，满员时带令牌的重连仍能回到原来的对局；
 * 未握手的连接另设上限，使服务端保存的连接总数仍然有界。它们须在 HELLO_SECS 内握手，同一 IP 的连接数与新建频率另有限制。
 * 取与玩家上限相同的值：满员服务器的全部玩家同时重连（如服务器重启、网络抖动后）也不会被拒；每条未握手的连接约占 1 KB
 */
export const PENDING_MAX = MAX_PLAYERS;
/** 重连令牌的随机字节数：16 字节，即 32 位十六进制（API-013、SEC-020） */
const TOKEN_BYTES = 16;
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
 * 累计一次违规（E3、E4）；60 秒内达到 10 次时以 1008 断开，并在 5 分钟内拒绝同一账号再连上（API-045）。
 * 断开后对局照常保留席位，但被拒期间无法重连，到时按掉线判负
 */
export function violate(ctx: ServerContext, p: Player) {
  if (!p.conn || !p.limits.violate(ctx.now())) return;
  if (p.userId) ctx.banned.set(p.userId, ctx.now() + BAN_SECS);
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

/** 握手被拒：下发错误码后以 code 关闭，玩家不上线 */
function refuse(ctx: ServerContext, p: Player, error: Parameters<typeof errorMsg>[0], code: number): Player {
  ctx.send(p, errorMsg(error));
  drop(ctx, p, code);
  return p;
}

/**
 * 握手（hello，protocol-v4.md 第 3.1 条）：核验登录令牌与联机资格，不降级为游客；账号被暂时拒绝时断开；
 * 同一账号已有玩家（在线或掉线保留中）时由这条连接接管，否则在玩家数上限内作为新玩家上线
 */
export function hello(ctx: ServerContext, p: Player, m: C2S): Player {
  if (m.t !== 'hello') {
    ctx.send(p, errorMsg('proto.not-hello'));
    violate(ctx, p);
    return p;
  }
  if (!ctx.gate) return refuse(ctx, p, 'server.maintenance', CLOSE_CODE.restart); // 账号功能未开启：第 4 版的联机无从核验身份
  const who = ctx.gate.identify(m.auth);
  if (!who.ok) return refuse(ctx, p, who.code, CLOSE_CODE.authFailed);
  if ((ctx.banned.get(who.userId) ?? 0) > ctx.now()) return refuse(ctx, p, 'rate.limited', CLOSE_CODE.policy); // 刚因累计违规被断开（API-045）
  p.lastSeen = ctx.now();
  const back = ctx.byUser.get(who.userId);
  if (back) return takeOver(ctx, p, back, { who, resume: m.resume });
  // 满员（API-046）：只拒绝新来的账号；接管与重连回到原来的玩家，不占新的名额
  if (ctx.players.size - ctx.pending() >= MAX_PLAYERS) return refuse(ctx, p, 'server.full', CLOSE_CODE.overload);
  p.id = ctx.nextPlayer++;
  p.userId = who.userId;
  p.sessionId = who.sessionId;
  p.publicId = who.publicId;
  p.name = who.name;
  ctx.byUser.set(p.userId, p);
  const saved = ctx.store.get(p.userId);
  p.ratings = { gomoku: { ...newRating(), ...saved?.gomoku }, go: { ...newRating(), ...saved?.go } };
  ctx.send(p, welcome(ctx, p, issueToken(ctx, p)));
  if (m.resume !== undefined) ctx.send(p, { t: 'resumeFailed' }); // 原来的对局已经不在了（服务器重启过，或掉线太久）
  if (ctx.maintenance) ctx.send(p, { t: 'notice', code: 'server.maintenance' });
  ctx.log('info', 'player.online', { msg: `${p.name} 上线`, playerId: p.id });
  return p;
}

/** welcome：玩家号、新的重连令牌、账号的公开资料、段位与最新版本 */
const welcome = (ctx: ServerContext, p: Player, resume: string) =>
  ({ t: 'welcome', id: p.id, resume, user: { publicId: p.publicId, name: p.name }, ratings: p.ratings, ...ctx.latest }) as const;

/**
 * 同一账号的新连接接管已有的玩家 back（protocol-v4.md 第 4.1、4.2 条）：先使旧连接失效（此后它的消息与关闭事件都不再影响 back），
 * 再告知旧连接“账号已在别处登录”并以 4002 关闭；对局、匹配与房间随 back 转到新连接，换发新的重连令牌（SEC-020）。
 * 带的是 back 的重连令牌时，这枚令牌在新连接上的下一条消息之前仍然有效：新令牌若随连接再次中断而没送到，客户端仍可用它回来
 */
export function takeOver(
  ctx: ServerContext,
  p: Player,
  back: Player,
  { who, resume }: { who: Extract<OnlineIdentity, { ok: true }>; resume?: string },
): Player {
  const found = resume === undefined ? null : findByToken(ctx, resume);
  const usedHash = found?.player === back ? found.hash : '';
  const old = back.conn;
  back.conn = p.conn;
  if (old) {
    old.send(errorMsg('auth.replaced'));
    old.close(CLOSE_CODE.replaced);
  }
  back.sessionId = who.sessionId;
  if (!back.room) back.name = who.name; // 不在房间里时取最新的雅号；对局中保持开局时的名字（protocol-v4.md 第 5.3 条）
  back.lastSeen = ctx.now();
  ctx.players.delete(p); // p 还没握手，没有令牌
  p.conn = null;
  ctx.send(back, welcome(ctx, back, issueToken(ctx, back, usedHash)));
  const r = ctx.rooms.get(back.room);
  // 掉线后回来：恢复计时并告诉对方；从在线的连接接管：对方看来一直在线，只给新连接回放
  if (r && r.state !== RoomState.Wait) {
    if (old) resync(ctx, r, back);
    else resumeRoom(ctx, r, back);
  }
  const event = old ? 'player.replaced' : 'player.resumed';
  ctx.log('info', event, { msg: `${back.name} ${old ? '在别处连上，已接管' : '重新连上'}`, playerId: back.id, roomId: back.room || undefined });
  return back;
}

/** 登录被撤销（protocol-v4.md 第 4.3 条）：退出只关闭以该会话握手的连接，改密、重置关闭该账号的连接；对局中的席位按掉线保留 */
export function revoke(ctx: ServerContext, { userId, sessionId }: Revocation) {
  const p = ctx.byUser.get(userId);
  if (!p?.conn || (sessionId !== undefined && p.sessionId !== sessionId)) return;
  ctx.send(p, errorMsg('auth.invalid'));
  ctx.log('info', 'player.revoked', { msg: `${p.name} 的登录已撤销，断开联机`, playerId: p.id });
  drop(ctx, p, CLOSE_CODE.authFailed);
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

/** 移除玩家，连同他的令牌与账号索引 */
export function forget(ctx: ServerContext, p: Player) {
  ctx.players.delete(p);
  if (ctx.byUser.get(p.userId) === p) ctx.byUser.delete(p.userId);
  for (const hash of [p.tokenHash, p.prevTokenHash]) if (hash) ctx.byToken.delete(hash);
}

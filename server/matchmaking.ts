/**
 * 匹配与排位的队列、配对与双方确认（整改项 P2-12 自 rooms.ts 拆出）：与同一队列里等得最久的玩家配对，
 * 双方在时限内都接受即开局，有人拒绝、超时或掉线时另一方按原来的排队时刻继续匹配。
 */
import { BLACK, WHITE } from '../src/core/types';
import { CONFIRM_SECS, queueRules, type GameKind, type Opponent, type QueueMode } from '../src/shared/protocol';
import { typeKey } from './rating';
import { RoomState, type Match, type Player, type QEntry, type ServerContext } from './roomTypes';

/** 匹配与排位开局时，先配上的一方执黑的概率 */
const FIRST_BLACK_CHANCE = 0.5;

/** 配对的时限：确认超时，没点接受的一方作罢 */
export function tickMatch(ctx: ServerContext, m: Match, now: number) {
  if (now > m.deadline)
    dropMatch(
      ctx,
      m,
      m.side.filter((_, i) => !m.ok[i]).map(side => side.p),
      '对方未确认',
    );
}

/** 同一台设备的另一个会话正在排位（排队、等确认或对局中）：两个窗口同时排位会互相覆盖段位 */
export function rankedElsewhere(ctx: ServerContext, p: Player) {
  if (!p.key) return false;
  for (const o of ctx.players) {
    if (o === p || o.key !== p.key) continue;
    if (o.queued?.mode === 'ranked' || o.match?.mode === 'ranked') return true;
    const r = ctx.rooms.get(o.room);
    if (r && r.kind === 'ranked' && r.state === RoomState.Play) return true;
  }
  return false;
}

/** 进入匹配队列：want 为想要的模式、棋类与路数，since 为排队的起始时刻（配对作罢后按原来的时刻继续排） */
export function enqueue(ctx: ServerContext, p: Player, want: Pick<QEntry, 'mode' | 'type' | 'size'>, since = ctx.now()) {
  const { mode } = want;
  const rules = queueRules(mode, want.type, want.size);
  const entry: QEntry = { p, mode, type: rules.type, size: rules.size, since };
  // 队列按进入的先后排好；与同一队列里等得最久的人配对
  const other = ctx.queue.find(
    cand =>
      cand.p !== p && cand.mode === mode && cand.type === entry.type && cand.size === entry.size && cand.p.conn && !(mode === 'ranked' && cand.p.key === p.key),
  ); // 排位不和自己（同一台设备）配对
  if (!other) {
    let i = ctx.queue.findIndex(cand => cand.since > since);
    if (i < 0) i = ctx.queue.length;
    ctx.queue.splice(i, 0, entry);
    p.queued = entry;
    ctx.send(p, { t: 'queued', mode, type: entry.type, size: entry.size });
    return;
  }
  unqueue(ctx, other.p);
  const m: Match = { mode, type: entry.type, size: entry.size, side: [other, entry], ok: [false, false], deadline: ctx.now() + CONFIRM_SECS };
  ctx.matches.add(m);
  const [first, second] = m.side;
  for (const [me, opp] of [
    [first.p, second.p],
    [second.p, first.p],
  ] as const) {
    me.match = m;
    ctx.send(me, { t: 'found', opp: oppInfo(opp, m.mode, m.type), secs: CONFIRM_SECS });
  }
  ctx.log('info', 'match.paired', {
    msg: `配对（${mode === 'ranked' ? '排位' : '匹配'}）：${other.p.name} 与 ${p.name}`,
    mode,
    playerId: p.id,
    opponentId: other.p.id,
  });
}

/** 退出匹配队列；不在队列中时什么也不做 */
export function unqueue(ctx: ServerContext, p: Player) {
  if (!p.queued) return;
  const i = ctx.queue.indexOf(p.queued);
  if (i >= 0) ctx.queue.splice(i, 1);
  p.queued = null;
}

/** 告诉一方的对手信息：排位时带上对手在该棋类的段位分 */
export function oppInfo(p: Player, mode: QueueMode | GameKind, type: number): Opponent {
  return mode === 'ranked' ? { name: p.name, points: p.ratings[typeKey(type)].points } : { name: p.name };
}

/** 配对作罢：culprits（拒绝、超时、掉线的）退出匹配，另一方按原来的排队时刻继续匹配 */
export function dropMatch(ctx: ServerContext, m: Match, culprits: Player[], reason: string) {
  if (!ctx.matches.delete(m)) return;
  for (const side of m.side) side.p.match = null;
  for (const side of m.side) {
    if (culprits.includes(side.p)) {
      ctx.send(side.p, { t: 'unmatched', requeued: false, reason: '' });
      continue;
    }
    ctx.send(side.p, { t: 'unmatched', requeued: true, reason });
    if (side.p.conn) enqueue(ctx, side.p, side, side.since);
  }
}

/** 一方接受或拒绝配对：拒绝即作罢；双方都接受时开房间入座，随机决定先配上的一方是否执黑 */
export function confirm(ctx: ServerContext, p: Player, ok: boolean) {
  const m = p.match;
  if (!m) return;
  const i = m.side[0].p === p ? 0 : 1;
  const other = m.side[i === 0 ? 1 : 0];
  if (!ok) {
    dropMatch(ctx, m, [p], '对方未接受');
    return;
  }
  if (m.ok[i]) return;
  m.ok[i] = true;
  if (!m.ok[1 - i]) {
    ctx.send(other.p, { t: 'accepted' });
    return;
  }
  ctx.matches.delete(m);
  for (const side of m.side) side.p.match = null;
  const r = ctx.newRoom(m.mode, queueRules(m.mode, m.type, m.size), { hostColor: 2, host: 0 });
  ctx.seatPlayers(r, m.side[0].p, m.side[1].p, ctx.random() < FIRST_BLACK_CHANCE ? BLACK : WHITE);
}

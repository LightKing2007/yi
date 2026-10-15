/**
 * 排位赛的段位结算（Elo，整改项 P2-12 自 rooms.ts 拆出）：对局双方的段位分、胜负局数随结果变化，写入段位存放处并通知双方。
 */
import { BLACK, WHITE } from '../src/core/types';
import type { Rating, Ratings } from '../src/shared/protocol';
import type { Player, Room, ServerContext } from './roomTypes';

const ELO_K = 32;
/** Elo 期望得分公式 1 / (1 + 10^(分差 / 400)) 中的底数与分差尺度 */
const ELO_BASE = 10,
  ELO_SCALE = 400;
/** 和棋的得分（胜 1、负 0） */
const DRAW_SCORE = 0.5;

/** 棋类在段位记录中的键：0 五子棋、1 围棋 */
export const typeKey = (type: number) => (type ? 'go' : 'gomoku') as keyof Ratings;

/** 排位结算（Elo）：胜方至少加 1 分 */
export function rate(ctx: ServerContext, r: Room, winner: number) {
  const black = r.who[BLACK],
    white = r.who[WHITE];
  if (!black || !white) return;
  const k = typeKey(r.type),
    blackRating = black.ratings[k],
    whiteRating = white.ratings[k];
  const blackExpected = 1 / (1 + ELO_BASE ** ((whiteRating.points - blackRating.points) / ELO_SCALE));
  const blackScore = winner === BLACK ? 1 : winner === WHITE ? 0 : DRAW_SCORE;
  let gain = Math.round(ELO_K * (blackScore - blackExpected));
  if (blackScore === 1) gain = Math.max(1, gain);
  if (blackScore === 0) gain = Math.min(-1, gain);
  const apply = (p: Player, rt: Rating, delta: number, score: number) => {
    const before = rt.points;
    rt.points = Math.max(0, rt.points + delta);
    if (score === 1) rt.win++;
    else if (score === 0) rt.loss++;
    else rt.draw++;
    if (p.key) ctx.store.set(p.key, p.ratings, p.name);
    r.rated[p === black ? BLACK : WHITE] = { type: r.type, rating: { ...rt }, delta };
    ctx.send(p, { t: 'rated', type: r.type, rating: { ...rt }, delta });
    ctx.log('info', 'rating.changed', { playerId: p.id, roomId: r.id, gameId: r.gameId, before, after: rt.points });
  };
  apply(black, blackRating, gain, blackScore);
  apply(white, whiteRating, -gain, 1 - blackScore);
}

/**
 * 排位赛的段位结算（Elo，整改项 P2-12 自 rooms.ts 拆出）：由结算前的双方段位算出结算结果（纯函数，供存放处在事务内调用），
 * 结算后更新双方在线玩家的段位并通知双方。
 */
import { BLACK, WHITE } from '../src/core/types';
import type { Rating, Ratings } from '../src/shared/protocol';
import type { Player, RatedPair, RatedSide, Room, ServerContext } from './roomTypes';

const ELO_K = 32;
/** Elo 期望得分公式 1 / (1 + 10^(分差 / 400)) 中的底数与分差尺度 */
const ELO_BASE = 10,
  ELO_SCALE = 400;
/** 和棋的得分（胜 1、负 0） */
const DRAW_SCORE = 0.5;

/** 棋类在段位记录中的键：0 五子棋、1 围棋 */
export const typeKey = (type: number) => (type ? 'go' : 'gomoku') as keyof Ratings;

/** 一方的段位分与胜负局数随得分（1 胜、0 负、0.5 和）变化；段位分不低于 0 */
function apply(rating: Rating, delta: number, score: number): RatedSide {
  return {
    rating: {
      points: Math.max(0, rating.points + delta),
      win: rating.win + (score === 1 ? 1 : 0),
      loss: rating.loss + (score === 0 ? 1 : 0),
      draw: rating.draw + (score === DRAW_SCORE ? 1 : 0),
    },
    before: rating.points,
    delta,
  };
}

/** Elo 结算：由结算前的双方段位与胜方（1 黑、2 白、3 和）算出双方结算后的段位与变化；胜方至少加 1 分、负方至少扣 1 分 */
export function elo(black: Rating, white: Rating, winner: number): RatedPair {
  const blackExpected = 1 / (1 + ELO_BASE ** ((white.points - black.points) / ELO_SCALE));
  const blackScore = winner === BLACK ? 1 : winner === WHITE ? 0 : DRAW_SCORE;
  let gain = Math.round(ELO_K * (blackScore - blackExpected));
  if (blackScore === 1) gain = Math.max(1, gain);
  if (blackScore === 0) gain = Math.min(-1, gain);
  return { black: apply(black, gain, blackScore), white: apply(white, -gain, 1 - blackScore) };
}

/** 结算后：更新双方在线玩家的段位，记下这一局的结算（重连时补发），并通知双方 */
export function announceRated(ctx: ServerContext, r: Room, rated: RatedPair) {
  const k = typeKey(r.type);
  const notify = (color: number, side: RatedSide) => {
    const p: Player | null = r.who[color] ?? null;
    if (!p) return;
    p.ratings[k] = { ...side.rating };
    r.rated[color] = { type: r.type, rating: { ...side.rating }, delta: side.delta };
    ctx.send(p, { t: 'rated', type: r.type, rating: { ...side.rating }, delta: side.delta });
    ctx.log('info', 'rating.changed', { playerId: p.id, roomId: r.id, gameId: r.gameId, before: side.before, after: side.rating.points });
  };
  notify(BLACK, rated.black);
  notify(WHITE, rated.white);
}

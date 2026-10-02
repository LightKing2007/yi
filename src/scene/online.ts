/**
 * 多人游戏页棋盘上的布置：两只棋罐是两个座位。
 * 匹配中 / 等好友时，天元向外荡开信号般的涟漪，空座位一圈圈发光；找到对手时一颗白子落在天元。
 * 名牌是界面层（DOM）里的文字，位置由这里算出。
 */
import { BLACK, WHITE } from '../core/types';
import type { Layout } from '../render/layout';
import type { Painter } from '../render/painter';
import { Phase, st } from '../online/client';
import { bowlPlace } from './bowls';

export function drawOnlineScene(p: Painter, L: Layout, now: number, k: number) {
  if (k <= 0.01) return;
  const waiting = st.phase === Phase.Queue || st.phase === Phase.Hosting,
    found = st.phase === Phase.Found;
  if (!waiting && !found) return;
  const W = L.board.w,
    cx = L.board.x + W / 2,
    cy = L.board.y + L.board.h / 2;

  p.blend('add');
  if (waiting) {
    for (let j = 0; j < 3; j++) {
      // 天元向外荡开的信号涟漪
      const u = (now / 2.4 + j / 3) % 1;
      p.fxRing(cx, cy, L.R + u * W * 0.46, Math.max(1.5, L.cell * 0.12 * (1 - u)), true, 0.45 * k * (1 - u) * (1 - u));
    }
    p.fxGlow(cx, cy, L.cell * 1.2, 0.4, 0.35 * k * (0.7 + 0.3 * Math.sin(now * 3)));
  }
  const seat = bowlPlace(L, 1, 1); // 对手的座位（白罐）
  const u = (now / 1.6) % 1;
  p.fxRing(seat.x, seat.y, seat.r * (1.02 + 0.18 * u), Math.max(1.5, seat.r * 0.03), true, (found ? 0.9 : 0.7) * k * (1 - u));
  if (found) p.fxGlow(cx, cy, L.cell * 2.2, 0.45, 0.5 * k * (0.75 + 0.25 * Math.sin(now * 4)));
  p.blend('alpha');

  if (found) {
    // 对手来了：一颗白子落在天元
    const d = Math.min(1, (now - st.foundAt) / 0.35),
      e = 1 - (1 - d) * (1 - d);
    p.stoneShadow(cx + L.R * (0.1 + 0.6 * (1 - e)), cy + L.R * (0.16 + 0.9 * (1 - e)), L.R, k * e);
    p.stone(cx, cy - (1 - e) * L.R * 1.2, L.R * (1 + 0.2 * (1 - e)), WHITE, 7, k * Math.min(1, d * 2));
  }
}

/** 名牌的位置：两只棋罐外侧（黑罐在上方，白罐在下方） */
export function seatPlates(L: Layout) {
  return [BLACK - 1, WHITE - 1].map(b => {
    const c = bowlPlace(L, b, 1);
    return { x: c.x, y: b === 0 ? c.y - c.r - 20 * L.u : c.y + c.r + 20 * L.u };
  });
}

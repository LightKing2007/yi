/** 悔棋的时光倒流，以及切换棋盘时旧棋子升起淡去 */
import { game, boardView } from '../app/state';
import { animK } from '../app/settings';
import { SWITCH_T, type RewindStone } from '../presentation/boardView';
import { MAXN, easeOut, smooth01 } from '../core/types';
import { layoutForN, pt, type Layout } from '../render/layout';
import type { Painter } from '../render/painter';

export const RW_RING_BASE = 0.3; // 倒放涟漪收拢的时长（悔棋音按它合成，变速时改音高）

export const switchK = (now: number) => Math.min(Math.max((now - boardView.switch.t0) / boardView.switch.dur, 0), 1);

const rwRing = () => RW_RING_BASE * animK();
const rwLift = () => 0.38 * animK();

/** 升起的进度：<0 尚未开始，>=1 已消失 */
const rewindLift = (r: RewindStone, now: number) => (now - r.t0 - rwRing() + 0.08) / rwLift();

/** 重新出现的棋子的淡入进度 0..1 */
export const appearK = (x: number, y: number, now: number) => Math.min(Math.max((now - boardView.appearT[x * MAXN + y]) / (0.3 * animK()), 0), 1);

export function drawRewindStones(p: Painter, L: Layout, now: number, shadows: boolean) {
  for (const r of boardView.rw) {
    let b = rewindLift(r, now);
    if (b >= 1) continue;
    b = Math.max(b, 0);
    const e = b * b,
      a = 1 - b * b * (3 - 2 * b),
      q = pt(L, r.x, r.y);
    if (shadows) p.stoneShadow(q.x + L.R * (0.1 + 0.5 * e), q.y + L.R * (0.16 + 0.8 * e), L.R, a / (1 + 2 * e));
    else p.stone(q.x, q.y - L.R * 0.9 * e, L.R * (1 + 0.12 * e), r.c, boardView.seed[r.x * MAXN + r.y], a);
  }
}

/** 切换棋盘时的旧棋子：由中心向外依次升起、放大、淡去 */
export function drawSwitchStones(p: Painter, L: Layout, now: number, shadows: boolean) {
  const sk = switchK(now),
    sw = boardView.switch;
  if (sk >= 1) return;
  const N = sw.N,
    Lo = layoutForN(L, N),
    c = (N - 1) / 2;
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++) {
      const s = sw.b[x * MAXN + y];
      if (!s) continue;
      const d = Math.hypot(x - c, y - c) / (N * 0.72);
      const b = Math.max((sk * SWITCH_T - d * 0.3) / 0.36, 0);
      if (b >= 1) continue;
      const e = b * b,
        a = 1 - smooth01(b),
        q = pt(Lo, x, y);
      if (shadows) p.stoneShadow(q.x + Lo.R * (0.1 + 0.5 * e), q.y + Lo.R * (0.16 + 0.8 * e), Lo.R, a / (1 + 2 * e));
      else p.stone(q.x, q.y - Lo.R * 0.8 * e, Lo.R * (1 + 0.14 * e), s, sw.seed[x * MAXN + y], a);
    }
}

/** 倒放的涟漪：由外向内收拢，越收越亮，碰到棋子时一闪 */
function rewindRing(p: Painter, cx: number, cy: number, R: number, a: number, strength: number) {
  if (a < 0 || a > 1.4) return;
  const ringR = R * 1.105,
    ringW = Math.max(1.6, R * 0.055);
  if (a < 1) p.fxRing(cx, cy, ringR * (1 + easeOut(1 - a) * 2.4), ringW * (0.55 + 0.45 * a), false, strength * 0.8 * Math.pow(a, 1.7));
  else {
    p.blend('add');
    p.fxGlow(cx, cy, R * 1.4, 0.2, strength * 0.6 * Math.exp(-(a - 1) * 10));
    p.blend('alpha');
  }
}

export function drawRewindOver(p: Painter, L: Layout, now: number) {
  const g = game;
  for (const r of boardView.rw) {
    const q = pt(L, r.x, r.y);
    rewindRing(p, q.x, q.y, L.R, (now - r.t0) / rwRing(), 1);
  }
  for (let x = 0; x < g.N; x++)
    for (let y = 0; y < g.N; y++) {
      const at = boardView.appearT[x * MAXN + y];
      if (g.b(x, y) && at > now - 1) {
        const q = pt(L, x, y);
        rewindRing(p, q.x, q.y, L.R, (now - at + 0.25) / 0.25, 0.6);
      }
    }
}

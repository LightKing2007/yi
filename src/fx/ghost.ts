/** 落子预览：带惯性、自动吸附交叉点的跟随棋子 */
import { game } from '../app/state';
import { settings } from '../app/settings';
import type { Layout } from '../render/layout';
import type { Painter } from '../render/painter';

const ghost = { x: 0, y: 0, vx: 0, vy: 0, alpha: 0, color: 1 };   // 位置以格为单位，相对棋盘原点

/** 磁吸：离交叉点越近吸得越紧，到两点正中时恰好连续过渡，所以跟随是无级的 */
function magnet(u: number) {
  const n = Math.floor(u + 0.5), d = (u - n) * 2;
  return n + 0.5 * Math.sign(d) * Math.pow(Math.abs(d), 6);
}

/** active：鼠标在棋盘上且轮到人落子；empty：吸附点可落子 */
export function ghostUpdate(L: Layout, mx: number, my: number, dt: number, active: boolean, empty: boolean) {
  const g = game;
  const m = { x: Math.min(Math.max((mx - L.ox) / L.cell, 0), g.N - 1), y: Math.min(Math.max((my - L.oy) / L.cell, 0), g.N - 1) };
  const target = { x: magnet(m.x), y: magnet(m.y) };
  const show = active && empty && ghost.color === g.cur.toMove;
  if (ghost.alpha < 0.01) {
    ghost.color = g.cur.toMove;
    if (active) { ghost.x = target.x; ghost.y = target.y; ghost.vx = ghost.vy = 0; }   // 隐藏时直接就位
  }
  ghost.alpha += ((show ? 1 : 0) - ghost.alpha) * (1 - Math.exp(-dt * (show ? 14 : 20)));
  // 略欠阻尼的弹簧，带一点点过冲的惯性感；小步长积分保证稳定
  const f = settings.value.follow, w = f === 0 ? 14 : f === 2 ? 42 : 24, zeta = 0.68;
  for (let left = dt; left > 0; left -= 1 / 240) {
    const h = Math.min(left, 1 / 240);
    ghost.vx += (w * w * (target.x - ghost.x) - 2 * zeta * w * ghost.vx) * h;
    ghost.vy += (w * w * (target.y - ghost.y) - 2 * zeta * w * ghost.vy) * h;
    ghost.x += ghost.vx * h;
    ghost.y += ghost.vy * h;
  }
}

export function drawGhost(p: Painter, L: Layout) {
  if (ghost.alpha < 0.01) return;
  const cx = L.ox + ghost.x * L.cell, cy = L.oy + ghost.y * L.cell;
  const lift = Math.min(1, Math.hypot(ghost.vx, ghost.vy) / 12);   // 移动时微微“提起”：变小、影子拉开
  const R = L.R * (1 - 0.06 * lift);
  p.stoneShadow(cx + R * (0.1 + 0.25 * lift), cy + R * (0.16 + 0.35 * lift), R, ghost.alpha * (0.18 + 0.1 * lift));
  p.stone(cx, cy, R, ghost.color, 11, ghost.alpha * 0.45);
}

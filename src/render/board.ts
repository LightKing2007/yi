/** 棋盘：木面、网格星位、棋子与各种覆盖效果的绘制顺序 */
import { game } from '../app/state';
import { animK, settings } from '../app/settings';
import { BLACK, EMPTY, GameType, MAXN, easeOut, smooth01 } from '../core/types';
import { blowing, buildDebris, drawDebris, staysOnBoard } from '../fx/blow';
import { winClock } from '../fx/fx';
import { drawGhost } from '../fx/ghost';
import { drawGoEndOver, drawGoEndUnder, goArrival, goDeadFade, goWinPop } from '../fx/goEnd';
import { drawWinOver, drawWinUnder, winDelay, winIndex } from '../fx/gomokuWin';
import { appearK, drawRewindOver, drawRewindStones, drawSwitchStones, switchK } from '../fx/rewind';
import { goEndClock } from '../fx/fx';
import { rgba } from './gl';
import { layoutForN, pt, type Layout } from './layout';
import type { Painter } from './painter';
import { theme } from './theme';

const STARS: Record<number, number[]> = { 19: [3, 9, 15], 15: [3, 7, 11], 13: [3, 6, 9], 9: [2, 4, 6] };

/** 网格线与星位；alpha 用于切换棋盘时的淡入淡出 */
function drawGrid(p: Painter, L: Layout, N: number, alpha: number) {
  if (alpha <= 0.002) return;
  const dpr = p.g.dpr * p.g.scaleNow;
  const line = rgba(44, 28, 14, 210 * alpha);
  const lw = Math.max(1, Math.round(L.cell * 0.024 * dpr)) / dpr;
  const bw = Math.max(2, Math.round(L.cell * 0.045 * dpr)) / dpr;
  const x0 = L.ox, y0 = L.oy, x1 = L.ox + (N - 1) * L.cell, y1 = L.oy + (N - 1) * L.cell;
  for (let i = 0; i < N; i++) {
    const t = i === 0 || i === N - 1 ? bw : lw;
    const px = Math.round((L.ox + i * L.cell - t / 2) * dpr) / dpr;
    const py = Math.round((L.oy + i * L.cell - t / 2) * dpr) / dpr;
    p.rect(px, y0 - bw / 2, t, y1 - y0 + bw, line);
    p.rect(x0 - bw / 2, py, x1 - x0 + bw, t, line);
  }
  const v = STARS[N];
  if (!v) return;
  const r = Math.max(2.4 * L.u, L.cell * 0.085);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (N !== 19 && (i === 1) !== (j === 1)) continue;   // 9、13、15 路只有四角与天元
    const q = pt(L, v[i], v[j]);
    p.circle(q.x, q.y, r, line);
  }
}

export const boardRadius = (L: Layout) => Math.max(3, L.board.w * 0.006);

export function drawBoard(p: Painter, L: Layout, now: number) {
  const g = game, N = g.N, s = settings.value, AK = animK();
  const radius = boardRadius(L), top = L.board;
  const slab = { x: top.x, y: top.y + L.thick * 0.5, w: top.w, h: top.h + L.thick * 0.5 };

  // 投影与棋盘厚度（侧面）
  const sa = theme().boardShadow;
  p.softShadow({ x: top.x + 4, y: top.y + L.thick + top.h * 0.03, w: top.w - 8, h: top.h }, radius * 4, top.w * 0.045, rgba(20, 12, 4, 255 * sa * 0.75));
  p.softShadow({ x: top.x + 1, y: top.y + L.thick * 0.9, w: top.w - 2, h: top.h }, radius * 2, Math.max(3, L.thick * 0.5), rgba(20, 12, 4, 255 * Math.min(1, sa * 1.4)));
  p.roundRect(slab.x, slab.y, slab.w, slab.h, radius * 2, rgba(150, 108, 62));
  p.gradV(slab.x + radius, top.y + top.h - 2, slab.w - 2 * radius, slab.y + slab.h - (top.y + top.h) + 1, rgba(176, 128, 76), rgba(128, 88, 48));

  // 木面
  p.image(p.boardTex, top.x, top.y, top.w, top.h);

  // 网格：切换棋盘时旧网格淡出，新网格从略大处收拢淡入
  const sk = switchK(now);
  if (sk < 1 && g.switch.N !== N) {
    drawGrid(p, layoutForN(L, g.switch.N), g.switch.N, 1 - smooth01(sk / 0.55));
    const an = smooth01((sk - 0.3) / 0.7), sc = 1.035 - 0.035 * an;
    const bc = { x: top.x + top.w / 2, y: top.y + top.h / 2 };
    p.g.push(); p.g.translate(bc.x, bc.y); p.g.scale(sc); p.g.translate(-bc.x, -bc.y);
    drawGrid(p, L, N, an);
    p.g.pop();
  } else drawGrid(p, L, N, 1);

  // 棋子：先画全部阴影，再画棋子
  const R = L.R, blow = blowing();
  buildDebris(L, now);
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
    const st = g.b(x, y), i = x * MAXN + y;
    if (!st || (blow && !staysOnBoard(x, y))) continue;
    const k = easeOut((now - g.placeT[i]) / (0.22 * AK));
    let alive = (g.dead[i] ? 0.35 : 1) * appearK(x, y, now);
    const dk = goDeadFade(x, y, now);
    if (dk >= 1) continue;
    const q = pt(L, x, y);
    const lift = (1 - k) * R * 0.55 + (dk > 0 ? easeOut(dk) * R * 0.8 : 0);
    if (dk > 0) alive *= 1 - dk;
    p.stoneShadow(q.x + R * 0.1 + lift * 0.6, q.y + R * 0.16 + lift, R * (1 + (1 - k) * 0.15), k * alive);
  }
  for (const f of g.fades) {
    let k = (now - f.t0) / (0.32 * AK);
    if (k >= 1 || k < -0.5) continue;
    k = Math.max(k, 0);
    const q = pt(L, f.x, f.y);
    p.stoneShadow(q.x + R * 0.1, q.y + R * 0.16, R, (1 - k) * 0.9);
  }
  drawDebris(p, L, true, false);
  drawRewindStones(p, L, now, true);
  drawSwitchStones(p, L, now, true);
  drawWinUnder(p, L, now);
  drawGoEndUnder(p, L, now);

  const wt = winClock(now);
  for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
    const st = g.b(x, y), i = x * MAXN + y;
    if (!st || (blow && !staysOnBoard(x, y))) continue;
    const k = easeOut((now - g.placeT[i]) / (0.22 * AK));
    const q = pt(L, x, y);
    let sc = 1 + (1 - k) * 0.1;
    const wi = wt >= 0 && s.fx >= 1 ? winIndex(x, y) : -1;
    if (wi >= 0) {                                       // 连珠棋子依次轻弹
      const u = (wt - winDelay(wi)) / 0.32;
      if (u > 0 && u < 1) sc *= 1 + 0.14 * Math.sin(u * Math.PI) * (1 - u);
    }
    const dk = goDeadFade(x, y, now), ap = appearK(x, y, now);
    if (dk >= 1) continue;
    let up = (1 - k) * R * 0.12, alpha = Math.min(1, k * 2.2) * (g.dead[i] ? 0.42 : 1) * ap;
    if (dk > 0) { up += easeOut(dk) * R * 0.8; sc *= 1 + 0.2 * dk; alpha *= 1 - dk; }   // 死子升起化去
    sc *= goWinPop(x, y, now) * (0.94 + 0.06 * easeOut(ap));
    const mark = s.lastMark && x === g.cur.lastX && y === g.cur.lastY && k > 0.6;
    p.stone(q.x, q.y - up, R * sc, st, g.seed[i], alpha, mark);
  }
  for (const f of g.fades) {
    let k = (now - f.t0) / (0.32 * AK);
    if (k >= 1 || k < -0.5) continue;
    k = Math.max(k, 0);
    const q = pt(L, f.x, f.y);
    p.stone(q.x, q.y, R * (1 - 0.06 * k), f.c, 90, 1 - easeOut(k));
  }
  drawGhost(p, L);
  drawDebris(p, L, false, false);
  drawRewindStones(p, L, now, false);
  drawSwitchStones(p, L, now, false);
  drawWinOver(p, L, now);
  drawRewindOver(p, L, now);

  // 禁手点：轮到（人执的）黑棋时，在每个禁手点上画一个暗红色的小叉
  if (g.type === GameType.Gomoku && g.renju && !g.over && g.cur.toMove === BLACK && !g.aiToMove()) {
    const sz = R * 0.55, t = Math.max(1.5, R * 0.1), red = rgba(176, 52, 40, 200);
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
      if (g.b(x, y) !== EMPTY || !g.forbiddenAt(x, y)) continue;
      const q = pt(L, x, y);
      p.rectC(q.x, q.y, sz * 2, t, 45, red);
      p.rectC(q.x, q.y, sz * 2, t, -45, red);
    }
  }

  // 终局领地
  if (g.scoring || g.finished) {
    const gt = goEndClock(now);
    for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) {
      const o = g.terr[x * MAXN + y];
      if (!o) continue;
      const q = pt(L, x, y);
      let sz = R * 0.44;
      if (gt >= 0 && s.fx >= 1) {                         // 揭晓时被冲击波扫到的领地标记一跳
        const u = (gt - goArrival(x, y)) / 0.4;
        if (u > 0 && u < 1) sz *= 1 + 0.7 * Math.sin(u * Math.PI) * (1 - u);
      }
      const rr = sz * 0.25;
      if (o === BLACK) p.roundRect(q.x - sz / 2, q.y - sz / 2, sz, sz, rr, rgba(22, 22, 24, 225));
      else {
        p.roundRect(q.x - sz / 2, q.y - sz / 2, sz, sz, rr, rgba(246, 244, 238, 240));
        p.roundRectLine(q.x - sz / 2, q.y - sz / 2, sz, sz, rr, rgba(60, 40, 20, 110));
      }
    }
  }
  drawGoEndOver(p, L, now);
}

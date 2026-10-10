/**
 * 从对局返回菜单时，盘上的棋子依次飞回各自的棋罐（黑子回黑罐、白子回白罐）。
 * 离罐近的先飞，一颗颗划出一道弧线、微微翻转，边飞边缩小到罐中棋子的大小，落进正在移回盘上的棋罐里。
 */
import { game, boardView } from '../app/state';
import { sfx } from '../audio';
import { BLACK } from '../core/types';
import { layoutForN, pt, type Layout } from '../render/layout';
import { rotAxis, type Painter } from '../render/painter';
import { BOWL_SR, bowlPlace } from '../scene/bowls';
import { blowing, staysOnBoard } from './blow';
import { rnd } from './fx';

const GATHER_FLY = 0.75; // 单颗棋子的飞行时长
const GATHER_SPREAD = 0.6; // 第一颗与最后一颗起飞的时间差

interface GatherStone {
  x: number;
  y: number;
  c: number;
  seed: number;
  landed: boolean;
  delay: number;
  tx: number;
  ty: number;
  tilt: number;
  ang: number;
}

const gather = { t0: -100, N: 15, s: [] as GatherStone[], lastClick: 0 };

export function startGather(now: number) {
  const g = game;
  gather.t0 = now;
  gather.N = g.N;
  gather.s = [];
  gather.lastClick = 0;
  const blown = blowing() && boardView.blowView > 0.5; // 已经被炸飞的棋子不在盘上，不必收
  let maxd = 1e-3;
  for (let x = 0; x < g.N; x++)
    for (let y = 0; y < g.N; y++) {
      const c = g.b(x, y);
      if (!c || (blown && !staysOnBoard(x, y))) continue;
      const u = (x + 0.5) / g.N,
        v = (y + 0.5) / g.N;
      const bu = c === BLACK ? 0.31 : 0.69,
        bv = c === BLACK ? 0.33 : 0.67;
      const d = Math.hypot(u - bu, v - bv);
      maxd = Math.max(maxd, d);
      const a = rnd(0, 6.2832),
        r = Math.sqrt(Math.random()) * 0.45;
      gather.s.push({
        x,
        y,
        c,
        seed: boardView.seedAt(x, y),
        landed: false,
        delay: d,
        tx: Math.cos(a) * r,
        ty: Math.sin(a) * r,
        tilt: rnd(0.3, 0.9) * (Math.random() < 0.5 ? -1 : 1),
        ang: rnd(0, 6.2832),
      });
    }
  for (const s of gather.s) s.delay = (s.delay / maxd) * GATHER_SPREAD + rnd(0, 0.06);
}

export function drawGather(p: Painter, L: Layout, now: number, bowlK: number) {
  if (!gather.s.length) return;
  const t = now - gather.t0;
  if (t > GATHER_SPREAD + GATHER_FLY + 0.2) {
    gather.s = [];
    return;
  }
  const Lo = layoutForN(L, gather.N);
  for (let pass = 0; pass < 2; pass++) {
    // 先画全部影子，再画棋子
    for (const o of gather.s) {
      const u = (t - o.delay) / GATHER_FLY;
      if (u >= 1) {
        if (!o.landed && pass) {
          // 落进罐里的轻响，太密时合并
          o.landed = true;
          if (now - gather.lastClick > 0.045) {
            sfx.clack(0.28);
            gather.lastClick = now;
          }
        }
        continue;
      }
      const start = pt(Lo, o.x, o.y),
        bc = bowlPlace(L, o.c === BLACK ? 0 : 1, bowlK);
      const target = { x: bc.x + o.tx * bc.r, y: bc.y + o.ty * bc.r };
      const k = Math.max(u, 0),
        e = k * k * (3 - 2 * k);
      const z = Math.sin(k * Math.PI) * 1.6; // 抛起的高度（以棋子半径计）
      const R = Lo.R + (bc.r * BOWL_SR - Lo.R) * e;
      const gx = start.x + (target.x - start.x) * e,
        gy = start.y + (target.y - start.y) * e;
      const alpha = k < 0.85 ? 1 : 1 - (k - 0.85) / 0.15;
      if (!pass) {
        p.stoneShadow(gx + R * (0.1 + 0.4 * z), gy + R * (0.16 + 0.6 * z), R, alpha / (1 + z));
        continue;
      }
      const px = gx,
        py = gy - z * Lo.R * 0.6,
        r = R * (1 + 0.18 * z);
      if (k <= 0) {
        p.stone(px, py, r, o.c, o.seed, 1);
        continue;
      }
      p.stone3D(px, py, r, o.c, o.seed, alpha, rotAxis(Math.cos(o.ang), Math.sin(o.ang), 0, o.tilt * Math.sin(k * Math.PI)));
    }
  }
}

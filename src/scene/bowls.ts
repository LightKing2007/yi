/** 开始菜单：棋盘上斜放的两只棋罐，开始游戏后缓缓移出。罐与罐中几百颗棋子只在尺寸变化时烘焙成贴图 */
import { BLACK, WHITE } from '../core/types';
import type { RenderTarget } from '../render/gl';
import type { Layout } from '../render/layout';
import { rotAxis, type Painter } from '../render/painter';

export const BOWL_SR = 0.125; // 罐中棋子半径（占罐半径的比例）
const BOWL_MAX = 160;
const BAKE_PAD = 4;

interface BowlStone {
  x: number;
  y: number;
  z: number;
  tilt: number;
  ang: number;
  seed: number;
}
const piles: BowlStone[][] = [[], []];

/** 罐里堆起的棋子：分三层，底层铺满罐底，上面两层越往上越集中在中间，按高度排序 */
function genPiles() {
  let rs = 20240917;
  const lcg = () => {
    rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0;
    return (rs >>> 8) / 16777216;
  };
  const layerR = [1, 0.78, 0.5],
    layerZ = [0, 0.55, 1.05];
  for (let b = 0; b < 2; b++) {
    const out: BowlStone[] = [];
    const lim = 0.8 - BOWL_SR * 1.05;
    for (let layer = 0; layer < 3; layer++) {
      const first = out.length;
      for (let tries = 0; tries < 5000 && out.length < BOWL_MAX; tries++) {
        const a = lcg() * 6.2832,
          d = Math.sqrt(lcg()) * lim * layerR[layer];
        const x = Math.cos(a) * d,
          y = Math.sin(a) * d;
        let ok = true;
        for (let k = first; k < out.length && ok; k++) {
          // 只和同一层比，层与层之间自然叠压
          const dx = x - out[k].x,
            dy = y - out[k].y;
          ok = dx * dx + dy * dy >= (BOWL_SR * 1.4) ** 2;
        }
        if (!ok) continue;
        const q = d / lim,
          rz = lcg(),
          rt = lcg(),
          rsd = lcg();
        out.push({ x, y, z: layerZ[layer] + (1 - q * q) * 0.5 + rz * 0.2, tilt: q * 0.5 + (rt - 0.5) * 0.35, ang: a, seed: Math.floor(rsd * 255) });
      }
    }
    out.sort((p, q) => p.z - q.z);
    piles[b] = out;
  }
}
genPiles();

/** 第 b 只罐（0 黑、1 白）此刻的中心、半径与提起程度。k：1 两只罐斜放在盘上，0 已完全移出 */
export function bowlPlace(L: Layout, b: number, k: number) {
  const e = k * k * (3 - 2 * k),
    W = L.board.w,
    Rb = W * 0.19;
  const home = b ? { x: L.board.x + W * 0.69, y: L.board.y + W * 0.67 } : { x: L.board.x + W * 0.31, y: L.board.y + W * 0.33 };
  const away = b ? { x: 0.8, y: 0.6 } : { x: -0.8, y: -0.6 };
  const lift = 4 * e * (1 - e) * 0.5;
  return { x: home.x + away.x * (W + Rb) * (1 - e), y: home.y + away.y * (W + Rb) * (1 - e), r: Rb * (1 + 0.06 * lift), lift };
}

export class Bowls {
  private rt: (RenderTarget | null)[] = [null, null];
  private px = 0;
  constructor(private p: Painter) {}

  /** 在一帧开画之前调用：尺寸变了就重新烘焙两只罐 */
  prepare(L: Layout) {
    const Rb = bowlPlace(L, 0, 1).r,
      g = this.p.g;
    const px = Math.ceil(2 * Rb * 1.03 * g.dpr) + 2 * BAKE_PAD;
    if (this.rt[0] && Math.abs(px - this.px) <= 1) return;
    for (let b = 0; b < 2; b++) {
      this.rt[b] = g.createTarget(px, px, this.rt[b]);
      g.begin(this.rt[b], [0, 0, 0, 0]);
      this.drawBody(px / 2, px / 2, px / 2 - BAKE_PAD, b);
      g.end();
    }
    this.px = px;
  }

  /** 罐体、逐颗棋子（带影子，立体着色）、罐口挡光的阴影 */
  private drawBody(cx: number, cy: number, Rb: number, b: number) {
    const p = this.p,
      g = p.g;
    g.use(p.bowl);
    g.quad(cx - Rb, cy - Rb, 2 * Rb, 2 * Rb, [0, (b ? 140 : 40) / 255, 0, 1]);
    const color = b ? WHITE : BLACK;
    for (const o of piles[b]) {
      const x = cx + o.x * Rb,
        y = cy + o.y * Rb,
        r = Rb * BOWL_SR * (1 + 0.07 * o.z);
      p.stoneShadow(x + r * 0.1, y + r * 0.16, r, 0.6);
      p.stone3D(x, y, r, color, o.seed, 1, rotAxis(-Math.sin(o.ang), -Math.cos(o.ang), 0, o.tilt));
    }
    g.use(p.bowl);
    g.quad(cx - Rb, cy - Rb, 2 * Rb, 2 * Rb, [80 / 255, 0, 0, 1]);
  }

  draw(L: Layout, k: number) {
    if (k <= 0.001 || !this.rt[0]) return;
    const p = this.p;
    for (let b = 0; b < 2; b++) {
      const c = bowlPlace(L, b, k);
      p.stoneShadow(c.x + c.r * (0.07 + 0.25 * c.lift), c.y + c.r * (0.11 + 0.35 * c.lift), c.r * 1.03, 1 / (1 + 1.5 * c.lift));
      const half = (c.r * (this.px / 2)) / (this.px / 2 - BAKE_PAD);
      p.image(this.rt[b]!.tex, c.x - half, c.y - half, 2 * half, 2 * half, 1, true);
    }
  }
}

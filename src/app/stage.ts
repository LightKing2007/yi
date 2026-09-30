/**
 * 舞台：每帧的场景更新与绘制顺序。两张画布夹着界面：
 *   下层 scene：背景 → 棋盘（含棋子与盘面特效，随震屏）→ 创建房间的布置 → 棋罐 → 飞回棋罐的棋子 → 房间地图 → 光影
 *   上层 over（不接收鼠标）：飞在空中的棋子（可以盖住界面）→ 粒子的本体 → 暗角
 *   最上层 glow（黑底、滤色叠加）：粒子发光的内核、冲击时的闪光
 */
import { settings } from './settings';
import { bowlsShown, game, screen, Screen, view, boardView } from './state';
import { smooth01 } from '../core/types';
import { clearParticles, drawFlash, drawParticles, updateParticles, winShake } from '../fx/fx';
import { buildDebris, drawDebris } from '../fx/blow';
import { drawGather } from '../fx/gather';
import { goEndUpdate } from '../fx/goEnd';
import { winUpdate } from '../fx/gomokuWin';
import { Gfx } from '../render/gl';
import { boardRadius, drawBoard } from '../render/board';
import type { Layout } from '../render/layout';
import { Painter } from '../render/painter';
import { theme } from '../render/theme';
import { Bowls } from '../scene/bowls';
import { Light } from '../scene/light';
import { drawOnlineScene } from '../scene/online';

/** 把 v 以每秒 1/seconds 的速度线性推向 target */
const approach = (v: number, target: number, dt: number, seconds: number) => {
  const step = dt / seconds;
  return target > v ? Math.min(target, v + step) : Math.max(target, v - step);
};

export class Stage {
  readonly ps: Painter;
  readonly po: Painter;
  readonly pg: Painter;
  readonly bowls: Bowls;
  readonly light: Light;
  /** ≥0 时直接指定光影强度，否则按设置与所在界面 */
  lightOverride = -1;

  constructor(sceneCanvas: HTMLCanvasElement, overCanvas: HTMLCanvasElement, glowCanvas: HTMLCanvasElement) {
    this.ps = new Painter(new Gfx(sceneCanvas, { alpha: false }));
    this.po = new Painter(new Gfx(overCanvas));
    this.pg = new Painter(new Gfx(glowCanvas, { alpha: false }));
    this.bowls = new Bowls(this.ps);
    this.light = new Light(this.ps);
  }

  resize(w: number, h: number, dpr: number) {
    this.ps.g.resize(w, h, dpr);
    this.po.g.resize(w, h, dpr);
    this.pg.g.resize(w, h, dpr);
  }

  update(L: Layout, now: number, dt: number) {
    const g = game, scr = screen.value;
    winUpdate(L, now, dt);
    goEndUpdate(L, now, dt);
    updateParticles(now, dt);
    view.onlineK = approach(view.onlineK, scr === Screen.Online ? 1 : 0, dt, 0.5);
    boardView.blowView = approach(boardView.blowView, boardView.review ? 0 : 1, dt, 0.75);        // 查看 / 收起棋局
    if (boardView.undoPending && boardView.blowView <= 0.001) g.undo();                   // 棋子已飞回原位，再悔棋
    view.bowlK = approach(view.bowlK, bowlsShown(scr) ? 1 : 0, dt, 1.2);  // 棋罐缓缓移出 / 移回
    view.duskK += ((settings.value.light ? 1 : 0) - view.duskK) * (1 - Math.exp(-dt * 4));
  }

  /** 光影的强度：全局都有，对局中稍淡一些（七成），免得影响看棋 */
  lightK() {
    if (this.lightOverride >= 0) return this.lightOverride;
    return view.duskK * (0.7 + 0.3 * smooth01(view.bowlK));
  }

  /** 离屏贴图都在开画之前准备好 */
  prepare(L: Layout, now: number) {
    const g = this.ps.g;
    this.light.prepare(L, g.vw, g.vh, now, this.lightK(), settings.value.light);
    this.bowls.prepare(L);
    this.ps.prepareBoard(L.board.w, L.board.h, boardRadius(L));
  }

  draw(L: Layout, now: number) {
    const p = this.ps, g = p.g, W = g.vw, H = g.vh, th = theme();
    const sh = winShake(L, now);
    const pushShake = (gg: Gfx) => {
      const bc = { x: L.board.x + L.board.w / 2, y: L.board.y + L.board.h / 2 };
      gg.push(); gg.translate(bc.x + sh.x, bc.y + sh.y); gg.rotate(sh.rot); gg.scale(sh.scale); gg.translate(-bc.x, -bc.y);
    };

    g.begin(null, [th.bgBot[0], th.bgBot[1], th.bgBot[2], 1]);
    p.background(W, H, th.bgTop, th.bgBot);
    pushShake(g);
    drawBoard(p, L, now);
    g.pop();
    drawOnlineScene(p, L, now, view.onlineK);
    this.bowls.draw(L, view.bowlK);
    drawGather(p, L, now, view.bowlK);
    this.light.draw(W, H, this.lightK());
    g.end();

    const o = this.po, og = o.g;
    og.begin(null, [0, 0, 0, 0]);
    pushShake(og);
    drawDebris(o, L, true, true);
    drawDebris(o, L, false, true);
    og.pop();
    const gg = this.pg.g;
    gg.begin(null, [0, 0, 0, 1]);
    drawParticles(o, this.pg, now);
    drawFlash(o, this.pg, og.w, og.h, now);
    og.end();
    gg.end();
  }
}

export { buildDebris, clearParticles };

/**
 * 棋盘的画面状态：落子下落、提子淡出、悔棋倒放、换棋盘过渡、胜负动画的时刻、棋子纹理，以及屏幕上方的提示。
 * 作为 Game 的旁观者（GameListener）接收消息；规则状态（棋子、胜负、死子、地）仍在 Game 里，这里只管“怎么动”。
 */
import { animK } from '../app/settings';
import { now } from '../core/clock';
import type { GameListener } from '../core/game';
import type { Reject } from '../core/move';
import type { Applied } from '../core/rules';
import { BLACK, MAXN, at, newBoard, type Board, type Pos } from '../core/types';
import { rejectText } from '../shared/reject';

/** 屏幕上方的提示：文字表里的中文原文（显示时经 T() 翻译） */
export interface Flash { key: string }

export interface FadeStone { x: number; y: number; c: number; t0: number }
/** 悔棋时被收回、正在“倒放”升起消失的棋子 */
export interface RewindStone { x: number; y: number; c: number; t0: number }

/** 切换棋盘 / 新局的过渡：记下旧棋盘，旧棋子由中心向外依次升起淡去 */
export interface BoardSwitch { t0: number; N: number; b: Board; seed: Uint8Array }
export const SWITCH_T = 0.7;

export class BoardView implements GameListener {
  /** 每颗棋子落下的时刻（驱动下落动画） */
  placeT = new Float32Array(MAXN * MAXN).fill(-10);
  /** 悔棋时重新出现的棋子开始淡入的时刻 */
  appearT = new Float32Array(MAXN * MAXN).fill(-10);
  /** 每个交叉点上棋子的纹理种子 */
  seed = new Uint8Array(MAXN * MAXN);
  /** 被提走、正在淡出的棋子 */
  fades: FadeStone[] = [];
  /** 悔棋时收回、正在升起消失的棋子 */
  rw: RewindStone[] = [];
  switch: BoardSwitch = { t0: -100, N: 15, b: newBoard(), seed: new Uint8Array(MAXN * MAXN) };
  /** 五子连珠（或认输等结束时）的时刻，驱动胜利动画；0 表示无 */
  winT = 0;
  winBurst = 0;
  /** 胜利后其余棋子被炸飞；true = 让它们飞回原位以查看棋局 */
  review = false;
  /** 炸飞程度的动画值：1 炸飞，0 还原 */
  blowView = 1;
  /** 炸飞状态下悔棋：先让棋子飞回原位，再真正悔棋 */
  undoPending = false;
  /** 围棋确认结果（或认输等结束）的时刻，驱动“胜负揭晓”动画 */
  goEndT = 0;
  goBurst = 0;
  msg: Flash | null = null;
  msgAt = 0;
  /** 电脑最早可以落子的时刻（落子、悔棋、开局后稍等一下） */
  aiAt = 0;

  constructor() { this.reseed(); }

  private reseed() { for (let i = 0; i < this.seed.length; i++) this.seed[i] = (Math.random() * 256) | 0; }
  private clearEnd() { this.winT = 0; this.winBurst = 0; this.review = false; this.blowView = 1; this.goEndT = 0; this.goBurst = 0; this.undoPending = false; }

  flash(key: string) { this.msg = { key }; this.msgAt = now(); }

  // ---------------- GameListener ----------------

  reset(prevN: number, prevB: Board, t: number) {
    this.switch = { t0: t, N: prevN, b: prevB.slice(), seed: this.seed.slice() };
    this.fades = []; this.rw = [];
    this.clearEnd();
    this.placeT.fill(-10); this.appearT.fill(-10);
    this.reseed();
    this.msg = null;
    this.aiAt = t + 0.6;                                   // 玩家执白时电脑先行，稍等一下再落子
  }

  placed(x: number, y: number, color: number, v: Applied, t: number) {
    this.placeT[at(x, y)] = t;
    this.seed[at(x, y)] = (Math.random() * 256) | 0;
    if (v.line) { this.winT = t; this.winBurst = 0; this.review = false; this.blowView = 1; }
    for (const p of v.captured) if (this.fades.length < 512) this.fades.push({ x: p.x, y: p.y, c: 3 - color, t0: t + 0.08 });
  }

  passed(color: number, scoring: boolean, t: number) {
    if (scoring) this.msg = null;
    else this.flash(color === BLACK ? '黑方停一手' : '白方停一手');
    this.aiAt = t + 0.35;
  }

  /** 时光倒流：收回的棋子升起消失（最后一手先走），被提的子随后淡入，点目时化去的死子也回来 */
  undone(old: Pos, cur: Pos, wasFinished: boolean, dead: Uint8Array, t: number) {
    const k = animK();
    this.rw = [];
    for (let i = 0; i < old.b.length; i++) {
      const x = Math.floor(i / MAXN), y = i % MAXN;
      if (old.b[i] && !cur.b[i]) {
        if (this.rw.length < 8) this.rw.push({ x, y, c: old.b[i], t0: t + (x === old.lastX && y === old.lastY ? 0 : 0.14 * k) });
      } else if (!old.b[i] && cur.b[i]) this.appearT[i] = t + 0.3 * k;
      else if (wasFinished && dead[i]) this.appearT[i] = t;
    }
    this.clearEnd();
    this.fades = [];
    this.placeT.fill(-10);
    this.aiAt = t + 0.4;
  }

  scored(t: number) { this.goEndT = t; this.goBurst = 0; }

  forfeited(t: number) {
    this.winT = t; this.winBurst = 0; this.review = false; this.blowView = 1;   // 五子棋用
    this.goEndT = t; this.goBurst = 0;                                        // 围棋用
  }

  rejected(why: Reject) { this.flash(rejectText(why)); }

  /** 整局重建之后（联机重连、复盘）：不要逐手的动画，直接定格在最终局面 */
  settle() {
    this.placeT.fill(-10); this.appearT.fill(-10);
    this.fades = []; this.rw = [];
    this.switch.t0 = -100;
    this.msg = null;
  }
}

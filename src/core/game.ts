/**
 * 对局：在规则（rules/，纯函数）之上管理历史、棋谱、点目标记与胜负；向应用层发出事件（音效、清理特效由应用层处理）。
 * 规则判定都交给 rules/；动画状态在画面层（通过 listener 通知），服务端用的是同一个类、不挂 listener。
 */
import { now } from './clock';
import { gameConfig, type GameConfig } from './config';
import type { Move, Reject } from './move';
import type { MoveRec } from './record';
import { Renju } from './renju';
import { applyMove, forbiddenAt as rulesForbidden, group, score, type Applied } from './rules';
import { BLACK, EMPTY, GameType, MAXN, WHITE, at, newBoard, newPos, type Board, type Pos } from './types';

export type GameEvent = { type: 'stone'; strength: number } | { type: 'undo' } | { type: 'reset' };

export interface NewGameOptions {
  renju?: boolean;
}

/**
 * 对局的旁观者：画面层（presentation/boardView.ts）在这里接收落子、悔棋、终局等消息，驱动动画与提示。
 * 服务端不挂旁观者，所以 Game 里没有任何动画状态。t 为事件发生的时刻（clock.now()）。
 */
export interface GameListener {
  /** 开新局之前：旧棋盘（换棋盘的过渡动画用） */
  reset(prevN: number, prevB: Board, t: number): void;
  /** 落下一子；v 是规则层的结果（提子、连五） */
  placed(x: number, y: number, color: number, v: Applied, t: number): void;
  /** 停一手；scoring 表示因此进入点目 */
  passed(color: number, scoring: boolean, t: number): void;
  /** 悔棋：old 是悔棋前的局面，wasFinished / dead 是悔棋前的点目结果 */
  undone(old: Pos, cur: Pos, wasFinished: boolean, dead: Uint8Array, t: number): void;
  /** 围棋点目确认 */
  scored(t: number): void;
  /** 认输、超时、掉线、离开等不是下出来的胜负（有棋子时才有终局动画） */
  forfeited(t: number): void;
  /** 落子不合法（需要提示的那几种） */
  rejected(why: Reject): void;
}

export class Game {
  type = GameType.Gomoku;
  N = 15;
  goSize = 19;
  /** 本局五子棋是否执行黑棋禁手 */
  renju = true;
  cur: Pos = newPos();
  hist: Pos[] = [];
  /** 棋谱：走过的每一手（与 hist 一一对应） */
  moves: MoveRec[] = [];
  /** 最近一次落子不合法的原因 */
  lastReject: Reject | null = null;
  over = false;
  winner = 0; // 1 黑 2 白 3 和
  /** 连成的五子；认输等结束时是胜方最后一子 */
  win: { x: number; y: number }[] = [];
  forfeit = false; // 因认输、超时、离开而结束（且盘上有子）
  scoring = false;
  finished = false;
  dead = newBoard();
  terr = newBoard();
  scoreB = 0;
  scoreW = 0;
  komi = 7.5;
  /** 局面每变一次（落子、停着、悔棋、开新局、标记死子、恢复对局）就加一：电脑用它认出“这是不是我想的那个局面” */
  ver = 0;
  /** 画面层；服务端为 null */
  listener: GameListener | null = null;

  private events: GameEvent[] = [];
  private forbidCache = { stamp: -1, map: new Uint8Array(MAXN * MAXN) };

  /** 当前这局的规则设置 */
  get cfg(): GameConfig {
    return gameConfig(this.type, this.N, this.renju, this.komi);
  }

  constructor() {
    this.newGame(GameType.Gomoku, 15);
    this.events.length = 0;
  }

  pollEvent(): GameEvent | undefined {
    return this.events.shift();
  }
  eventMark() {
    return this.events.length;
  }
  eventRewind(mark: number) {
    if (mark >= 0 && mark < this.events.length) this.events.length = mark;
  }
  private push(e: GameEvent) {
    if (this.events.length < 16) this.events.push(e);
  }

  b(x: number, y: number) {
    return this.cur.b[x * MAXN + y];
  }
  inB(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.N && y < this.N;
  }

  newGame(type: GameType, N: number, opt: NewGameOptions = {}) {
    this.listener?.reset(this.N, this.cur.b, now());
    this.ver++;
    this.cur = newPos();
    this.type = type;
    this.N = N;
    if (type === GameType.Go) this.goSize = N;
    this.hist = [];
    this.moves = [];
    this.lastReject = null;
    this.over = false;
    this.winner = 0;
    this.win = [];
    this.forfeit = false;
    this.push({ type: 'reset' });
    this.scoring = this.finished = false;
    this.komi = 7.5;
    if (opt.renju !== undefined) this.renju = opt.renju;
    this.dead.fill(0);
    this.terr.fill(0);
  }

  /** 当前局面下黑棋在 (x, y) 是否为禁手（按局面缓存整盘） */
  forbiddenAt(x: number, y: number): Renju {
    if (this.type !== GameType.Gomoku || !this.renju || this.over || this.cur.toMove !== BLACK || !this.inB(x, y)) return Renju.Ok;
    let h = 2166136261;
    for (let i = 0; i < this.N; i++) for (let j = 0; j < this.N; j++) h = Math.imul(h ^ (this.cur.b[i * MAXN + j] ?? 0), 16777619) >>> 0;
    h = (h ^ Math.imul(this.N, 7919)) >>> 0;
    const c = this.forbidCache;
    if (h !== c.stamp) {
      c.stamp = h;
      const cfg = this.cfg,
        code: Record<string, Renju> = { 'renju-overline': Renju.Overline, 'renju-44': Renju.DoubleFour, 'renju-33': Renju.DoubleThree };
      for (let i = 0; i < this.N; i++)
        for (let j = 0; j < this.N; j++) {
          const why = rulesForbidden(cfg, this.cur, i, j);
          c.map[i * MAXN + j] = (why && code[why]) || Renju.Ok;
        }
    }
    return c.map[x * MAXN + y] ?? Renju.Ok;
  }

  /** 数子法：活子 + 只被一方包围的空点；白方加贴目 */
  computeScore() {
    const r = score(this.cfg, this.cur, this.dead);
    this.terr.set(r.terr);
    this.scoreB = r.b;
    this.scoreW = r.w;
  }

  /** 按规则走一手；合法则记入历史与棋谱，返回结果，否则记下原因返回 null */
  private step(m: Move): Applied | null {
    const r = applyMove(this.cfg, this.cur, m, this.hist.at(-1)?.b ?? null);
    if (!r.ok) {
      this.lastReject = r.why;
      return null;
    }
    this.lastReject = null;
    this.ver++;
    this.hist.push(this.cur);
    this.moves.push({ m });
    this.cur = r.v.pos;
    return r.v;
  }

  /** 落子；不合法返回 false（并给出提示，原因在 lastReject） */
  play(x: number, y: number): boolean {
    if (this.over) {
      this.lastReject = 'over';
      return false;
    }
    if (this.scoring) {
      this.lastReject = 'scoring';
      return false;
    }
    const c = this.cur.toMove;
    const v = this.step({ k: 'play', x, y });
    if (!v) {
      const why = this.lastReject!;
      if (why !== 'off-board' && why !== 'occupied') this.listener?.rejected(why);
      return false;
    }
    if (v.result) {
      this.over = true;
      this.winner = v.result.winner;
      if (v.line) this.win = v.line;
    }
    this.listener?.placed(x, y, c, v, now());
    this.push({ type: 'stone', strength: v.captured.length ? 1.0 : 0.9 });
    return true;
  }

  pass() {
    if (this.type !== GameType.Go || this.over || this.scoring) return;
    const who = this.cur.toMove,
      v = this.step({ k: 'pass' });
    if (!v) return;
    if (v.scoring) {
      this.scoring = true;
      this.dead.fill(0);
      this.computeScore();
    }
    this.listener?.passed(who, v.scoring, now());
  }

  /** 悔棋：退 steps 手（人机对弈时退几手由会话决定，见 session.undoSteps） */
  undo(steps = 1) {
    if (this.hist.length === 0) return;
    this.ver++;
    const old = this.cur,
      wasFinished = this.finished;
    for (let i = 0; i < steps && this.hist.length > 0; i++) {
      this.cur = this.hist.pop()!;
      this.moves.pop();
    }
    this.listener?.undone(old, this.cur, wasFinished, this.dead, now());
    if ([...old.b].some((v, i) => v && !this.cur.b[i])) this.push({ type: 'undo' });
    this.over = false;
    this.winner = 0;
    this.win = [];
    this.forfeit = false;
    this.push({ type: 'reset' });
    this.scoring = this.finished = false;
    this.dead.fill(0);
    this.terr.fill(0);
  }

  toggleDead(x: number, y: number) {
    this.ver++;
    if (!this.inB(x, y) || this.b(x, y) === EMPTY) return;
    const g = group(this.cur.b, this.N, x, y),
      v = this.dead[at(x, y)] ? 0 : 1;
    g.xs.forEach((gx, i) => (this.dead[at(gx, g.ys[i] ?? 0)] = v));
    this.computeScore();
    this.push({ type: 'stone', strength: 0.35 });
  }

  confirmScore() {
    this.scoring = false;
    this.finished = true;
    this.over = true;
    this.winner = this.scoreB > this.scoreW ? BLACK : WHITE;
    this.listener?.scored(now());
  }

  resume() {
    this.ver++;
    this.scoring = false;
    this.cur.passes = 0;
    this.dead.fill(0);
    this.terr.fill(0);
  }

  /** 胜方最后落下的一子（找不到就取天元） */
  private winnerLastStone(winner: number) {
    const cur = this.cur;
    if (cur.lastX >= 0 && cur.b[at(cur.lastX, cur.lastY)] === winner) return { x: cur.lastX, y: cur.lastY };
    for (let i = this.hist.length - 1; i >= 0; i--) {
      const after = this.hist[i + 1] ?? cur; // 最后一手之后的局面即当前局面
      const lx = after.lastX,
        ly = after.lastY;
      if (lx >= 0 && after.b[at(lx, ly)] === winner && cur.b[at(lx, ly)] === winner) return { x: lx, y: ly };
    }
    return { x: this.N >> 1, y: this.N >> 1 };
  }

  /** 不是下出来的胜负（认输、超时、掉线、离开）：结束对局并触发终局动画 */
  forfeitEnd(winner: number) {
    if (this.over && !this.scoring) return;
    let stones = 0;
    for (let x = 0; x < this.N; x++) for (let y = 0; y < this.N; y++) if (this.b(x, y)) stones++;
    this.over = true;
    this.winner = winner;
    if (winner !== BLACK && winner !== WHITE) return;
    if (!stones) return;
    this.forfeit = true;
    if (this.type === GameType.Gomoku) this.win = [this.winnerLastStone(winner)];
    else {
      this.scoring = false;
      this.dead.fill(0);
      this.terr.fill(0);
    }
    this.listener?.forfeited(now());
  }
}

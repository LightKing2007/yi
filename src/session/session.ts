/**
 * 对局会话：一局棋（Game）加两个座位（seats.ts）。三种模式只是座位的组合不同：
 *   local     双人对弈：黑白都是本机的人
 *   computer  人机对弈：一方是人，一方是电脑
 *   online    联机：自己是 RemoteSeat（落子先发给服务端），对方也是 RemoteSeat（本机不操作）
 * 界面与快捷键只问会话“现在该不该由本机的人落子、悔棋退几手”，不再各自判断模式。
 */
import type { Game } from '../core/game';
import { BLACK, GameType, WHITE } from '../core/types';
import type { BoardView } from '../presentation/boardView';
import { ComputerSeat, HumanSeat, RemoteSeat, type ComputerOptions, type Seat } from './seats';

export type Mode = 'local' | 'computer' | 'online';

/** 联机时由联机模块提供：自己执哪一方、怎样把落子与停一手发出去、此刻能不能落子（等对方回应申请时不能） */
export interface OnlineLink {
  mine: number;
  move(x: number, y: number): void;
  pass(): void;
  canMove(): boolean;
}

export class Session {
  mode: Mode = 'local';
  /** 单机时选的是双人还是人机（离开联机对局、开新局时按它来） */
  localMode: 'local' | 'computer' = 'local';
  private seats: Seat[] = [];
  private link: OnlineLink | null = null;
  private wasScoring = false;

  constructor(
    private game: Game,
    private view: BoardView,
    private computer: ComputerOptions,
  ) {
    this.configure('local');
  }

  /** 按模式重新安排两个座位；原来的电脑停止思考 */
  configure(mode: Mode, o: { computerColor?: number; online?: OnlineLink } = {}) {
    this.cancel();
    this.mode = mode;
    this.link = o.online ?? null;
    const g = this.game,
      v = this.view,
      seat = (c: number): Seat => {
        if (mode === 'online') return new RemoteSeat(c === this.link?.mine, c === this.link?.mine ? this.link : null);
        if (mode === 'computer' && c === (o.computerColor ?? WHITE)) return new ComputerSeat(g, v, c, this.computer);
        return new HumanSeat(g, v);
      };
    this.seats = [new HumanSeat(g, v), seat(BLACK), seat(WHITE)];
    this.wasScoring = g.scoring;
  }

  seat(color: number) {
    return this.seats[color];
  }
  private get turn() {
    const seat = this.seats[this.game.cur.toMove];
    if (!seat) throw new Error('会话尚未配置座位'); // configure 之后两个座位都在
    return seat;
  }

  /** 此刻轮到本机的人落子（联机时还要看能不能落：等对方回应申请时不能） */
  humanTurn() {
    return this.turn.local && (this.mode !== 'online' || !!this.link?.canMove());
  }

  /** 人机对弈且此刻轮到电脑 */
  computerTurn() {
    const g = this.game;
    return this.turn.kind === 'computer' && !g.over && !g.scoring;
  }

  /** 电脑正在想 */
  get thinking() {
    return this.seats.some(s => s instanceof ComputerSeat && s.thinking);
  }

  /** 本机的人落子；返回是否已经落下 */
  play(x: number, y: number) {
    return this.humanTurn() ? this.turn.play(x, y) : false;
  }

  /** 本机的人停一手（只有围棋） */
  pass() {
    if (this.game.type === GameType.Go && this.humanTurn()) this.turn.pass();
  }

  /** 单机悔棋退几手：人机对弈时若轮到人，要连电脑那一手一起退，退完仍是人落子 */
  undoSteps() {
    const g = this.game;
    return this.mode === 'computer' && this.turn.kind !== 'computer' && g.hist.length >= 2 ? 2 : 1;
  }

  /** 每帧：电脑想棋落子；人机下围棋进入点目时，电脑先估出死子 */
  tick(t: number) {
    for (const s of this.seats) s.tick?.(t);
    const g = this.game;
    if (g.scoring && !this.wasScoring && this.mode === 'computer' && g.type === GameType.Go) {
      const c = this.seats.find(s => s instanceof ComputerSeat) as ComputerSeat | undefined;
      c?.estimateDead();
    }
    this.wasScoring = g.scoring;
  }

  /** 停下电脑正在做的事（悔棋、开新局、换模式时） */
  cancel() {
    for (const s of this.seats) s.cancel?.();
  }
}

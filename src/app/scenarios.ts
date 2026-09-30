/**
 * 开发用的场景脚本（只在 npm run dev 时存在，打包时整个文件被去掉）：地址栏加 ?scenario=名字 打开，
 * 自动摆出局面、触发特效，并在指定时刻把三张画布截图交给开发服务器存到 .shots/<组名>/。
 * 用来在重构前后逐张对比画面：时间由虚拟时钟每帧固定走 1/60 秒，随机数固定种子，所以同一时刻的画面每次都一样。
 *
 *   ?scenario=gomoku-win            单个场景
 *   ?scenario=all&set=base          依次跑完全部场景，截图存进 .shots/base/
 *   ?scenario=gomoku-win&hold=1     不截图，停在最后一刻（肉眼看用）
 */
import { setClock } from '../core/clock';
import { autoMarkDead } from '../core/snap';
import { BLACK, GameType, WHITE, at } from '../core/types';
import { DEFAULTS, settings } from './settings';
import { game, screen, Screen } from './state';
import { devHooks } from './app';
import { goScreen, newGame, requestUndo, toggleReview } from './controller';
import { Phase, st as net } from '../online/client';

const STEP = 1 / 60;
const T0 = 1000;                           // 虚拟时钟的起点（秒）

interface Scenario {
  /** 时间线：[相对开始的秒数, 动作] */
  steps: [number, () => void][];
  /** 截图时刻（相对开始的秒数） */
  shots: number[];
}

/** 棋盘上直接摆子（不经过规则、不进历史），用来快速摆出局面 */
function place(stones: [number, number, number][]) {
  for (const [x, y, c] of stones) game.cur.b[at(x, y)] = c;
}

/** 依次落子（经过规则） */
function play(moves: [number, number][]) {
  for (const [x, y] of moves) if (!game.play(x, y)) throw new Error(`场景里的落子不合法：${x},${y}`);
}

const GAME = 1.5;                          // 进入对局界面、棋罐移开之后再开始

const SCENARIOS: Record<string, Scenario> = {
  /** 开始菜单：棋罐与光影 */
  menu: { steps: [], shots: [1.0] },

  /** 五子棋连五：点亮、冲击、炸飞，之后“查看棋局”让棋子飞回 */
  'gomoku-win': {
    steps: [
      [0, () => goScreen(Screen.Game)],
      [GAME, () => { newGame(GameType.Gomoku, 15); play([[3, 3], [11, 11], [3, 11], [11, 3], [5, 9], [9, 5], [7, 3], [8, 3], [7, 4], [8, 4], [7, 5], [8, 5], [7, 6], [8, 6]]); }],
      [GAME + 0.6, () => play([[7, 7]])],
      [GAME + 5.2, () => toggleReview()],
    ],
    shots: [GAME + 0.5, GAME + 0.72, GAME + 0.85, GAME + 1.2, GAME + 2.0, GAME + 4.0, GAME + 6.2],
  },

  /** 认输结束的五子棋：败方棋子被炸飞，胜方留在盘上 */
  'gomoku-forfeit': {
    steps: [
      [0, () => goScreen(Screen.Game)],
      [GAME, () => { newGame(GameType.Gomoku, 15); play([[7, 7], [8, 8], [6, 8], [8, 6], [9, 7], [6, 6], [5, 5], [10, 10]]); }],
      [GAME + 0.5, () => game.forfeitEnd(WHITE)],
    ],
    shots: [GAME + 0.8, GAME + 1.6, GAME + 3.5],
  },

  /** 禁手点的红叉（轮到黑棋） */
  'renju-marks': {
    steps: [
      [0, () => goScreen(Screen.Game)],
      [GAME, () => { newGame(GameType.Gomoku, 15); place([[7, 5, BLACK], [7, 6, BLACK], [5, 7, BLACK], [6, 7, BLACK], [2, 2, WHITE], [12, 12, WHITE], [2, 12, WHITE], [12, 2, WHITE]]); game.cur.moves = 8; }],
    ],
    shots: [GAME + 0.5],
  },

  /** 悔棋的时光倒流 */
  'undo-rewind': {
    steps: [
      [0, () => goScreen(Screen.Game)],
      [GAME, () => { newGame(GameType.Gomoku, 15); play([[7, 7], [8, 8], [6, 8], [8, 6]]); }],
      [GAME + 0.8, () => requestUndo()],
    ],
    shots: [GAME + 0.85, GAME + 1.0, GAME + 1.2, GAME + 1.6],
  },

  /** 围棋提子：被提的子淡出 */
  'go-capture': {
    steps: [
      [0, () => goScreen(Screen.Game)],
      [GAME, () => { newGame(GameType.Go, 9); play([[4, 4], [4, 3], [3, 3], [0, 0], [5, 3], [0, 1]]); }],
      [GAME + 0.5, () => play([[4, 2]])],
    ],
    shots: [GAME + 0.45, GAME + 0.62, GAME + 0.75, GAME + 1.0],
  },

  /** 围棋点目与胜负揭晓：自动估死子、确认结果后的冲击波与领地 */
  'go-score': {
    steps: [
      [0, () => goScreen(Screen.Game)],
      [GAME, () => {
        newGame(GameType.Go, 9);
        const s: [number, number, number][] = [];
        for (let y = 0; y < 9; y++) { s.push([3, y, BLACK]); s.push([5, y, WHITE]); }
        s.push([1, 4, WHITE], [7, 4, BLACK], [7, 5, BLACK]);
        place(s);
        game.cur.moves = s.length;
        game.pass(); game.pass();
        autoMarkDead(game);
      }],
      [GAME + 1.0, () => game.confirmScore()],
    ],
    shots: [GAME + 0.9, GAME + 1.25, GAME + 1.6, GAME + 2.2, GAME + 4.0],
  },

  /** 换棋盘：旧棋子由中心向外升起淡去，网格从 15 路过渡到 19 路 */
  'board-switch': {
    steps: [
      [0, () => goScreen(Screen.Game)],
      [GAME, () => { newGame(GameType.Gomoku, 15); play([[7, 7], [8, 8], [6, 8], [8, 6], [9, 7], [6, 6]]); }],
      [GAME + 0.6, () => newGame(GameType.Go, 19)],
    ],
    shots: [GAME + 0.75, GAME + 0.95, GAME + 1.4],
  },

  /** 离开对局：棋子飞回棋罐 */
  gather: {
    steps: [
      [0, () => goScreen(Screen.Game)],
      [GAME, () => { newGame(GameType.Gomoku, 15); play([[7, 7], [8, 8], [6, 8], [8, 6], [9, 7], [6, 6], [5, 5], [10, 10]]); }],
      [GAME + 0.6, () => goScreen(Screen.Menu)],
    ],
    shots: [GAME + 0.8, GAME + 1.1, GAME + 1.5, GAME + 2.6],
  },

  /** 多人游戏页：找到对手时天元落下一颗白子，座位发光 */
  'online-found': {
    steps: [
      [0, () => goScreen(Screen.Online)],
      [1.4, () => { net.phase = Phase.Found; net.opp = { name: '对手' }; net.foundAt = T0 + 1.4; net.foundSecs = 15; net.qMode = 'match'; }],
    ],
    shots: [1.3, 1.55, 2.2],
  },
};

export const SCENARIO_NAMES = Object.keys(SCENARIOS);

/** 在应用启动之前调用：固定随机数、换成虚拟时钟、用默认设置、断开网络 */
export function prepare() {
  let s = 0x2545f491;
  Math.random = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
  vt = T0;
  setClock(() => vt);
  settings.value = { ...DEFAULTS };        // 不写回本地存储
  (window as any).WebSocket = class { constructor() { throw new Error('场景脚本里不联网'); } };
}

let vt = T0;

/** 跑一个场景；返回截下的图的名字 */
function runOne(name: string, set: string, hold: boolean): Promise<string[]> {
  const sc = SCENARIOS[name];
  if (!sc) return Promise.reject(new Error(`没有这个场景：${name}，可选：${SCENARIO_NAMES.join('、')}`));
  const start = vt, steps = sc.steps.slice(), shots = sc.shots.slice().sort((a, b) => a - b), saved: string[] = [];
  const end = Math.max(0, ...shots, ...steps.map(s => s[0]));
  return new Promise(resolve => {
    devHooks.afterDraw = () => {
      const t = vt - start;
      if (!hold && shots.length && t >= shots[0] - 1e-6) {
        const k = shots.shift()!, tag = `${name}@${k.toFixed(2)}`;
        saved.push(tag);
        for (const id of ['scene', 'over', 'glow']) {
          const url = (document.getElementById(id) as HTMLCanvasElement).toDataURL('image/png');
          fetch(`/__shot?set=${encodeURIComponent(set)}&name=${encodeURIComponent(`${tag}-${id}`)}`, { method: 'POST', body: url });
        }
      }
      if (t >= end && !shots.length) { devHooks.afterDraw = null; resolve(saved); return; }
      vt += STEP;
      while (steps.length && vt - start >= steps[0][0] - 1e-6) steps.shift()![1]();
    };
    while (steps.length && steps[0][0] <= 0) steps.shift()![1]();
  });
}

/** 应用启动之后调用 */
export async function run(name: string, set: string, hold: boolean) {
  const names = name === 'all' ? SCENARIO_NAMES : [name];
  const all: string[] = [];
  for (const n of names) {
    if (screen.value !== Screen.Menu) { goScreen(Screen.Menu); await runIdle(2.5); }
    all.push(...await runOne(n, set, hold));
  }
  const info = { done: true, set, shots: all, size: [window.innerWidth, window.innerHeight, window.devicePixelRatio] };
  (window as any).__scenario = info;
  console.info('[scenario] 完成', info);
}

/** 空跑 s 秒虚拟时间（场景之间回到菜单、等动画结束） */
function runIdle(s: number) {
  const until = vt + s;
  return new Promise<void>(resolve => {
    devHooks.afterDraw = () => { if (vt >= until) { devHooks.afterDraw = null; resolve(); return; } vt += STEP; };
  });
}

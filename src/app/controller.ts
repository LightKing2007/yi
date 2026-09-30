/** 对局与界面的操作：界面按钮、快捷键、棋盘点击都走这里 */
import { autoMarkDead, goSnap, gomokuSnap } from '../core/snap';
import { GameType } from '../core/types';
import { now } from '../core/clock';
import { sfx } from '../audio';
import { blowing } from '../fx/blow';
import { startGather } from '../fx/gather';
import type { AiReply, AiRequest } from './ai.worker';
import { aiColor, animK, setSettings, settings } from './settings';
import { bowlsShown, game, screen, Screen, uiTick, view } from './state';
import { online } from '../online/client';

export function bump() { uiTick.value++; }

/** 新局：人机设置、禁手取自设置 */
export function newGame(type: GameType = game.type, N: number = type === GameType.Gomoku ? 15 : game.goSize) {
  game.animK = animK();
  game.newGame(type, N, { renju: settings.value.renju, aiColor: aiColor() });
  cancelAi();
  bump();
}

export function setVsAI(on: boolean) { game.vsAI = on; newGame(game.type, game.N); }

/** 悔棋：若其余棋子已被炸飞，先让它们倒放飞回原位，落定后再悔棋 */
export function requestUndo() {
  const g = game;
  if (!g.hist.length || g.undoPending) return;
  g.animK = animK();
  if (blowing() && g.blowView > 0.001) { g.review = true; g.undoPending = true; bump(); return; }
  g.undo();
  cancelAi();
  bump();
}

export function pass() { if (!game.aiToMove()) { game.pass(); bump(); } }
export function toggleReview() { if (blowing()) { game.review = !game.review; bump(); } }
export function resumeGame() { game.resume(); bump(); }
export function confirmScore() { game.confirmScore(); bump(); }

/** 界面切换：旧面板淡出，新面板淡入；棋罐随之移出或移回 */
export function goScreen(s: Screen) {
  const cur = screen.value;
  if (s === cur) return;
  if (bowlsShown(s) !== bowlsShown(cur)) sfx.play('bowl');
  if (cur === Screen.Game) {
    // 离开对局：盘上的棋子飞回棋罐，棋盘清空；模式、路数与对手保持不变
    startGather(now());
    newGame(game.type, game.N);
    game.switch.t0 = -100;
  }
  online.onScreen(cur, s);
  view.panelFrom = cur;
  view.panelT = 0;
  screen.value = s;
}

// ---------------- 棋盘 ----------------

/** 鼠标所在的交叉点与能否落子 */
export function boardHover(L: { ox: number; oy: number; cell: number }) {
  const g = game, m = view.mouse;
  const hx = Math.floor((m.x - L.ox) / L.cell + 0.5), hy = Math.floor((m.y - L.oy) / L.cell + 0.5);
  const onBoard = m.inside && screen.value === Screen.Game && g.inB(hx, hy) && view.panelT >= 1;
  const onl = online.inGame();
  const humanTurn = onl ? online.myTurn() : !(g.vsAI && g.cur.toMove === g.aiColor);
  const canPlace = onBoard && !g.over && !g.scoring && humanTurn && g.b(hx, hy) === 0 && !g.forbiddenAt(hx, hy);
  return { hx, hy, onBoard, humanTurn, canPlace };
}

export function boardClick(L: { ox: number; oy: number; cell: number }) {
  const g = game, h = boardHover(L);
  if (!h.onBoard) return;
  if (online.inGame()) {                                  // 联机：只把意图发给服务端，确认后再在本地落子
    if (g.scoring && !online.state.over) online.mark(h.hx, h.hy);
    else if (h.canPlace) online.move(h.hx, h.hy);
    return;
  }
  g.animK = animK();
  if (g.scoring) { g.toggleDead(h.hx, h.hy); bump(); }
  else if (h.canPlace && g.play(h.hx, h.hy)) { g.aiAt = now() + 0.35; bump(); }
  else if (g.msg) bump();
}

// ---------------- 电脑 ----------------

let worker: Worker | null = null;
let reqId = 0;
let pending: { id: number; stamp: string } | null = null;
let result: { stamp: string; x: number; y: number } | null = null;

function stampOf() { const g = game; return `${g.type}:${g.N}:${g.cur.moves}:${g.hist.length}:${g.cur.toMove}:${g.cur.passes}`; }

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<AiReply>) => {
    if (pending && e.data.id === pending.id) { result = { stamp: pending.stamp, x: e.data.x, y: e.data.y }; pending = null; }
  };
  return worker;
}

export function cancelAi() { pending = null; result = null; view.aiThinking = false; }

let wasScoring = false;

/** 每帧：轮到电脑就在后台想，想好了才落子 */
export function aiTick(t: number) {
  const g = game;
  if (screen.value === Screen.Game && !online.inGame() && g.aiToMove() && t >= g.aiAt) {
    const stamp = stampOf();
    if (result && result.stamp === stamp) {
      const { x, y } = result;
      result = null;
      g.animK = animK();
      if (g.type === GameType.Gomoku) { if (x >= 0) g.play(x, y); }
      else if (x < 0 || !g.play(x, y)) g.pass();
      view.aiThinking = false;
      bump();
    } else if (!pending || pending.stamp !== stamp) {
      const id = ++reqId, level = settings.value.aiLevel;
      pending = { id, stamp };
      view.aiThinking = true;
      const msg: AiRequest = g.type === GameType.Go ? { id, kind: 'go', snap: goSnap(g), level } : { id, kind: 'gomoku', snap: gomokuSnap(g), level };
      ensureWorker().postMessage(msg);
    }
  } else if (view.aiThinking && !g.aiToMove()) view.aiThinking = false;
  // 人机下围棋：双方停着进入点目时，电脑先估出死子，玩家可以再改
  if (g.scoring && !wasScoring && g.vsAI && g.type === GameType.Go) { autoMarkDead(g); bump(); }
  wasScoring = g.scoring;
}

// ---------------- 快捷键 ----------------

export function handleKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const k = e.key.toLowerCase(), scr = screen.value, ctrl = e.ctrlKey || e.metaKey;
  if (k === 'escape') {
    if (online.handleEscape(scr)) return;
    if (scr === Screen.Game && online.inGame()) online.askLeave();
    else if (scr !== Screen.Menu) goScreen(Screen.Menu);
    return;
  }
  if (ctrl) { if (k === 'z' && scr === Screen.Game) { online.inGame() ? online.undo() : requestUndo(); e.preventDefault(); } return; }
  if (k === 't') { setSettings({ theme: settings.value.theme ? 0 : 1 }); return; }
  if (scr !== Screen.Game) return;
  if (k === 'c') setSettings({ coords: !settings.value.coords });
  if (k === 'v') toggleReview();
  if (online.inGame()) {
    if (k === 'u') online.undo();
    if (k === 'p') online.pass();
    return;
  }
  if (k === 'u') requestUndo();
  if (k === 'n') newGame(game.type, game.N);
  if (k === 'p') pass();
  if (k === '1' && game.type !== GameType.Gomoku) newGame(GameType.Gomoku, 15);
  if (k === '2' && game.type !== GameType.Go) newGame(GameType.Go, game.goSize);
}

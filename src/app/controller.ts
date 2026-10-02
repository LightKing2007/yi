/** 对局与界面的操作：界面按钮、快捷键、棋盘点击都走这里 */
import { GameType } from '../core/types';
import { now } from '../core/clock';
import { sfx } from '../audio';
import { blowing } from '../fx/blow';
import { startGather } from '../fx/gather';
import { aiColor, setSettings, settings } from './settings';
import { bowlsShown, game, screen, Screen, uiTick, view, boardView, session } from './state';
import { bindNavigation, online } from '../online/client';

export function bump() {
  uiTick.value++;
}

/** 新局（单机）：禁手、人机执子取自设置，双人还是人机按会话里选的 */
export function newGame(type: GameType = game.type, N: number = type === GameType.Gomoku ? 15 : game.goSize) {
  game.newGame(type, N, { renju: settings.value.renju });
  session.configure(session.localMode, { computerColor: aiColor() });
  bump();
}

/**
 * 玩家要开新局（按钮、快捷键、换棋类路数）：如果五子棋取胜后棋子还在炸飞的状态，
 * 先让它们飞回原位（和“查看棋局”一样），落定后再慢慢清盘、开新局（见 controllerTick）
 */
export function requestNewGame(type: GameType = game.type, N: number = type === GameType.Gomoku ? 15 : game.goSize) {
  if (blowing() && boardView.blowView > 0.001) {
    boardView.review = true;
    boardView.newPending = { type, N };
    bump();
    return;
  }
  newGame(type, N);
}

export function setVsAI(on: boolean) {
  session.localMode = on ? 'computer' : 'local';
  requestNewGame(game.type, game.N);
}

/** 悔棋：联机时向对方申请；单机时若其余棋子已被炸飞，先让它们倒放飞回原位，落定后再悔棋（见 controllerTick） */
export function requestUndo() {
  if (session.mode === 'online') {
    online.undo();
    return;
  }
  if (!game.hist.length || boardView.undoPending) return;
  if (blowing() && boardView.blowView > 0.001) {
    boardView.review = true;
    boardView.undoPending = true;
    bump();
    return;
  }
  undoNow();
}

function undoNow() {
  game.undo(session.undoSteps());
  session.cancel();
  bump();
}

/** 停一手：轮到本机的人时才算（联机时发给服务端） */
export function pass() {
  session.pass();
  bump();
}
export function toggleReview() {
  if (blowing() && !boardView.newPending) {
    boardView.review = !boardView.review;
    bump();
  }
}
export function resumeGame() {
  game.resume();
  bump();
}
export function confirmScore() {
  game.confirmScore();
  bump();
}

/** 界面切换：旧面板淡出，新面板淡入；棋罐随之移出或移回 */
export function goScreen(s: Screen) {
  const cur = screen.value;
  if (s === cur) return;
  if (bowlsShown(s) !== bowlsShown(cur)) sfx.play('bowl');
  if (cur === Screen.Game) {
    // 离开对局：盘上的棋子飞回棋罐，棋盘清空；模式、路数与对手保持不变
    startGather(now());
    newGame(game.type, game.N);
    boardView.switch.t0 = -100;
  }
  online.onScreen(cur, s);
  view.panelFrom = cur;
  view.panelT = 0;
  screen.value = s;
}

// 联机模块要切换界面时（开局、断线、离开）走这里
bindNavigation(goScreen);

// ---------------- 棋盘 ----------------

/** 鼠标所在的交叉点与能否落子 */
export function boardHover(L: { ox: number; oy: number; cell: number }) {
  const g = game,
    m = view.mouse;
  const hx = Math.floor((m.x - L.ox) / L.cell + 0.5),
    hy = Math.floor((m.y - L.oy) / L.cell + 0.5);
  const onBoard = m.inside && screen.value === Screen.Game && g.inB(hx, hy) && view.panelT >= 1;
  const humanTurn = session.humanTurn();
  const canPlace = onBoard && !g.over && !g.scoring && humanTurn && g.b(hx, hy) === 0 && !g.forbiddenAt(hx, hy);
  return { hx, hy, onBoard, humanTurn, canPlace };
}

export function boardClick(L: { ox: number; oy: number; cell: number }) {
  const g = game,
    h = boardHover(L);
  if (!h.onBoard) return;
  if (g.scoring) {
    // 点目时标记死子；联机时先发给服务端，确认后再标
    if (session.mode !== 'online') {
      g.toggleDead(h.hx, h.hy);
      bump();
    } else if (!online.state.over) online.mark(h.hx, h.hy);
    return;
  }
  if (h.canPlace && session.play(h.hx, h.hy))
    bump(); // 联机时只是发给服务端，确认后由联机模块落子
  else if (boardView.msg) bump();
}

// ---------------- 每帧 ----------------

/** 每帧：电脑想棋落子（只在对局界面）；炸飞的棋子飞回原位之后，做等着的悔棋或开新局 */
export function controllerTick(t: number) {
  if (screen.value === Screen.Game) session.tick(t);
  if (boardView.blowView > 0.001) return;
  if (boardView.undoPending) {
    boardView.undoPending = false;
    undoNow();
  }
  const p = boardView.newPending;
  if (p) {
    boardView.nextSwitchDur = 1.4; // 清盘慢一些
    newGame(p.type, p.N);
  }
}

// ---------------- 快捷键 ----------------

export function handleKey(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const k = e.key.toLowerCase(),
    scr = screen.value,
    ctrl = e.ctrlKey || e.metaKey;
  if (k === 'escape') {
    if (online.handleEscape(scr)) return;
    if (scr === Screen.Game && session.mode === 'online') online.askLeave();
    else if (scr !== Screen.Menu) goScreen(Screen.Menu);
    return;
  }
  if (ctrl) {
    if (k === 'z' && scr === Screen.Game) {
      requestUndo();
      e.preventDefault();
    }
    return;
  }
  if (k === 't') {
    setSettings({ theme: settings.value.theme ? 0 : 1 });
    return;
  }
  if (scr !== Screen.Game) return;
  if (k === 'c') setSettings({ coords: !settings.value.coords });
  if (k === 'v') toggleReview();
  if (k === 'u') requestUndo();
  if (k === 'p') pass();
  if (session.mode === 'online') return; // 联机时不能自己开新局、换棋类
  if (k === 'n') requestNewGame(game.type, game.N);
  if (k === '1' && game.type !== GameType.Gomoku) requestNewGame(GameType.Gomoku, 15);
  if (k === '2' && game.type !== GameType.Go) requestNewGame(GameType.Go, game.goSize);
}

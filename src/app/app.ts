/** 应用主循环：窗口尺寸 → 布局，输入 → 更新 → 绘制 */
import { now } from '../core/clock';
import { computeLayout, type Layout } from '../render/layout';
import { sfx } from '../audio';
import { ghostUpdate } from '../fx/ghost';
import { clearParticles } from '../fx/fx';
import { boardClick, boardHover, bump, controllerTick, handleKey, newGame } from './controller';
import { animK, settings } from './settings';
import { game, screen, Screen, uiTick, view, boardView, session } from './state';
import { Stage } from './stage';
import { signal } from '@preact/signals';
import { GameType } from '../core/types';

/** 每帧要做的其他事（联机模块的心跳、重连、倒计时由入口在这里注册），主循环不必认识它们 */
const frameHooks: ((t: number) => void)[] = [];
export function onFrame(f: (t: number) => void) {
  frameHooks.push(f);
}

/** 开发用的钩子：每帧画完之后调用（场景脚本在这里推进虚拟时钟、截图） */
export const devHooks = { afterDraw: null as null | (() => void) };

/** 当前布局（界面按它摆放面板、坐标） */
export const layout = signal<Layout>(computeLayout(window.innerWidth, window.innerHeight, 15));

export function startApp(sceneCanvas: HTMLCanvasElement, overCanvas: HTMLCanvasElement, glowCanvas: HTMLCanvasElement) {
  let stage = new Stage(sceneCanvas, overCanvas, glowCanvas);
  game.goSize = 19;
  newGame(GameType.Gomoku, 15);
  boardView.switch.t0 = -100;

  let W = 0,
    H = 0,
    dpr = 0,
    N = 0,
    scale = 0;
  const relayout = () => {
    const w = window.innerWidth,
      h = window.innerHeight,
      d = window.devicePixelRatio || 1;
    if (w === W && h === H && d === dpr && N === game.N && scale === settings.value.uiScale) return;
    W = w;
    H = h;
    dpr = d;
    N = game.N;
    scale = settings.value.uiScale;
    stage.resize(w, h, d);
    layout.value = computeLayout(w, h, game.N, settings.value.uiScale);
    document.documentElement.style.setProperty('--u', String(layout.value.u));
  };

  // 显卡重置、睡眠唤醒等情况下 WebGL 上下文会丢失：丢失期间只更新不绘制，恢复后重建着色器与离屏贴图（棋局不受影响）
  let lost = 0;
  for (const c of [sceneCanvas, overCanvas, glowCanvas]) {
    c.addEventListener('webglcontextlost', e => {
      e.preventDefault();
      lost++;
    });
    c.addEventListener('webglcontextrestored', () => {
      if (--lost > 0) return;
      lost = 0;
      stage = new Stage(sceneCanvas, overCanvas, glowCanvas);
      W = 0; // 让 relayout 重新设置画布尺寸
    });
  }

  // 输入：界面层不接收鼠标的地方（棋盘）落到下层画布上
  window.addEventListener('pointermove', e => {
    view.mouse.x = e.clientX;
    view.mouse.y = e.clientY;
    view.mouse.inside = true;
  });
  document.addEventListener('pointerleave', () => {
    view.mouse.inside = false;
  });
  sceneCanvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    view.mouse.x = e.clientX;
    view.mouse.y = e.clientY;
    view.mouse.inside = true;
    boardClick(layout.value);
  });
  window.addEventListener('keydown', handleKey);

  // 规则层事件 → 音效 / 清理特效
  const handleEvents = () => {
    for (let ev = game.pollEvent(); ev; ev = game.pollEvent()) {
      if (ev.type === 'stone') sfx.clack(ev.strength);
      else if (ev.type === 'undo') sfx.play('rewind', 1, 1 / animK());
      else clearParticles();
    }
  };

  // 界面上显示的状态有变化时才重绘面板
  let lastKey = '';
  const uiKey = () => {
    const g = game;
    return `${screen.value}|${g.type}|${g.N}|${g.cur.moves}|${g.cur.toMove}|${g.over}|${g.winner}|${g.scoring}|${g.finished}|${boardView.review}|${g.hist.length}|${boardView.msg?.key}|${boardView.msgAt}|${session.thinking}|${session.localMode}|${session.mode}|${g.scoreB}|${g.scoreW}`;
  };

  let last = now();
  const frame = () => {
    const t = now(),
      dt = Math.min(t - last, 0.05);
    last = t;
    relayout();
    const L = layout.value;
    view.panelT = Math.min(1, view.panelT + dt / 0.6);
    controllerTick(t);
    stage.update(L, t, dt);
    handleEvents();
    for (const f of frameHooks) f(t);
    const h = boardHover(L);
    ghostUpdate(
      L,
      view.mouse.x,
      view.mouse.y,
      dt,
      h.onBoard && !game.over && !game.scoring && h.humanTurn,
      h.onBoard && game.b(h.hx, h.hy) === 0 && !game.forbiddenAt(h.hx, h.hy),
    );
    sceneCanvas.style.cursor = h.canPlace || (game.scoring && h.onBoard && game.b(h.hx, h.hy)) ? 'pointer' : 'default';
    if (!lost) {
      stage.prepare(L, t);
      stage.draw(L, t);
    }
    devHooks.afterDraw?.();
    const k = uiKey();
    if (k !== lastKey) {
      lastKey = k;
      bump();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return stage;
}

export { uiTick, Screen };

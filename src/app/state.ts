/** 应用的共享状态：当前界面、对局、各种过渡动画的进度 */
import { signal } from '@preact/signals';
import { Game } from '../core/game';

/** 界面：开始菜单 → 单人对局 / 多人游戏 / 设置 / 更多 */
export enum Screen { Menu, Settings, Game, More, Online }

export const VERSION = '2.0.0';

export const game = new Game();

export const screen = signal<Screen>(Screen.Menu);

/** 每帧变化的状态（画面直接读，界面靠 uiTick 重绘） */
export const view = {
  panelFrom: Screen.Menu,
  panelT: 1,               // 面板切换进度 0..1
  bowlK: 1,                // 棋罐：1 在盘上，0 已移出
  onlineK: 0,              // 多人游戏页棋盘布置的显现程度
  duskK: 1,                // 光影开关的渐变值
  mouse: { x: -9999, y: -9999, inside: false },
  aiThinking: false,
};

/** 界面需要重绘时递增（对局状态、提示、电脑思考等变化） */
export const uiTick = signal(0);

/** 该界面下两只棋罐是否摆在棋盘上（对局时移开） */
export const bowlsShown = (s: Screen) => s !== Screen.Game;

/** 入口：启动画面循环与界面 */
import { render } from 'preact';
import './ui/styles.css';
import { startApp } from './app/app';
import { initAudio } from './audio/engine';
import { App } from './ui/App';
import * as net from './online/client';
import * as controller from './app/controller';
import { catchErrors, logError } from './app/native';

catchErrors();

const scene = document.getElementById('scene') as HTMLCanvasElement;
const over = document.getElementById('over') as HTMLCanvasElement;
const glow = document.getElementById('glow') as HTMLCanvasElement;

try {
  const stage = startApp(scene, over, glow);
  if (import.meta.env.DEV) (window as any).__yi = { stage, net, controller };   // 开发时调试用
} catch (e) {
  logError('启动', e);
  const box = document.createElement('div');
  box.style.cssText = 'padding:40px;font:16px sans-serif';
  box.textContent = `无法启动：${(e as Error).message}`;
  document.body.replaceChildren(box);
  throw e;
}
initAudio();
render(<App />, document.getElementById('ui')!);

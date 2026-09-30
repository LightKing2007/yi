/** 入口：启动画面循环与界面 */
import { render } from 'preact';
import './ui/styles.css';
import { startApp } from './app/app';
import { initAudio } from './audio/engine';
import { App } from './ui/App';
import * as net from './online/client';
import * as controller from './app/controller';

const scene = document.getElementById('scene') as HTMLCanvasElement;
const over = document.getElementById('over') as HTMLCanvasElement;
const glow = document.getElementById('glow') as HTMLCanvasElement;

try {
  const stage = startApp(scene, over, glow);
  if (import.meta.env.DEV) (window as any).__yi = { stage, net, controller };   // 开发时调试用
} catch (e) {
  document.body.innerHTML = `<div style="padding:40px;font:16px sans-serif">无法启动：${(e as Error).message}</div>`;
  throw e;
}
initAudio();
render(<App />, document.getElementById('ui')!);

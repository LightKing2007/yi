/** 入口：启动画面循环与界面 */
import './ui/styles.css';
import { onFrame, startApp } from './app/app';
import { initAudio } from './audio/engine';
import { mountUI } from './ui/App';
import * as net from './online/client';
import * as controller from './app/controller';
import { catchErrors, logError } from './app/native';

catchErrors();

const scene = document.getElementById('scene') as HTMLCanvasElement;
const over = document.getElementById('over') as HTMLCanvasElement;
const glow = document.getElementById('glow') as HTMLCanvasElement;

// 开发用：?scenario=名字 跑场景脚本（见 app/scenarios.ts）；打包时这一段连同场景脚本一起去掉
const scenarioName = import.meta.env.DEV ? new URLSearchParams(location.search).get('scenario') : null;
const scenarios = import.meta.env.DEV && scenarioName ? await import('./app/scenarios') : null;
scenarios?.prepare();

try {
  const stage = startApp(scene, over, glow);
  onFrame(net.update); // 联机：心跳、重连、倒计时
  if (import.meta.env.DEV) (window as any).__yi = { stage, net, controller }; // 开发时调试用
} catch (e) {
  logError('启动', e);
  const box = document.createElement('div');
  box.style.cssText = 'padding:40px;font:16px sans-serif';
  box.textContent = `无法启动：${(e as Error).message}`;
  document.body.replaceChildren(box);
  throw e;
}
initAudio();
mountUI(document.getElementById('ui')!);
if (scenarios && scenarioName) {
  const q = new URLSearchParams(location.search);
  scenarios.run(scenarioName, q.get('set') ?? 'now', q.has('hold')).catch(e => console.error('[scenario]', e));
}

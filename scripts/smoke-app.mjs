/**
 * 安装后的冒烟检查（checklists.md 第 3 节中可以自动化的部分）：启动打包好的游戏，经 Chrome 开发者协议（只监听 127.0.0.1）检查后退出。
 *   node scripts/smoke-app.mjs <可执行文件> [截图目录]
 * 检查：Electron 版本与 node_modules 中一致、预加载接口、渲染进程沙箱、WebGL2、开局落子、人机对弈（电脑在后台线程中应一手）、
 * 页面无异常与报错、日志无 error。用户数据放在临时目录，不碰本机已安装的游戏的数据。
 * 环境变量 SMOKE_ARGS：附加给游戏的命令行参数（以空格分隔）。任一项不通过时退出码为 1。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [exe, outDir = 'smoke'] = process.argv.slice(2);
if (!exe) { console.error('用法：node scripts/smoke-app.mjs <可执行文件> [截图目录]'); process.exit(2); }

const PORT = 9333;
const START_TIMEOUT_MS = 60_000;
const expected = JSON.parse(fs.readFileSync(new URL('../node_modules/electron/package.json', import.meta.url), 'utf8')).version;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-smoke-'));
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (ok, what) => { console.log(`${ok ? '✓' : '✗'} ${what}`); if (!ok) failures.push(what); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const extra = (process.env.SMOKE_ARGS ?? '').split(' ').filter(Boolean);
const app = spawn(exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
app.stdout.on('data', d => { output += d; });
app.stderr.on('data', d => { output += d; });
let exited = null;
app.on('exit', code => { exited = code; });
// 无论在哪一步退出（含中途失败），都结束游戏进程并删除临时用户目录，不留下测试数据
process.on('exit', () => {
  if (exited === null) app.kill();
  fs.rmSync(userData, { recursive: true, force: true });
});

/** 等调试端口上出现游戏页面 */
async function findPage() {
  const t0 = Date.now();
  while (Date.now() - t0 < START_TIMEOUT_MS && exited === null) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === 'page' && t.url.startsWith('app://'));
      if (page) return page;
    } catch { /* 调试端口还没开，稍后再试 */ }
    await sleep(500);
  }
  return null;
}

const page = await findPage();
if (!page) {
  console.error(`✗ 游戏没有在 ${START_TIMEOUT_MS / 1000} 秒内启动（退出码 ${exited}）。输出：\n${output.slice(-4000)}`);
  process.exit(1);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let seq = 0;
const waiting = new Map(), problems = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') problems.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
    problems.push(`${m.params.type}: ${m.params.args.map(a => a.value ?? a.description).join(' ')}`);
  }
};
await new Promise(r => { ws.onopen = r; });
const call = (method, params = {}) => new Promise(r => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
/** 在页面中求值；求值出错时打印协议的完整回应，返回 undefined */
async function evaluate(expr) {
  const r = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.error || r.result?.exceptionDetails || !r.result?.result || !('value' in r.result.result)) {
    console.error(`求值出错：${JSON.stringify(r).slice(0, 2000)}`);
    return undefined;
  }
  return r.result.result.value;
}
const shot = async name => {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64'));
};
await call('Runtime.enable');
await sleep(3000);                                                  // 等开始菜单的入场动画

const info = (await evaluate(`(async () => {
  // 再向游戏的画布要上下文，在 Linux 软件渲染下偶尔得到 null（游戏照常绘制）；另用一块新画布探测环境是否支持 WebGL2。
  // 游戏自己建不起上下文时会抛出“当前环境不支持 WebGL2”，由下面的“页面没有异常与报错”检出
  const gl = document.getElementById('scene').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl2');
  await document.fonts.ready;
  return {
    electron: navigator.userAgent.match(/Electron\\/([\\d.]+)/)?.[1],
    preload: window.yiNative ? Object.keys(window.yiNative) : [],
    sandboxed: typeof require === 'undefined' && typeof process === 'undefined',
    webgl2: !!gl && !gl.isContextLost(),
    renderer: gl ? gl.getParameter(gl.RENDERER) : null,
    fonts: [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family + ' ' + f.weight),
    buttons: [...document.querySelectorAll('button')].map(b => b.textContent),
  };
})()`)) ?? { preload: [], buttons: [] };
console.log(JSON.stringify(info, null, 1));
check(info.electron === expected, `Electron 版本为 ${expected}（实际 ${info.electron}）`);
check(['attention', 'log', 'openLogs', 'platform', 'quit'].every(k => info.preload.includes(k)), '预加载接口 yiNative 可用');
check(info.sandboxed, '渲染进程中没有 require、process（沙箱生效）');
check(info.webgl2, `WebGL2 可用（${info.renderer}）`);
check(info.buttons.length >= 4, '开始菜单的按钮已显示');
await shot('1-menu');

const played = await evaluate(`(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const byText = t => [...document.querySelectorAll('button, .seg *')].find(b => b.textContent.trim() === t);
  const tap = () => {
    const c = document.getElementById('scene'), r = c.getBoundingClientRect();
    for (const t of ['pointermove', 'pointerdown', 'pointerup', 'click']) {
      c.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: r.left + r.width * 0.36, clientY: r.top + r.height * 0.5 }));
    }
  };
  document.querySelectorAll('button')[0].click();
  await wait(2500);
  byText('与机弈')?.click() ?? byText('人机对弈')?.click();
  await wait(2500);
  tap();
  for (let i = 0; i < 30 && !/第三手|第 3 手|Move 3/.test(document.body.innerText); i++) await wait(500);   // 电脑第一次思考要先启动后台线程
  return document.body.innerText;
})()`);
const replied = /第三手|第 3 手|Move 3/.test(played ?? '');
check(replied, '开局落子后电脑应了一手（轮到第三手）');
if (!replied) console.log(String(played).replace(/\s+/g, ' ').slice(0, 300));
await shot('2-game');

check(problems.length === 0, `页面没有异常与报错${problems.length ? '：' + problems.join(' | ') : ''}`);
await evaluate('setTimeout(() => window.yiNative.quit(), 200), 0');
ws.close();
const t0 = Date.now();
while (exited === null && Date.now() - t0 < 10_000) await sleep(200);
check(exited !== null, '点击退出后进程结束');
if (exited === null) app.kill();

const logFile = path.join(userData, 'logs', 'yi.log');
const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
console.log(log.trim());
check(/启动 .* Electron /.test(log) && !/\[error\]/.test(log), '日志有启动记录且没有 error');

if (failures.length) console.log(`\n游戏进程的输出（末尾）：\n${output.slice(-4000)}`);
console.log(failures.length ? `\n${failures.length} 项不通过` : '\n全部通过');
process.exit(failures.length ? 1 : 0);

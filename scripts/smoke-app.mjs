/**
 * 安装后的冒烟检查（checklists.md 第 3 节中可以自动化的部分）：启动打包好的游戏，经 Chrome 开发者协议（只监听 127.0.0.1）检查后退出。
 *   node scripts/smoke-app.mjs <可执行文件> [截图目录]
 * 第一次启动：Electron 版本与 node_modules 中一致、预加载接口、渲染进程沙箱、WebGL2、附带字体可以载入、在设置中改用中文、
 * 开局落子、人机对弈（电脑在后台线程中应一手）、页面无异常与报错、退出、窗口位置已保存、日志无 error。
 * 第二次启动（同一份用户数据，窗口记录改为最小尺寸 800×600）：设置仍为中文，最小窗口中按钮都在窗口内、页面没有滚动条。
 * 用户数据放在临时目录，不碰本机已安装的游戏的数据。
 * 环境变量 SMOKE_ARGS：附加给游戏的命令行参数（以空格分隔）。任一项不通过时退出码为 1。
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [exe, outDir = 'smoke'] = process.argv.slice(2);
if (!exe) {
  console.error('用法：node scripts/smoke-app.mjs <可执行文件> [截图目录]');
  process.exit(2);
}

const PORT = 9333;
const START_TIMEOUT_MS = 60_000;
const QUIT_TIMEOUT_MS = 10_000;
/** 主进程规定的窗口最小尺寸（electron/main.ts 的 minWidth、minHeight） */
const MIN_WINDOW = { width: 800, height: 600 };
/** 附带的字体（src/ui/styles.css 的 @font-face） */
const BUNDLED_FONTS = ['Yi Sans', 'Yi Serif', 'Yi Latin', 'Yi Latin Serif'];
const expected = JSON.parse(fs.readFileSync(new URL('../node_modules/electron/package.json', import.meta.url), 'utf8')).version;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-smoke-'));
fs.mkdirSync(outDir, { recursive: true });

const failures = [];
const check = (ok, what) => {
  console.log(`${ok ? '✓' : '✗'} ${what}`);
  if (!ok) failures.push(what);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** 当前运行中的游戏进程；退出时结束它 */
let running = null;
// 无论在哪一步退出（含中途失败），都结束游戏进程并删除临时用户目录，不留下测试数据
process.on('exit', () => {
  if (running && running.exited === null) running.child.kill();
  fs.rmSync(userData, { recursive: true, force: true });
});

/** 等调试端口上出现游戏页面 */
async function findPage(proc) {
  const t0 = Date.now();
  while (Date.now() - t0 < START_TIMEOUT_MS && proc.exited === null) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(target => target.type === 'page' && target.url.startsWith('app://'));
      if (page) return page;
    } catch {
      /* 调试端口还没开，稍后再试 */
    }
    await sleep(500);
  }
  return null;
}

/** 经开发者协议连上页面：返回发命令、求值、截图的函数，以及页面上出现的异常与报错 */
async function connect(page) {
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let seq = 0;
  const waiting = new Map(),
    problems = [];
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg);
      waiting.delete(msg.id);
    }
    if (msg.method === 'Runtime.exceptionThrown') problems.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      problems.push(`${msg.params.type}: ${msg.params.args.map(arg => arg.value ?? arg.description).join(' ')}`);
    }
  };
  await new Promise(resolve => {
    ws.onopen = resolve;
  });
  const call = (method, params = {}) =>
    new Promise(resolve => {
      const id = ++seq;
      waiting.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
    });
  /** 在页面中求值；求值出错时打印协议的完整回应，返回 undefined */
  const evaluate = async expr => {
    const reply = await call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
    if (reply.error || reply.result?.exceptionDetails || !reply.result?.result || !('value' in reply.result.result)) {
      console.error(`求值出错：${JSON.stringify(reply).slice(0, 2000)}`);
      return undefined;
    }
    return reply.result.result.value;
  };
  const shot = async name => {
    const reply = await call('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(reply.result.data, 'base64'));
  };
  await call('Runtime.enable');
  return { ws, call, evaluate, shot, problems };
}

/** 启动游戏并连上页面；启动失败时打印输出后退出 */
async function launch() {
  const extra = (process.env.SMOKE_ARGS ?? '').split(' ').filter(Boolean);
  const child = spawn(exe, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${userData}`, ...extra], { stdio: ['ignore', 'pipe', 'pipe'] });
  const proc = { child, exited: null, output: '' };
  child.stdout.on('data', data => (proc.output += data));
  child.stderr.on('data', data => (proc.output += data));
  child.on('exit', code => (proc.exited = code));
  running = proc;
  const page = await findPage(proc);
  if (!page) {
    console.error(`✗ 游戏没有在 ${START_TIMEOUT_MS / 1000} 秒内启动（退出码 ${proc.exited}）。输出：\n${proc.output.slice(-4000)}`);
    process.exit(1);
  }
  return { proc, ...(await connect(page)) };
}

/** 经游戏自己的退出接口退出，等进程结束 */
async function quit(game, label) {
  await game.evaluate('setTimeout(() => window.yiNative.quit(), 200), 0');
  game.ws.close();
  const t0 = Date.now();
  while (game.proc.exited === null && Date.now() - t0 < QUIT_TIMEOUT_MS) await sleep(200);
  check(game.proc.exited !== null, `${label}：点击退出后进程结束`);
  if (game.proc.exited === null) game.proc.child.kill();
}

/** 开始菜单：版本、预加载接口、沙箱、WebGL2、按钮、附带字体 */
async function checkMenu(game) {
  const info = (await game.evaluate(`(async () => {
    // 再向游戏的画布要上下文，在 Linux 软件渲染下偶尔得到 null（游戏照常绘制）；另用一块新画布探测环境是否支持 WebGL2。
    // 游戏自己建不起上下文时会抛出“当前环境不支持 WebGL2”，由“页面没有异常与报错”检出
    const gl = document.getElementById('scene').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl2');
    await document.fonts.ready;
    const bundled = {};
    for (const family of ${JSON.stringify(BUNDLED_FONTS)}) bundled[family] = (await document.fonts.load('16px "' + family + '"', 'A弈')).length > 0;
    return {
      electron: navigator.userAgent.match(/Electron\\/([\\d.]+)/)?.[1],
      preload: window.yiNative ? Object.keys(window.yiNative) : [],
      sandboxed: typeof require === 'undefined' && typeof process === 'undefined',
      webgl2: !!gl && !gl.isContextLost(),
      renderer: gl ? gl.getParameter(gl.RENDERER) : null,
      bundled,
      buttons: [...document.querySelectorAll('button')].map(b => b.textContent),
    };
  })()`)) ?? { preload: [], buttons: [], bundled: {} };
  console.log(JSON.stringify(info, null, 1));
  check(info.electron === expected, `Electron 版本为 ${expected}（实际 ${info.electron}）`);
  check(
    ['attention', 'log', 'openLogs', 'platform', 'quit'].every(key => info.preload.includes(key)),
    '预加载接口 yiNative 可用',
  );
  check(info.sandboxed, '渲染进程中没有 require、process（沙箱生效）');
  check(info.webgl2, `WebGL2 可用（${info.renderer}）`);
  check(info.buttons.length >= 4, '开始菜单的按钮已显示');
  const missing = BUNDLED_FONTS.filter(family => !info.bundled[family]);
  check(missing.length === 0, `附带的字体都可以载入${missing.length ? '，缺少：' + missing.join('、') : ''}`);
}

/** 在设置中把界面语言改为中文（第二次启动时检查是否保留），再刷新页面回到开始菜单 */
async function switchToChinese(game) {
  const lang = await game.evaluate(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    document.querySelectorAll('button')[2].click(); // 开始菜单的第三个按钮为“设置”
    await wait(1500);
    document.querySelector('.seg').querySelectorAll('.opt')[1].click(); // 设置页的分页：声音、画面、对局；语言在“画面”中
    await wait(500);
    [...document.querySelectorAll('.seg .opt')].find(opt => opt.textContent.trim() === '中文')?.click();
    await wait(500);
    return JSON.parse(localStorage.getItem('yi.settings') ?? '{}').lang;
  })()`);
  check(lang === 1, `在设置中改用中文后写入了本地存储（lang = ${lang}）`);
  await game.call('Page.reload');
  await sleep(3000);
}

/** 进入单人游戏、选人机对弈、落一子，等电脑应一手 */
async function playOneMove(game) {
  const played = await game.evaluate(`(async () => {
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
    byText('人机对弈')?.click() ?? byText('与机弈')?.click();
    await wait(2500);
    tap();
    for (let i = 0; i < 30 && !/第三手|第 3 手|Move 3/.test(document.body.innerText); i++) await wait(500);   // 电脑第一次思考要先启动后台线程
    return document.body.innerText;
  })()`);
  const replied = /第三手|第 3 手|Move 3/.test(played ?? '');
  check(replied, '开局落子后电脑应了一手（轮到第三手）');
  if (!replied) console.log(String(played).replace(/\s+/g, ' ').slice(0, 300));
}

/** 第二次启动：设置保留，最小窗口中的布局 */
async function checkRelaunch(game) {
  const state = (await game.evaluate(`(async () => {
    await document.fonts.ready;
    const outside = [...document.querySelectorAll('button')]
      .map(b => [b.textContent.trim(), b.getBoundingClientRect()])
      .filter(([, r]) => r.width > 0 && (r.left < 0 || r.top < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5))
      .map(([t]) => t);
    const root = document.scrollingElement;
    return { text: document.body.innerText, width: innerWidth, height: innerHeight, outside,
      scroll: root.scrollWidth > innerWidth || root.scrollHeight > innerHeight };
  })()`)) ?? { text: '', outside: [] };
  check(/单人游戏/.test(state.text), '退出后再次打开，界面语言仍为中文（设置已保留）');
  check(state.width <= MIN_WINDOW.width && state.height <= MIN_WINDOW.height, `窗口按保存的记录以最小尺寸打开（页面 ${state.width}×${state.height}）`);
  check(state.outside.length === 0, `最小窗口中按钮都在窗口内${state.outside.length ? '，越界：' + state.outside.join('、') : ''}`);
  check(!state.scroll, '最小窗口中页面没有滚动条');
}

/** 检查日志：有启动记录、没有 error */
function checkLog() {
  const logFile = path.join(userData, 'logs', 'yi.log');
  const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : '';
  console.log(log.trim());
  check(/启动 .* Electron /.test(log) && !/\[error\]/.test(log), '日志有启动记录且没有 error');
}

// ---------------- 第一次启动 ----------------

const first = await launch();
await sleep(3000); // 等开始菜单的入场动画
await checkMenu(first);
await first.shot('1-menu');
await switchToChinese(first);
await playOneMove(first);
await first.shot('2-game');
check(first.problems.length === 0, `第一次启动：页面没有异常与报错${first.problems.length ? '：' + first.problems.join(' | ') : ''}`);
await quit(first, '第一次启动');
const boundsFile = path.join(userData, 'window.json');
check(fs.existsSync(boundsFile), '退出时保存了窗口位置（window.json）');

// ---------------- 第二次启动 ----------------

fs.writeFileSync(boundsFile, JSON.stringify(MIN_WINDOW));
const second = await launch();
await sleep(3000);
await checkRelaunch(second);
await second.shot('3-min-window');
check(second.problems.length === 0, `第二次启动：页面没有异常与报错${second.problems.length ? '：' + second.problems.join(' | ') : ''}`);
await quit(second, '第二次启动');
checkLog();

if (failures.length) console.log(`\n游戏进程的输出（末尾）：\n${running.output.slice(-4000)}`);
console.log(failures.length ? `\n${failures.length} 项不通过` : '\n全部通过');
process.exit(failures.length ? 1 : 0);

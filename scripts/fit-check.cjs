/**
 * 界面文字排版检查（I18N-020、I18N-022，整改项 P1-15）：在不显示的 Electron 窗口（1320×900、像素比 1）中运行开发版，
 * 以三种语言走遍各界面与联机流程（scripts/fit-driver.ts），再跑单机的终局与点目场景；Fit 在开发模式下报告的“[fit] 放不下”
 * 一条即失败。只在 CI 上运行（.github/workflows/ci.yml 的 text-fit 任务；Linux 上须在虚拟显示器中运行）：
 *   xvfb-run -a npm run fit-check
 * 自己起开发服务器与本机联机服务端（须先 npm run build:node），段位存档与浏览器数据放在临时目录，跑完一并删除。
 */
const { app, BrowserWindow } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
/** 单机场景：终局、中途认输、围棋点目（scripts/fit-driver.ts 只走联机与静态界面） */
const SCENARIOS = ['gomoku-win', 'gomoku-forfeit', 'go-score'];
/** 文言、中文、英文（src/app/settings.ts 的 Lang） */
const LANGS = [0, 1, 2];
/** 联机服务端启动的等待上限 */
const SERVER_START_MS = 10000;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-fit-'));
app.setPath('userData', path.join(tmp, 'userdata'));
app.commandLine.appendSwitch('enable-unsafe-swiftshader'); // CI 机器没有 GPU，须显式允许软件渲染，否则游戏提示不支持 WebGL2

/** 本机一个空闲的端口 */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/** 启动打包好的联机服务端，等到它报告“已启动” */
async function startGameServer(port) {
  const child = spawn('node', [path.join(ROOT, 'dist-server/server.cjs'), String(port)], {
    env: { ...process.env, YI_DATA: path.join(tmp, 'yi-ratings.json') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('联机服务端没有按时启动')), SERVER_START_MS);
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('已启动')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', code => reject(new Error(`联机服务端退出：${code}`)));
  });
  return child;
}

function openWindow(problems) {
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    show: false,
    useContentSize: true,
    webPreferences: { offscreen: { deviceScaleFactor: 1 }, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(60);
  win.webContents.on('console-message', msg => {
    if (msg.message.startsWith('[fit]')) problems.push(msg.message);
    else if (msg.level === 'error') problems.push(`页面报错：${msg.message}`);
  });
  return win;
}

/** 联机与静态界面：页面载入后运行 fit-driver.ts 的 runAll */
async function runOnline(win, base, gamePort) {
  const server = `ws://127.0.0.1:${gamePort}`;
  await win.loadURL(`${base}/?server=${encodeURIComponent(server)}`);
  const probed = await win.webContents.executeJavaScript(`import('/scripts/fit-driver.ts').then(m => m.runAll(${JSON.stringify(server)}))`);
  console.log(`联机与静态界面已走完；提示条检查的条数：${JSON.stringify(probed)}`);
}

/** 单机场景：每个场景以三种语言各跑一次 */
async function runScenarios(win, base) {
  for (const name of SCENARIOS)
    for (const lang of LANGS) {
      await win.loadURL(`${base}/?scenario=${name}&hold=1`);
      await win.webContents.executeJavaScript(`import('/scripts/fit-driver.ts').then(m => m.runScenario(${lang}))`);
    }
  console.log(`单机场景已走完：${SCENARIOS.join('、')}，各三种语言`);
}

app.whenReady().then(async () => {
  const problems = [];
  let vite = null,
    game = null,
    failed = false;
  try {
    const { createServer } = await import('vite');
    vite = await createServer({ root: ROOT, server: { port: 0, strictPort: false }, logLevel: 'error' });
    await vite.listen();
    const base = `http://localhost:${vite.httpServer.address().port}`;
    const gamePort = await freePort();
    game = await startGameServer(gamePort);
    const win = openWindow(problems);
    await runOnline(win, base, gamePort);
    await runScenarios(win, base);
    win.destroy();
  } catch (err) {
    failed = true;
    console.error(`检查没有走完：${err.stack ?? err}`);
  } finally {
    game?.kill();
    await vite?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  for (const p of problems) console.error(p);
  if (!failed && !problems.length) console.log('界面文字均按设计字号放下（I18N-020、I18N-022）');
  app.exit(failed || problems.length ? 1 : 0);
});

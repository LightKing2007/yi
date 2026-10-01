/**
 * 弈 · 桌面版主进程：窗口与少量系统功能（退出、匹配成功时提醒、错误日志）。只允许运行一个实例。
 * 页面由自定义协议 app://yi/ 提供（模块脚本、Worker、本地存储都按普通网站的规则工作）。
 */
import { app, BrowserWindow, ipcMain, Menu, net, protocol, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.YI_DEV_URL;           // 开发时：YI_DEV_URL=http://localhost:5173 npm run app:dev

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

let win: BrowserWindow | null = null;

// ---------------- 日志 ----------------

/** 错误日志：userData/logs/yi.log，超过 1 MB 时改名为 yi.old.log 重新开始。只在本机，不上传 */
const logDir = () => path.join(app.getPath('userData'), 'logs');
const LOG_MAX = 1024 * 1024;

function writeLog(level: string, text: string) {
  try {
    const dir = logDir(), file = path.join(dir, 'yi.log');
    fs.mkdirSync(dir, { recursive: true });
    try { if (fs.statSync(file).size > LOG_MAX) fs.renameSync(file, path.join(dir, 'yi.old.log')); } catch { /* 还没有日志文件 */ }
    fs.appendFileSync(file, `[${new Date().toISOString()}] [${level}] ${text}\n`);
  } catch { /* 写不了日志也不能影响游戏 */ }
}

process.on('uncaughtException', e => writeLog('main', e.stack ?? String(e)));
process.on('unhandledRejection', e => writeLog('main', e instanceof Error ? e.stack ?? e.message : String(e)));

// ---------------- 窗口 ----------------

const boundsFile = () => path.join(app.getPath('userData'), 'window.json');

function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
    if (typeof b.width === 'number' && typeof b.height === 'number') return b as { x?: number; y?: number; width: number; height: number; max?: boolean };
  } catch { /* 第一次启动 */ }
  const wa = screen.getPrimaryDisplay().workAreaSize;
  return { width: Math.min(1320, Math.round(wa.width * 0.9)), height: Math.min(900, Math.round(wa.height * 0.9)) };
}

function saveBounds() {
  if (!win) return;
  try { fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), max: win.isMaximized() })); } catch { /* 忽略 */ }
}

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    ...b, minWidth: 800, minHeight: 600, show: false, title: '弈', backgroundColor: '#e0ddd9',
    ...(process.platform === 'linux' ? { icon: path.join(DIST, 'icon.png') } : {}),   // Linux 的窗口图标要自己给；macOS、Windows 用安装包里的
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  if (b.max) win.maximize();
  win.once('ready-to-show', () => win?.show());
  win.on('close', saveBounds);
  win.on('closed', () => { win = null; });
  win.webContents.on('render-process-gone', (_e, d) => writeLog('main', `页面进程退出：${d.reason}（${d.exitCode}）`));
  win.on('focus', () => win?.flashFrame(false));
  // 外部链接用系统浏览器打开，页面本身不跳转
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://') && !(DEV_URL && url.startsWith(DEV_URL))) e.preventDefault(); });
  // F11 全屏
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && win) win.setFullScreen(!win.isFullScreen());
  });
  win.loadURL(DEV_URL ?? 'app://yi/index.html');
}

// ---------------- 启动 ----------------

ipcMain.on('app:quit', () => app.quit());
ipcMain.on('app:log', (_e, level: unknown, text: unknown) => writeLog(String(level).slice(0, 16), String(text).slice(0, 8000)));
ipcMain.on('app:openLogs', () => { fs.mkdirSync(logDir(), { recursive: true }); shell.openPath(logDir()); });
// 窗口不在前台时匹配成功：任务栏闪烁 / 程序坞图标跳一下
ipcMain.on('app:attention', () => {
  if (!win || win.isFocused()) return;
  win.flashFrame(true);
  if (process.platform === 'darwin') app.dock?.bounce('informational');
});

// 只运行一个实例：再次打开时把已有的窗口调到前面
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});

app.whenReady().then(() => {
  if (!app.hasSingleInstanceLock()) return;
  writeLog('info', `启动 ${app.getVersion()} · ${process.platform} ${process.arch} · Electron ${process.versions.electron}`);
  protocol.handle('app', req => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(DIST, decodeURIComponent(pathname)));
    if (!file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);   // macOS 保留系统菜单（退出、编辑快捷键）
  createWindow();
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => app.quit());

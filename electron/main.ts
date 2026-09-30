/**
 * 弈 · 桌面版主进程：窗口与少量系统功能（退出、匹配成功时提醒）。
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
// 窗口不在前台时匹配成功：任务栏闪烁 / 程序坞图标跳一下
ipcMain.on('app:attention', () => {
  if (!win || win.isFocused()) return;
  win.flashFrame(true);
  if (process.platform === 'darwin') app.dock?.bounce('informational');
});

app.whenReady().then(() => {
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

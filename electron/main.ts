/**
 * 弈 · 桌面版主进程：窗口与少量系统功能（退出、匹配成功时提醒、错误日志）。只允许运行一个实例。
 * 页面由自定义协议 app://yi/ 提供（模块脚本、Worker、本地存储都按普通网站的规则工作）。
 */
import { app, BrowserWindow, ipcMain, Menu, net, protocol, safeStorage, screen, shell, type IpcMainEvent } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CredentialStore, encryptionUsable } from './credentials';
import { devOrigin, isAppUrl, MIN_HEIGHT_PX, MIN_WIDTH_PX, pageLog, parseBounds, type Bounds } from './guard';

const DIST = path.join(__dirname, '..', 'dist');
/** 开发服务器的源：只有未打包时读取，开发时 YI_DEV_URL=http://localhost:5173 npm run app:dev（A-11） */
const DEV_ORIGIN = devOrigin(process.env.YI_DEV_URL, app.isPackaged);
/** 游戏页面的入口 */
const APP_ENTRY = 'app://yi/index.html';
/** 第一次启动时的窗口大小：界面的设计尺寸，但不超过工作区的这个比例 */
const DESIGN_WIDTH_PX = 1320;
const DESIGN_HEIGHT_PX = 900;
const FIRST_SIZE_RATIO = 0.9;

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true } }]);

// 没有 GPU 加速的环境（虚拟机、显卡驱动被 Chromium 列入黑名单）中，以 SwiftShader 软件渲染 WebGL2（整改项 P1-18）。
// Chromium 已取消 WebGL 自动退回软件渲染，不加此开关时游戏提示“当前环境不支持 WebGL2”；有 GPU 时照常使用硬件渲染。
// 开关名中的 unsafe 指浏览器以软件渲染执行不可信网页的 WebGL 时攻击面更大；游戏只加载 asar 中自身的代码（SEC-035），
// 导航与新窗口均被拦截（SEC-031），影响有限。2026-10-05 项目所有者确认启用
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

let win: BrowserWindow | null = null;

// ---------------- 日志 ----------------

/** 错误日志：userData/logs/yi.log，超过 1 MB 时改名为 yi.old.log 重新开始。只在本机，不上传 */
const logDir = () => path.join(app.getPath('userData'), 'logs');
const LOG_MAX = 1024 * 1024;

function writeLog(level: string, text: string) {
  try {
    const dir = logDir(),
      file = path.join(dir, 'yi.log');
    fs.mkdirSync(dir, { recursive: true });
    try {
      if (fs.statSync(file).size > LOG_MAX) fs.renameSync(file, path.join(dir, 'yi.old.log'));
    } catch {
      /* 还没有日志文件 */
    }
    fs.appendFileSync(file, `[${new Date().toISOString()}] [${level}] ${text}\n`);
  } catch {
    /* 写不了日志也不能影响游戏 */
  }
}

process.on('uncaughtException', e => writeLog('main', e.stack ?? String(e)));
process.on('unhandledRejection', e => writeLog('main', e instanceof Error ? (e.stack ?? e.message) : String(e)));

// ---------------- 窗口 ----------------

const boundsFile = () => path.join(app.getPath('userData'), 'window.json');

/** 上次关闭时的窗口位置与大小（逐项校验，A-12）；第一次启动或文件损坏时按设计尺寸，由系统居中 */
function loadBounds(): Bounds {
  try {
    const saved = parseBounds(
      JSON.parse(fs.readFileSync(boundsFile(), 'utf8')),
      screen.getAllDisplays().map(display => display.workArea),
    );
    if (saved) return saved;
  } catch {
    /* 第一次启动还没有这个文件，或文件损坏：都按设计尺寸打开 */
  }
  const wa = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.min(DESIGN_WIDTH_PX, Math.round(wa.width * FIRST_SIZE_RATIO)),
    height: Math.min(DESIGN_HEIGHT_PX, Math.round(wa.height * FIRST_SIZE_RATIO)),
    max: false,
  };
}

function saveBounds() {
  if (!win) return;
  try {
    fs.writeFileSync(boundsFile(), JSON.stringify({ ...win.getNormalBounds(), max: win.isMaximized() }));
  } catch {
    /* 忽略 */
  }
}

function createWindow() {
  const { max, ...b } = loadBounds();
  win = new BrowserWindow({
    ...b,
    minWidth: MIN_WIDTH_PX,
    minHeight: MIN_HEIGHT_PX,
    show: false,
    title: '弈',
    backgroundColor: '#e0ddd9',
    ...(process.platform === 'linux' ? { icon: path.join(DIST, 'icon.png') } : {}), // Linux 的窗口图标要自己给；macOS、Windows 用安装包里的
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true, // 默认即为 true，按 SEC-030 显式写明（A-13）
      spellcheck: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  if (max) win.maximize();
  win.once('ready-to-show', () => win?.show());
  win.on('close', saveBounds);
  win.on('closed', () => {
    win = null;
  });
  win.webContents.on('render-process-gone', (_event, details) => writeLog('main', `页面进程退出：${details.reason}（${details.exitCode}）`));
  win.on('focus', () => win?.flashFrame(false));
  // 外部链接用系统浏览器打开，页面本身不跳转
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url).catch((err: unknown) => writeLog('main', `无法打开外部链接：${String(err)}`));
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url, DEV_ORIGIN)) event.preventDefault();
  });
  // F11 全屏
  win.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F11' && win) win.setFullScreen(!win.isFullScreen());
  });
  win.loadURL(DEV_ORIGIN ?? APP_ENTRY).catch((err: unknown) => writeLog('main', `页面加载失败：${String(err)}`));
}

// ---------------- 启动 ----------------

/** 只处理游戏页面自己发来的 IPC 消息（A-10，Electron 安全清单第 17 条）：发送方的框架须是 app://yi/ 或开发服务器 */
const fromApp = (event: Pick<IpcMainEvent, 'senderFrame'>) => isAppUrl(event.senderFrame?.url, DEV_ORIGIN);

// ---------------- 登录状态 ----------------

/** 加密保存的登录：userData/account.bin，只有本机当前系统用户能解密（阶段 6、7 设计第 5.4 条） */
const accountFile = () => path.join(app.getPath('userData'), 'account.bin');
const credentials = new CredentialStore(
  {
    available: () =>
      encryptionUsable(
        safeStorage.isEncryptionAvailable(),
        process.platform,
        process.platform === 'linux' ? safeStorage.getSelectedStorageBackend() : undefined,
      ),
    encrypt: text => safeStorage.encryptString(text),
    decrypt: data => safeStorage.decryptString(data),
  },
  {
    read: () => (fs.existsSync(accountFile()) ? fs.readFileSync(accountFile()) : undefined),
    write: data => {
      const temp = `${accountFile()}.tmp`;
      fs.writeFileSync(temp, data, { mode: 0o600 });
      fs.renameSync(temp, accountFile()); // 先写临时文件再改名，写到一半退出时不留下损坏的记录
    },
    remove: () => fs.rmSync(accountFile(), { force: true }),
  },
  Date.now,
);
ipcMain.handle('account:load', event => (fromApp(event) ? credentials.load() : undefined));
ipcMain.handle('account:save', (event, token: unknown, expiresAt: unknown) => fromApp(event) && credentials.save(token, expiresAt));
ipcMain.handle('account:clear', event => {
  if (fromApp(event)) credentials.clear();
});

ipcMain.on('app:quit', event => {
  if (fromApp(event)) app.quit();
});
ipcMain.on('app:log', (event, level: unknown, text: unknown) => {
  const entry = fromApp(event) ? pageLog(level, text) : null;
  if (entry) writeLog(entry.level, entry.text);
});
ipcMain.on('app:openLogs', event => {
  if (!fromApp(event)) return;
  fs.mkdirSync(logDir(), { recursive: true });
  void shell.openPath(logDir()); // 打不开文件夹时系统自会提示，游戏无须处理
});
// 窗口不在前台时匹配成功：任务栏闪烁 / 程序坞图标跳一下
ipcMain.on('app:attention', event => {
  if (!fromApp(event) || !win || win.isFocused()) return;
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
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null); // macOS 保留系统菜单（退出、编辑快捷键）
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});

app.on('window-all-closed', () => app.quit());

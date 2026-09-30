/**
 * 在不显示的 Electron 窗口里跑全部场景脚本并截图（固定 1320×900、像素比 1，不依赖屏幕）：
 *   npm run shots -- base      截图存到 .shots/base/（重构前的基准）
 *   npm run shots              截图存到 .shots/now/，再用 node scripts/compare-shots.mjs 对比
 * 自己起一个临时的开发服务器，跑完就关。
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const set = (process.argv.slice(2).find(a => !a.startsWith('-') && !a.endsWith('.cjs')) ?? 'now').replace(/[^\w.-]/g, '_');
const only = process.argv.find(a => a.startsWith('--scenario='))?.slice(11) ?? 'all';

app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 0, strictPort: false }, logLevel: 'error' });
  await server.listen();
  const port = server.httpServer.address().port;
  const win = new BrowserWindow({
    width: 1320, height: 900, show: false, useContentSize: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  win.webContents.setFrameRate(60);
  win.webContents.on('console-message', e => { if (e.level === 'warning' || e.level === 'error' || e.message.startsWith('[scenario] 没有')) console.log(e.message); });
  await win.loadURL(`http://localhost:${port}/?scenario=${encodeURIComponent(only)}&set=${set}`);
  const t0 = Date.now();
  let info = null;
  while (!info && Date.now() - t0 < 300000) {
    await new Promise(r => setTimeout(r, 500));
    info = await win.webContents.executeJavaScript('window.__scenario ?? null');
  }
  await new Promise(r => setTimeout(r, 800));                       // 等最后几张图写完
  if (!info) console.error('场景脚本没有跑完');
  else console.log(`截了 ${info.shots.length} 个时刻（每个时刻 3 张画布），存在 .shots/${set}/，窗口 ${info.size.join('×')}`);
  win.destroy();
  await server.close();
  app.exit(info ? 0 : 1);
});

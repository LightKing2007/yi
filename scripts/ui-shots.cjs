/**
 * 把游戏的几个界面截成图，用来检查各平台上的字体与排版（CI 里在 Windows、Linux 上跑，见 .github/workflows/ui-shots.yml）：
 *   npx electron scripts/ui-shots.cjs 输出目录
 * 在不显示的窗口里起一个临时的开发服务器，依次截开始菜单、对局、设置、更多、联机对战，中文与文言各一组。
 * 没有显卡的机器上用软件渲染（SwiftShader）画棋盘。
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const out = path.resolve(process.argv.find((a, i) => i >= 2 && !a.startsWith('-') && !a.endsWith('.cjs')) ?? 'ui-shots');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

const sleep = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
  const { createServer } = await import('vite');
  const server = await createServer({ root: path.join(__dirname, '..'), server: { port: 0 }, logLevel: 'error' });
  await server.listen();
  const port = server.httpServer.address().port;
  const win = new BrowserWindow({ width: 1320, height: 900, show: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.setFrameRate(30);
  win.webContents.on('console-message', e => { if (e.level === 'error') console.log('[页面]', e.message); });
  fs.mkdirSync(out, { recursive: true });
  const js = s => win.webContents.executeJavaScript(s);
  const shot = async name => { await sleep(1500); fs.writeFileSync(path.join(out, `${name}.png`), (await win.webContents.capturePage()).toPNG()); console.log('截图', name); };

  // 不联网：联机对战页只看排版
  const url = `http://localhost:${port}/?server=ws://127.0.0.1:9`;
  await win.loadURL(url);
  for (const [lang, tag] of [[1, 'zh'], [0, 'wy']]) {
    await js(`localStorage.setItem('yi.settings', JSON.stringify({ lang: ${lang}, nick: '棋手' })); 1`);
    await win.loadURL(url);
    await sleep(2500);
    const go = s => js(`window.__yi.controller.goScreen(${s}); 1`);
    await shot(`${tag}-1-menu`);
    await go(2); await shot(`${tag}-2-game`);
    await go(0); await sleep(800); await go(1); await shot(`${tag}-3-settings`);
    await go(0); await sleep(800); await go(3); await shot(`${tag}-4-more`);
    await go(0); await sleep(800); await go(4); await shot(`${tag}-5-online`);
    await go(0); await sleep(800);
  }
  const gl = await js(`(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c && c.getExtension('WEBGL_debug_renderer_info'); return c ? (d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'webgl2') : '没有 WebGL2'; })()`);
  console.log('渲染器', gl);
  win.destroy();
  await server.close();
  app.exit(0);
});

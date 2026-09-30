/** 桌面版预加载：只向页面暴露退出与提醒这两个接口（window.yiNative） */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('yiNative', {
  platform: process.platform,
  quit: () => ipcRenderer.send('app:quit'),
  attention: () => ipcRenderer.send('app:attention'),
});

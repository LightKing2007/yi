/** 桌面版预加载：只向页面暴露少量系统功能（window.yiNative）：退出、提醒、写错误日志、打开日志文件夹 */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('yiNative', {
  platform: process.platform,
  quit: () => ipcRenderer.send('app:quit'),
  attention: () => ipcRenderer.send('app:attention'),
  log: (level: string, text: string) => ipcRenderer.send('app:log', level, text),
  openLogs: () => ipcRenderer.send('app:openLogs'),
});

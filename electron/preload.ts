/** 桌面版预加载：只向页面暴露少量系统功能（window.yiNative）：退出、提醒、写错误日志、打开日志文件夹、加密保存登录状态（SEC-032：至多 10 个函数） */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('yiNative', {
  platform: process.platform,
  quit: () => ipcRenderer.send('app:quit'),
  attention: () => ipcRenderer.send('app:attention'),
  log: (level: string, text: string) => ipcRenderer.send('app:log', level, text),
  openLogs: () => ipcRenderer.send('app:openLogs'),
  loadLogin: () => ipcRenderer.invoke('account:load'),
  saveLogin: (token: string, expiresAt: string) => ipcRenderer.invoke('account:save', token, expiresAt),
  clearLogin: () => ipcRenderer.invoke('account:clear'),
});

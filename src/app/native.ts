/** 桌面版主进程提供的少量系统功能（electron/preload.ts 暴露为 window.yiNative；在浏览器里调试时没有） */
export interface YiNative {
  platform: string;
  quit(): void;
  attention(): void;
  log(level: string, text: string): void;
  openLogs(): void;
}

export const native = (): YiNative | undefined => (window as any).yiNative;

/** 把错误写进桌面版的日志文件（userData/logs/yi.log）；开发时同时打印到控制台 */
export function logError(where: string, e: unknown) {
  const text = e instanceof Error ? (e.stack ?? `${e.name}: ${e.message}`) : String(e);
  native()?.log('error', `${where}: ${text}`);
  if (import.meta.env?.DEV) console.error(`[${where}]`, e);
}

/** 页面里没被接住的错误都记下来 */
export function catchErrors() {
  window.addEventListener('error', e => logError('页面', e.error ?? `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', e => logError('页面', e.reason));
}

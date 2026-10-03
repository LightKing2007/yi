/** 桌面版主进程提供的少量系统功能（electron/preload.ts 暴露为 window.yiNative；在浏览器里调试时没有） */
export interface YiNative {
  platform: string;
  quit(): void;
  attention(): void;
  log(level: string, text: string): void;
  openLogs(): void;
}

export const native = (): YiNative | undefined => (window as any).yiNative;

/** 写一条日志到桌面版的日志文件（userData/logs/yi.log）；开发时同时打印到控制台（COD-064 允许开发模式分支使用 console） */
function writeLog(level: 'error' | 'warn', where: string, text: string, detail: unknown) {
  native()?.log(level, `${where}: ${text}`);
  if (import.meta.env?.DEV) console[level](`[${where}]`, detail);
}

/** 记一条错误：Error 带上调用栈 */
export function logError(where: string, err: unknown) {
  writeLog('error', where, err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err), err);
}

/** 记一条需要维护者留意、但不影响运行的情况 */
export function logWarn(where: string, text: string) {
  writeLog('warn', where, text, text);
}

/** 页面里没被接住的错误都记下来 */
export function catchErrors() {
  window.addEventListener('error', e => logError('页面', e.error ?? `${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
  window.addEventListener('unhandledrejection', e => logError('页面', e.reason));
}

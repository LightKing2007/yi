/** 桌面版主进程提供的少量系统功能（electron/preload.ts 暴露为 window.yiNative；在浏览器里调试时没有） */
import type { UpdateAction } from '../../electron/update';
/** 预加载向渲染页面提供的有限系统接口。 */
export interface YiNative {
  platform: string;
  quit(): void;
  attention(): void;
  log(level: string, text: string): void;
  openLogs(): void;
  /** 读取加密保存的登录；没有、已过期或解不开时为 undefined */
  loadLogin(): Promise<{ token: string; expiresAt: string } | undefined>;
  /** 加密保存一次登录；加密不可用时为 false，页面只在内存中保持登录 */
  saveLogin(token: string, expiresAt: string): Promise<boolean>;
  /** 删除保存的登录 */
  clearLogin(): Promise<void>;
  /** 请求更新操作；返回值作为 IPC 外部输入由更新模块校验。 */
  update(action: UpdateAction): Promise<unknown>;
  /** 订阅更新状态，返回解除订阅的函数，不暴露 IPC 事件对象。 */
  onUpdate(callback: (state: unknown) => void): () => void;
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

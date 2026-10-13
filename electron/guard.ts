/**
 * 桌面版主进程对外部输入的校验（SEC-030 至 SEC-032、COD-053）：开发服务器地址、页面地址与 IPC 发送方、日志参数、
 * 窗口位置文件 window.json。均为纯函数，不依赖 electron，由单元测试覆盖。
 */

/** 游戏页面所在的自定义协议与主机：app://yi/ */
const APP_PROTOCOL = 'app:';
const APP_HOST = 'yi';
/** 窗口的最小宽度（像素） */
export const MIN_WIDTH_PX = 800;
/** 窗口的最小高度（像素） */
export const MIN_HEIGHT_PX = 600;
/** 恢复上次的位置时，窗口与某个显示器的工作区至少要重叠这么多（像素），否则改由系统居中，免得窗口落在屏幕外拖不回来 */
export const VISIBLE_MIN_PX = 100;
/** 页面经 IPC 写日志时允许的级别（src/app/native.ts 只写这两种） */
const LOG_LEVELS: ReadonlySet<string> = new Set(['error', 'warn']);
/** 一条页面日志至多保留的字符数：调用栈再长也够用，超出的部分截掉 */
export const LOG_TEXT_MAX_CHARS = 8000;

/** 矩形区域（像素），与 Electron 的 Rectangle 相同 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 窗口的位置与大小；没有 x、y 时由系统居中 */
export interface Bounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
  max: boolean;
}

/** 解析地址，不合法时为空 */
function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null; // 不是合法的地址，按不可信处理即可，调用方据空值拒绝
  }
}

/**
 * 开发服务器的源（例如 `http://localhost:5173`）：只有未打包的开发版读取 YI_DEV_URL（A-11），且必须是 http 或 https 地址；
 * 打包后的正式版、或地址不合法时为空，正式版因此只加载 app://yi/
 */
export function devOrigin(raw: string | undefined, packaged: boolean): string | undefined {
  if (packaged || !raw) return undefined;
  const url = parseUrl(raw);
  return url && (url.protocol === 'http:' || url.protocol === 'https:') ? url.origin : undefined;
}

/**
 * 地址是否属于游戏自身：app://yi/ 下的页面，或开发服务器（dev 为其源）。按协议、主机与端口整体比较，
 * 不按前缀比较，免得 `http://localhost:5173@evil.example/` 之类的地址被当成开发服务器（SEC-031）
 */
export function isAppUrl(raw: string | undefined, dev: string | undefined): boolean {
  const url = raw === undefined ? null : parseUrl(raw);
  if (!url) return false;
  if (url.protocol === APP_PROTOCOL) return url.host === APP_HOST;
  return dev !== undefined && url.origin === dev;
}

/** 页面经 IPC 发来的一条日志：级别不在表内或内容不是字符串时为空；内容截到 LOG_TEXT_MAX_CHARS 个字符（SEC-032） */
export function pageLog(level: unknown, text: unknown): { level: string; text: string } | null {
  if (typeof level !== 'string' || !LOG_LEVELS.has(level) || typeof text !== 'string') return null;
  return { level, text: text.slice(0, LOG_TEXT_MAX_CHARS) };
}

/** 是否为有限的数 */
const finite = (val: unknown): val is number => typeof val === 'number' && Number.isFinite(val);

/** 是不是 JSON 对象（electron 层不能引用 src/shared/check.ts 的同名函数，ARC 第 1.1 条） */
const isRecord = (val: unknown): val is Record<string, unknown> => typeof val === 'object' && val !== null && !Array.isArray(val);

/** 字段 key 的值（不是对象时为 undefined）；不读原型链上的属性 */
const field = (obj: unknown, key: string): unknown => (isRecord(obj) && Object.hasOwn(obj, key) ? obj[key] : undefined);

/** 两个区间 [from1, from1 + len1) 与 [from2, from2 + len2) 重叠的长度 */
const overlap = (from1: number, len1: number, from2: number, len2: number) => Math.max(0, Math.min(from1 + len1, from2 + len2) - Math.max(from1, from2));

/** 把边长 len 限制在 [lo, hi] 内；hi 小于 lo 时取 lo */
const clampSide = (len: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(len)));

/** 窗口 rect 是否落在某个工作区内：重叠的宽、高都至少 VISIBLE_MIN_PX，且标题栏不高于该工作区的上沿 */
function onScreen(rect: Rect, areas: readonly Rect[]): boolean {
  return areas.some(
    area =>
      rect.y >= area.y &&
      overlap(rect.x, rect.width, area.x, area.width) >= VISIBLE_MIN_PX &&
      overlap(rect.y, rect.height, area.y, area.height) >= VISIBLE_MIN_PX,
  );
}

/**
 * 校验 window.json 的内容（A-12）：宽高须为有限的数，限制在最小尺寸与最大的工作区之间；位置须为有限的数，且窗口在某个显示器的
 * 工作区内，否则舍去位置、由系统居中（显示器拔掉或分辨率改变后，窗口不会落在屏幕外）。宽高不合法时整个文件作废，返回空
 */
export function parseBounds(raw: unknown, areas: readonly Rect[]): Bounds | null {
  const width = field(raw, 'width'),
    height = field(raw, 'height');
  if (!finite(width) || !finite(height)) return null;
  const size = {
    width: clampSide(width, MIN_WIDTH_PX, Math.max(...areas.map(area => area.width))),
    height: clampSide(height, MIN_HEIGHT_PX, Math.max(...areas.map(area => area.height))),
  };
  const max = field(raw, 'max') === true;
  const x = field(raw, 'x'),
    y = field(raw, 'y');
  if (!finite(x) || !finite(y)) return { ...size, max };
  const rect = { x: Math.round(x), y: Math.round(y), ...size };
  return onScreen(rect, areas) ? { ...rect, max } : { ...size, max };
}

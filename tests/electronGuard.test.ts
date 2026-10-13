/** 桌面版主进程的输入校验（electron/guard.ts，整改项 P2-20）：开发服务器地址、IPC 发送方、页面日志、窗口位置 */
import { describe, expect, it } from 'vitest';
import { devOrigin, isAppUrl, LOG_TEXT_MAX_CHARS, MIN_HEIGHT_PX, MIN_WIDTH_PX, pageLog, parseBounds, VISIBLE_MIN_PX } from '../electron/guard';

const DEV = 'http://localhost:5173';
/** 两块并排的显示器：主屏 1440×900（工作区去掉 25 像素的菜单栏），右侧副屏 1920×1080 */
const AREAS = [
  { x: 0, y: 25, width: 1440, height: 875 },
  { x: 1440, y: 0, width: 1920, height: 1080 },
];

describe('开发服务器地址', () => {
  it('打包后的正式版不读取 YI_DEV_URL', () => {
    expect(devOrigin(DEV, true)).toBeUndefined();
  });
  it('未打包时取地址的源；不是 http(s) 地址或不合法时不用', () => {
    expect(devOrigin(`${DEV}/index.html`, false)).toBe(DEV);
    expect(devOrigin('file:///etc/passwd', false)).toBeUndefined();
    expect(devOrigin('not a url', false)).toBeUndefined();
    expect(devOrigin(undefined, false)).toBeUndefined();
  });
});

describe('地址是否属于游戏自身', () => {
  it('app://yi/ 下的页面属于游戏，其他主机或协议不属于', () => {
    expect(isAppUrl('app://yi/index.html', undefined)).toBe(true);
    expect(isAppUrl('app://evil/index.html', undefined)).toBe(false);
    expect(isAppUrl('https://example.com/', undefined)).toBe(false);
    expect(isAppUrl(undefined, undefined)).toBe(false);
    expect(isAppUrl('', undefined)).toBe(false);
  });
  it('开发服务器按源整体比较，前缀相同的其他主机不算', () => {
    expect(isAppUrl(`${DEV}/src/main.tsx`, DEV)).toBe(true);
    expect(isAppUrl('http://localhost:5173@evil.example/', DEV)).toBe(false);
    expect(isAppUrl('http://localhost:5174/', DEV)).toBe(false);
  });
  it('正式版（没有开发服务器）不接受任何 http 页面', () => {
    expect(isAppUrl(`${DEV}/`, undefined)).toBe(false);
  });
});

describe('页面经 IPC 写日志', () => {
  it('级别为 error、warn 且内容为字符串时接受，内容截到上限', () => {
    expect(pageLog('warn', 'x'.repeat(LOG_TEXT_MAX_CHARS + 5))).toEqual({ level: 'warn', text: 'x'.repeat(LOG_TEXT_MAX_CHARS) });
    expect(pageLog('error', '出错')).toEqual({ level: 'error', text: '出错' });
  });
  it('级别不在表内、或参数不是字符串时拒绝', () => {
    expect(pageLog('main', '冒充主进程')).toBeNull();
    expect(pageLog({ toString: () => 'error' }, '对象')).toBeNull();
    expect(pageLog('error', 42)).toBeNull();
  });
});

describe('窗口位置文件 window.json', () => {
  it('合格的位置与大小原样恢复，含最大化', () => {
    const saved = { x: 100, y: 80, width: 1200, height: 800, max: true };
    expect(parseBounds(saved, AREAS)).toEqual(saved);
  });
  it('在副屏上的窗口照常恢复', () => {
    expect(parseBounds({ x: 2000, y: 100, width: 1000, height: 700 }, AREAS)).toEqual({ x: 2000, y: 100, width: 1000, height: 700, max: false });
  });
  it('副屏拔掉后，原来在副屏上的窗口舍去位置、由系统居中', () => {
    expect(parseBounds({ x: 2000, y: 100, width: 1000, height: 700 }, AREAS.slice(0, 1))).toEqual({ width: 1000, height: 700, max: false });
  });
  it('与工作区重叠不足时舍去位置；刚好够时保留', () => {
    const edge = 1440 - VISIBLE_MIN_PX;
    expect(parseBounds({ x: edge + 1, y: 100, width: 1000, height: 700 }, AREAS.slice(0, 1))).toEqual({ width: 1000, height: 700, max: false });
    expect(parseBounds({ x: edge, y: 100, width: 1000, height: 700 }, AREAS.slice(0, 1))).toMatchObject({ x: edge });
  });
  it('标题栏高出工作区上沿时舍去位置', () => {
    expect(parseBounds({ x: 100, y: 24, width: 1000, height: 700 }, AREAS.slice(0, 1))).toEqual({ width: 1000, height: 700, max: false });
  });
  it('大小限制在最小尺寸与最大的工作区之间', () => {
    expect(parseBounds({ width: 10, height: -5 }, AREAS)).toEqual({ width: MIN_WIDTH_PX, height: MIN_HEIGHT_PX, max: false });
    expect(parseBounds({ width: 1e9, height: 1e9 }, AREAS)).toEqual({ width: 1920, height: 1080, max: false });
  });
  it('位置不是有限的数时舍去位置；max 不是 true 时按未最大化', () => {
    expect(parseBounds({ x: '100', y: null, width: 1000, height: 700, max: 'yes' }, AREAS)).toEqual({ width: 1000, height: 700, max: false });
    expect(parseBounds({ x: Infinity, y: 0, width: 1000, height: 700 }, AREAS)).toEqual({ width: 1000, height: 700, max: false });
  });
  it('宽高不合法或内容不是对象时整个作废', () => {
    for (const raw of [null, [], 'x', { width: '1000', height: 700 }, { width: NaN, height: 700 }, { height: 700 }]) expect(parseBounds(raw, AREAS)).toBeNull();
  });
  it('原型链上的属性不算数', () => {
    const raw: unknown = Object.create({ width: 1000, height: 700 });
    expect(parseBounds(raw, AREAS)).toBeNull();
    expect(parseBounds(JSON.parse('{"__proto__": {"x": 5, "y": 30}, "width": 1000, "height": 700}'), AREAS)).toEqual({ width: 1000, height: 700, max: false });
  });
});

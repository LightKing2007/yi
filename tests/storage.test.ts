/**
 * 本地存储中的 JSON 值（src/app/storage.ts；DAT-080 至 DAT-082、VER-012）：版本号、逐字段校验、损坏时另存原值、
 * 降级安装时只读，以及玩家设置（src/app/settings.ts）按这套规则读写
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NICK_MAX_CHARS, UI_SCALES } from '../src/app/settings';
import { loadStored, saveStored, type StoreSpec } from '../src/app/storage';
import { bool, intIn, text } from '../src/shared/check';

// ---------------- 浏览器环境的替身 ----------------

const storage = new Map<string, string>();
/** 本地存储是否可用：false 时读写都抛异常（隐私模式、配额已满） */
let available = true;
/** 写进桌面版日志文件的 warn */
const warns: string[] = [];
const guard = () => {
  if (!available) throw new Error('本地存储不可用');
};
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (key: string) => (guard(), storage.get(key) ?? null),
    setItem: (key: string, val: string) => {
      guard();
      storage.set(key, val);
    },
    removeItem: (key: string) => {
      guard();
      storage.delete(key);
    },
  },
  yiNative: {
    log: (level: string, text: string) => {
      if (level === 'warn') warns.push(text);
    },
  },
});

beforeEach(() => {
  storage.clear();
  available = true;
  warns.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {}); // 开发模式下日志同时打印到控制台，测试中不必显示
});

/** 测试用的值：第 2 版 */
interface Sample {
  on: boolean;
  level: number;
  name: string;
}
const SPEC: StoreSpec<Sample> = {
  key: 'yi.sample',
  version: 2,
  defaults: { on: true, level: 1, name: '' },
  fields: { on: bool, level: intIn(0, 2), name: text(8) },
};
const put = (val: unknown) => storage.set(SPEC.key, typeof val === 'string' ? val : JSON.stringify(val));
const stored = () => JSON.parse(storage.get(SPEC.key) ?? 'null');

describe('本地存储的读取与校验', () => {
  it('没有存过：使用默认值，可以写入；不写入任何东西，也不记日志', () => {
    expect(loadStored(SPEC)).toEqual({ value: SPEC.defaults, writable: true });
    expect(storage.size).toBe(0);
    expect(warns).toEqual([]);
  });

  it('当前版本的合格值：原样读出，不写回', () => {
    put({ v: 2, on: false, level: 2, name: '甲' });
    expect(loadStored(SPEC).value).toEqual({ on: false, level: 2, name: '甲' });
    expect(stored()).toEqual({ v: 2, on: false, level: 2, name: '甲' });
    expect(warns).toEqual([]);
  });

  it('不合格的字段改用默认值并记日志，未知字段丢弃，修正后的值写回（DAT-080）', () => {
    put('{"v":2,"on":"yes","level":3,"name":7,"extra":1,"__proto__":{"on":false}}');
    const { value } = loadStored(SPEC);
    expect(value).toEqual(SPEC.defaults);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(warns).toEqual(['本地存储: yi.sample 中不合格的字段改用默认值：on、level、name']);
    expect(stored()).toEqual({ v: 2, ...SPEC.defaults });
  });

  it('数值为小数、负零或超出范围，字符串过长时同样不合格', () => {
    for (const bad of [{ level: 1.5 }, { level: -1 }, { name: '一二三四五六七八九' }]) {
      put({ v: 2, ...bad });
      expect(loadStored(SPEC).value, JSON.stringify(bad)).toEqual(SPEC.defaults);
    }
    put('{"v":2,"level":-0}'); // JSON.parse 才能得到负零
    expect(loadStored(SPEC).value).toEqual(SPEC.defaults);
    expect(warns.at(-1)).toBe('本地存储: yi.sample 中不合格的字段改用默认值：level');
  });

  it('不是合法的 JSON：原值改存到“键名.corrupt”，原键删除，使用默认值并记日志（DAT-081）', () => {
    put('{"on":tru');
    expect(loadStored(SPEC)).toEqual({ value: SPEC.defaults, writable: true });
    expect(storage.get('yi.sample.corrupt')).toBe('{"on":tru');
    expect(storage.has(SPEC.key)).toBe(false);
    expect(warns).toEqual(['本地存储: yi.sample 不是合法的 JSON，原值已另存为 yi.sample.corrupt，改用默认值']);
  });

  it('不是对象，或版本号不是非负整数：同样按损坏处理', () => {
    for (const raw of ['[1,2]', '"text"', '7', '{"v":-1}', '{"v":1.5}', '{"v":"2"}', '{"v":null}']) {
      warns.length = 0;
      put(raw);
      expect(loadStored(SPEC).value, raw).toEqual(SPEC.defaults);
      expect(storage.get('yi.sample.corrupt'), raw).toBe(raw);
      expect(warns, raw).toHaveLength(1);
    }
  });

  it('旧版本存的 null（表示没有）：使用默认值，不算损坏', () => {
    put('null');
    expect(loadStored(SPEC).value).toEqual(SPEC.defaults);
    expect(storage.has('yi.sample.corrupt')).toBe(false);
    expect(warns).toEqual([]);
  });
});

describe('本地存储的版本', () => {
  it('没有版本号的旧值算作第 0 版：逐字段读出，迁移后写回当前版本', () => {
    put({ on: false, level: 0 });
    expect(loadStored(SPEC)).toEqual({ value: { on: false, level: 0, name: '' }, writable: true });
    expect(stored()).toEqual({ v: 2, on: false, level: 0, name: '' });
  });

  it('由更新版本写入（降级安装）：只读使用能识别的字段，不写回，并记日志（VER-012）', () => {
    put({ v: 3, on: false, level: 9, future: true });
    expect(loadStored(SPEC)).toEqual({ value: { on: false, level: 1, name: '' }, writable: false });
    expect(stored()).toEqual({ v: 3, on: false, level: 9, future: true });
    expect(warns.at(-1)).toBe('本地存储: yi.sample 由更新的版本写入（第 3 版，本程序支持到第 2 版），只读使用，不写回');
  });

  it('写入时带上当前版本号', () => {
    saveStored(SPEC, { on: false, level: 2, name: '乙' });
    expect(stored()).toEqual({ v: 2, on: false, level: 2, name: '乙' });
  });

  it('本地存储读写都抛异常（隐私模式、配额已满）：读取用默认值，写入失败不影响运行（DAT-082）', () => {
    put({ v: 2, on: false });
    available = false;
    expect(loadStored(SPEC)).toEqual({ value: SPEC.defaults, writable: true });
    expect(() => saveStored(SPEC, SPEC.defaults)).not.toThrow();
  });
});

/** 换一份本地存储内容后重新加载设置模块（设置在模块加载时读取） */
async function loadSettings(raw?: unknown) {
  if (raw !== undefined) storage.set('yi.settings', JSON.stringify(raw));
  vi.resetModules();
  return import('../src/app/settings');
}

describe('玩家设置', () => {
  it('昵称不是字符串、音量超出 0 到 1、语言与缩放不在可选范围内时改用默认值，其余设置照常保留（F-22）', async () => {
    const { settings, DEFAULTS } = await loadSettings({ v: 1, nick: 7, volume: 5, lang: 9, uiScale: 3, music: false, light: 4 });
    expect(settings.value).toEqual({ ...DEFAULTS, music: false, light: 4 });
    expect(settings.value.nick.trim()).toBe('');
  });

  it('每一项设置刚好越界时都改用默认值；取到边界上的值时都保留', async () => {
    const outside = { music: 1, musicVol: 1.01, sound: 'on', volume: -0.01, animSpeed: 3, follow: -1, fx: 3, shake: null, light: 5, lastMark: 0 };
    const outside2 = { humanWhite: 'no', aiLevel: 3, renju: [], nick: {}, lang: 3, theme: 2, coords: 1, uiScale: 0.84 };
    const { settings, DEFAULTS } = await loadSettings({ v: 1, ...outside, ...outside2 });
    expect(settings.value).toEqual(DEFAULTS);
    const edges = { musicVol: 1, volume: 0, animSpeed: 2, follow: 0, fx: 0, light: 4, aiLevel: 2, lang: 2, theme: 1, uiScale: 0.85 };
    const again = await loadSettings({ v: 1, ...edges });
    expect(again.settings.value).toEqual({ ...DEFAULTS, ...edges });
  });

  it('界面缩放接受“小”到“特大”之间的值，昵称接受到码元上限为止', async () => {
    const { settings } = await loadSettings({ v: 1, uiScale: UI_SCALES[0], nick: '字'.repeat(NICK_MAX_CHARS) });
    expect([settings.value.uiScale, settings.value.nick.length]).toEqual([UI_SCALES[0], NICK_MAX_CHARS]);
    const again = await loadSettings({ v: 1, uiScale: 1.31, nick: '字'.repeat(NICK_MAX_CHARS + 1) });
    expect([again.settings.value.uiScale, again.settings.value.nick]).toEqual([1, '']);
  });

  it('修改后带版本号保存；恢复默认时保留昵称与语言', async () => {
    const { setSettings, resetSettings, settings } = await loadSettings();
    setSettings({ nick: '甲', lang: 2, music: false });
    expect(JSON.parse(storage.get('yi.settings') ?? 'null')).toMatchObject({ v: 1, nick: '甲', lang: 2, music: false });
    resetSettings();
    expect(settings.value).toMatchObject({ nick: '甲', lang: 2, music: true });
  });

  it('设置由更新版本写入（降级安装）：读出能识别的字段，修改只在本次生效，不写回（VER-012）', async () => {
    const newer = { v: 9, music: false, future: 1 };
    const { setSettings, settings } = await loadSettings(newer);
    expect(settings.value.music).toBe(false);
    setSettings({ sound: false });
    expect(settings.value.sound).toBe(false);
    expect(JSON.parse(storage.get('yi.settings') ?? 'null')).toEqual(newer);
  });
});

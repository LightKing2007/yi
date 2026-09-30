/** 玩家设置：保存在本机（浏览器 / 桌面版的本地存储），修改后自动保存 */
import { signal } from '@preact/signals';

export enum Lang { WY = 0, ZH = 1, EN = 2 }

export interface Settings {
  music: boolean;
  musicVol: number;      // 0..1
  sound: boolean;
  volume: number;        // 0..1
  animSpeed: number;     // 落子动画：0 慢 1 标准 2 快
  follow: number;        // 预览棋子跟随：0 柔和 1 标准 2 跟手
  fx: number;            // 终局特效：0 关闭 1 简洁 2 完整
  shake: boolean;        // 屏幕震动
  light: number;         // 光影：0 无 1 黄昏 2 晨曦 3 月夜 4 竹影
  lastMark: boolean;     // 标记最后一手
  humanWhite: boolean;   // 人机对弈时玩家执白（电脑先行）
  aiLevel: number;       // 电脑难度：0 简单 1 普通 2 困难
  renju: boolean;        // 五子棋黑棋禁手
  nick: string;          // 联机昵称
  lang: Lang;
  theme: number;         // 0 浅色 1 深色
  coords: boolean;       // 棋盘坐标
  uiScale: number;       // 界面缩放（相对于自动适配的倍率）
}

export const DEFAULTS: Settings = {
  music: true, musicVol: 0.55, sound: true, volume: 0.8,
  animSpeed: 1, follow: 1, fx: 2, shake: true, light: 1,
  lastMark: true, humanWhite: false, aiLevel: 1, renju: true,
  nick: '', lang: Lang.WY, theme: 0, coords: false, uiScale: 1,
};

const KEY = 'yi.settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* 隐私模式等读不到时用默认值 */ }
  return { ...DEFAULTS };
}

export const settings = signal<Settings>(load());

export function setSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(settings.value)); } catch { /* 忽略 */ }
}

export function resetSettings() {
  const keep = { nick: settings.value.nick, lang: settings.value.lang };
  settings.value = { ...DEFAULTS, ...keep };
  try { localStorage.setItem(KEY, JSON.stringify(settings.value)); } catch { /* 忽略 */ }
}

/** 人机对弈时电脑执的颜色 */
export const aiColor = () => (settings.value.humanWhite ? 1 : 2);

/** 落子类动画的时长倍率 */
export const animK = () => (settings.value.animSpeed === 0 ? 1.6 : settings.value.animSpeed === 2 ? 0.6 : 1.0);

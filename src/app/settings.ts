/** 玩家设置：保存在本机（浏览器 / 桌面版的本地存储），修改后自动保存；读取时逐字段校验（DAT-080） */
import { signal } from '@preact/signals';
import { bool, intIn, numIn, text } from '../shared/check';
import { NAME_MAX } from '../shared/protocol';
import { loadStored, saveStored, type StoreSpec } from './storage';

export enum Lang {
  WY = 0,
  ZH = 1,
  EN = 2,
}

export interface Settings {
  music: boolean;
  musicVol: number; // 0..1
  sound: boolean;
  volume: number; // 0..1
  animSpeed: number; // 落子动画：0 慢 1 标准 2 快
  follow: number; // 预览棋子跟随：0 柔和 1 标准 2 跟手
  fx: number; // 终局特效：0 关闭 1 简洁 2 完整
  shake: boolean; // 屏幕震动
  light: number; // 光影：0 无 1 黄昏 2 晨曦 3 月夜 4 竹影
  lastMark: boolean; // 标记最后一手
  humanWhite: boolean; // 人机对弈时玩家执白（电脑先行）
  aiLevel: number; // 电脑难度：0 简单 1 普通 2 困难
  renju: boolean; // 五子棋黑棋禁手
  nick: string; // 联机昵称
  lang: Lang;
  theme: number; // 0 浅色 1 深色
  coords: boolean; // 棋盘坐标
  uiScale: number; // 界面缩放（相对于自动适配的倍率）
}

export const DEFAULTS: Settings = {
  music: true,
  musicVol: 0.55,
  sound: true,
  volume: 0.8,
  animSpeed: 1,
  follow: 1,
  fx: 2,
  shake: true,
  light: 1,
  lastMark: true,
  humanWhite: false,
  aiLevel: 1,
  renju: true,
  nick: '',
  lang: Lang.WY,
  theme: 0,
  coords: false,
  uiScale: 1,
};

/** 界面缩放的几档（相对于自动适配的倍率）：小、标准、大、特大 */
export const UI_SCALES = [0.85, 1, 1.15, 1.3];
/** 一个字素最多按几个 UTF-16 码元计（带肤色的表情、组合字符） */
const CHARS_PER_GRAPHEME = 8;
/** 昵称原文的长度上限（UTF-16 码元数）：昵称最多 NAME_MAX 个字素 */
export const NICK_MAX_CHARS = NAME_MAX * CHARS_PER_GRAPHEME;
/** 三档选项（落子动画、预览跟随、终局特效、电脑难度、语言）的最大取值 */
const LEVEL_MAX = 2;
/** 光影的最大取值：0 无 1 黄昏 2 晨曦 3 月夜 4 竹影 */
const LIGHT_MAX = 4;

const level = intIn(0, LEVEL_MAX);
const unit = numIn(0, 1);

/** 设置在本地存储中的格式（DAT-080）：第 1 版起带版本号 v，之前写入的算作第 0 版，字段相同 */
const STORE: StoreSpec<Settings> = {
  key: 'yi.settings',
  version: 1,
  defaults: DEFAULTS,
  fields: {
    music: bool,
    musicVol: unit,
    sound: bool,
    volume: unit,
    animSpeed: level,
    follow: level,
    fx: level,
    shake: bool,
    light: intIn(0, LIGHT_MAX),
    lastMark: bool,
    humanWhite: bool,
    aiLevel: level,
    renju: bool,
    nick: text(NICK_MAX_CHARS),
    lang: level,
    theme: intIn(0, 1),
    coords: bool,
    uiScale: numIn(Math.min(...UI_SCALES), Math.max(...UI_SCALES)),
  },
};

const loaded = loadStored(STORE);
/** 由更新版本的程序写入的设置只读使用，不写回（VER-012） */
const writable = loaded.writable;

export const settings = signal<Settings>(loaded.value);

/** 保存当前设置 */
function save() {
  if (writable) saveStored(STORE, settings.value);
}

export function setSettings(patch: Partial<Settings>) {
  settings.value = { ...settings.value, ...patch };
  save();
}

export function resetSettings() {
  const keep = { nick: settings.value.nick, lang: settings.value.lang };
  settings.value = { ...DEFAULTS, ...keep };
  save();
}

/** 人机对弈时电脑执的颜色 */
export const aiColor = () => (settings.value.humanWhite ? 1 : 2);

/** 落子类动画的时长倍率 */
export const animK = () => (settings.value.animSpeed === 0 ? 1.6 : settings.value.animSpeed === 2 ? 0.6 : 1.0);

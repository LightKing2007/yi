/** 深浅两套配色（画布里的背景与棋盘投影；界面文字的颜色在 CSS 里） */
import { settings } from '../app/settings';

export interface Theme {
  bgTop: [number, number, number];
  bgBot: [number, number, number];
  boardShadow: number;
  iconShadow: number;
}

export const THEMES: Theme[] = [
  { bgTop: [0.945, 0.937, 0.922], bgBot: [0.878, 0.868, 0.85], boardShadow: 0.3, iconShadow: 0.7 },
  { bgTop: [0.125, 0.122, 0.13], bgBot: [0.062, 0.06, 0.066], boardShadow: 0.62, iconShadow: 0.9 },
];

export const theme = () => THEMES[settings.value.theme ? 1 : 0];

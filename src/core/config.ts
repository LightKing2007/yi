/** 一局棋的规则设置 */
import { GameType } from './types';

export interface GameConfig {
  type: GameType;
  /** 路数：五子棋 15；围棋 9 / 13 / 19 */
  size: number;
  /** 五子棋黑棋禁手 */
  renju: boolean;
  /** 围棋贴目 */
  komi: number;
}

export const gameConfig = (type: GameType, size: number, renju = true, komi = 7.5): GameConfig => ({
  type,
  size,
  renju: type === GameType.Gomoku && renju,
  komi,
});

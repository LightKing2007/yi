/** 棋规与操作类帮助文章，保持目录中的显示顺序。 */
import gomokuForbidden from '../support/gomoku-forbidden.md?raw';
import gomokuFiveNotWin from '../support/gomoku-five-not-win.md?raw';
import goIllegalPoint from '../support/go-illegal-point.md?raw';
import goScoring from '../support/go-scoring.md?raw';
import undoDraw from '../support/undo-draw.md?raw';
import viewFinalBoard from '../support/view-final-board.md?raw';
import shortcuts from '../support/shortcuts.md?raw';

/** 棋规与操作类 Markdown 源文件及问题地址。 */
export const SOURCES: readonly (readonly [string, string])[] = [
  ['gomoku-forbidden', gomokuForbidden],
  ['gomoku-five-not-win', gomokuFiveNotWin],
  ['go-illegal-point', goIllegalPoint],
  ['go-scoring', goScoring],
  ['undo-draw', undoDraw],
  ['view-final-board', viewFinalBoard],
  ['shortcuts', shortcuts],
];

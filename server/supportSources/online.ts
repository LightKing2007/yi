/** 联机对战类帮助文章，保持目录中的显示顺序。 */
import matchmakingWait from '../support/matchmaking-wait.md?raw';
import acceptMatch from '../support/accept-match.md?raw';
import joinRoom from '../support/join-room.md?raw';
import versionConnection from '../support/version-connection.md?raw';
import disconnectResult from '../support/disconnect-result.md?raw';
import timerPaused from '../support/timer-paused.md?raw';
import rankElo from '../support/rank-elo.md?raw';
import changeNickname from '../support/change-nickname.md?raw';

/** 联机对战类 Markdown 源文件及问题地址。 */
export const SOURCES: readonly (readonly [string, string])[] = [
  ['matchmaking-wait', matchmakingWait],
  ['accept-match', acceptMatch],
  ['join-room', joinRoom],
  ['version-connection', versionConnection],
  ['disconnect-result', disconnectResult],
  ['timer-paused', timerPaused],
  ['rank-elo', rankElo],
  ['change-nickname', changeNickname],
];

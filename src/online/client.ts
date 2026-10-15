/**
 * 联机会话的入口：匹配 / 排位队列、配对确认、好友房间，以及对局中的各种请求。
 * 连接服务器是自动的，界面上不出现“服务器”：进入多人游戏时在后台连上，回到开始菜单时断开。
 * 对局本身仍是本地的 game：服务端每确认一手（moved、undone……），就调用同一套规则照做，
 * 所以落子、提子、悔棋、点目的动画与单机完全一样。协议见 shared/protocol.ts。
 *
 * 实现分在同目录的 state（状态）、connection（连接）、handlers（服务端消息的处理）、frame（每帧的检查）、
 * actions（玩家的操作）中（整改项 P2-12）。本文件把消息的处理登记给连接，提供控制器用的接口 online，并再导出各模块的公开接口
 */
import { Screen } from '../app/state';
import { Phase, changed, inGame, myTurn, st } from './state';
import { connect, disconnect, setMessageHandler } from './connection';
import { askLeave, closeRoom, confirm, mark, move, pass, undo, unqueue } from './actions';
import { handle } from './handlers';
import { update } from './frame';

// 会话的状态已移到 state.ts（整改项 P2-12）；对外的部分仍从这里导出，引用方不必改动
export { Phase, bindNavigation, inGame, myTurn, netTick, newerVersion, note, ratingOf, st, tr, type Msg } from './state';

// 连接已移到 connection.ts（整改项 P2-12）：收到的消息经这里登记的 handle 处理，两个模块因此不互相引用
setMessageHandler(handle);
export { connect, disconnect, setRetryRandom } from './connection';

// 每帧的检查已移到 frame.ts（整改项 P2-12）
export { update } from './frame';

// 玩家的操作已移到 actions.ts（整改项 P2-12）
export {
  agree,
  askLeave,
  closeRoom,
  confirm,
  createRoom,
  draw,
  joinRoom,
  leave,
  mark,
  move,
  pass,
  playAgain,
  queue,
  rematch,
  reply,
  resign,
  resume,
  undo,
  unqueue,
} from './actions';

/** 控制器用的接口 */
export const online = {
  state: st,
  inGame,
  myTurn,
  move,
  mark,
  undo,
  pass,
  askLeave,
  /** Esc 时先处理联机里的一层（取消匹配、拒绝配对、关房间）；处理了返回 true */
  handleEscape(s: Screen) {
    if (s === Screen.Online && st.phase === Phase.Queue) {
      unqueue();
      return true;
    }
    if (s === Screen.Online && st.phase === Phase.Found) {
      confirm(false);
      return true;
    }
    if (s === Screen.Online && st.phase === Phase.Hosting) {
      closeRoom();
      return true;
    }
    if (s === Screen.Game && st.leaveAsk) {
      st.leaveAsk = false;
      changed();
      return true;
    }
    return false;
  },
  /** 进多人游戏页时在后台连上服务器；回到开始菜单时断开 */
  onScreen(_from: Screen, to: Screen) {
    if (to === Screen.Online) connect();
    if (to === Screen.Menu && !inGame()) disconnect();
    if (to === Screen.Game && !inGame()) st.shownOnline = false;
  },
  update,
};

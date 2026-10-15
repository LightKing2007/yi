/**
 * 每帧的检查（整改项 P2-12 自 client.ts 拆出）：对局中断线后按时重连、心跳与静默断开的检测、重连后等不到对局、
 * 配对确认与离开对局的时限，以及多人游戏界面的定时重绘。页面在后台时另以定时器驱动。
 */
import { now } from '../core/clock';
import { other } from '../core/types';
import { screen, Screen } from '../app/state';
import { GRACE_SECS, PING_SECS, SILENT_SECS } from '../shared/protocol';
import { Phase, changed, goScreen, inGame, note, st } from './state';
import { connect, hasSocket, isOpen, lost, netClose, resetRetry, send } from './connection';
import { applyOver, resumeFailed } from './handlers';

let wasInGame = false,
  lastHalf = 0;

/** 每帧调用：重连、心跳、静默断开检测、各种限时，以及多人游戏界面的定时重绘 */
export function update(time: number) {
  retryTick(time);
  heartbeatTick(time);
  if (st.resumeBy && time > st.resumeBy) resumeFailed();
  foundTick(time);
  leftGameTick(time);
  redrawTick(time);
}

/** 对局中断线：到点就重连；超过对局保留期就放弃这一局 */
function retryTick(time: number) {
  if (!st.reconnecting || hasSocket()) return;
  if (time - st.lostAt <= GRACE_SECS) {
    if (time >= st.retryAt) connect();
    return;
  }
  st.reconnecting = false;
  st.phase = Phase.Off;
  st.error = ['网络连接失败，请检查网络后重试'];
  resetRetry();
  if (!st.over) applyOver(other(st.myColor), 'disconnect');
}

/** 按时发心跳；很久没收到服务端的任何消息（连心跳回应都没有）时，连接多半已经静默断开，主动关掉，对局中会自动重连 */
function heartbeatTick(time: number) {
  if (!isOpen()) return;
  if (time >= st.pingAt) {
    send({ t: 'ping' });
    st.pingAt = time + PING_SECS;
  }
  if (st.lastRecv && time - st.lastRecv > SILENT_SECS) {
    netClose();
    lost();
  }
}

/** 配对确认的时限过后多等几秒仍停在“找到对手”，就回到大厅（服务端也会判，这里只是保证界面不会停住） */
const FOUND_SLACK_SECS = 3;
function foundTick(time: number) {
  if (st.phase === Phase.Found && time - st.foundAt > st.foundSecs + FOUND_SLACK_SECS) {
    st.phase = Phase.Lobby;
    st.opp = null;
    changed();
  }
}

/** 最近一条提示在这么多秒内仍算新的：离开对局时不用断线提示覆盖它 */
const NOTICE_FRESH_SECS = 4;
/** 联机对局中连接彻底断了：回到多人游戏页 */
function leftGameTick(time: number) {
  if (wasInGame && !inGame() && screen.value === Screen.Game) {
    if (!st.notice.length || time - st.noticeAt > NOTICE_FRESH_SECS) note(st.error ?? ['连接已断开']);
    goScreen(Screen.Online);
  }
  wasInGame = inGame();
}

/** 倒计时、提示淡出：多人游戏的界面每半秒重绘一次 */
function redrawTick(time: number) {
  const half = Math.floor(time * 2);
  if (half !== lastHalf && (screen.value === Screen.Online || inGame())) {
    lastHalf = half;
    changed();
  }
}

/** 页面在后台时 requestAnimationFrame 会停下：心跳、重连另用这个间隔（毫秒）的定时器驱动 */
const TICK_MS = 250;
setInterval(() => update(now()), TICK_MS);

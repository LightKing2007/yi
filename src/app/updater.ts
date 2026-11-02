/** 游戏内更新入口：启动即检查、校验主进程状态，安装只允许在开始菜单或空闲大厅操作。 */
import { signal } from '@preact/signals';
import type { UpdateAction, UpdateState } from '../../electron/update';
import { logError, native } from './native';
import { screen, Screen } from './state';
import { Phase, st } from '../online/state';
import { isRecord, member } from '../shared/check';

const phaseOf = member<UpdateState['phase']>({ idle: true, checking: true, available: true, downloading: true, ready: true, installing: true, error: true });
const VERSION_MAX_CHARS = 32;
const PERCENT_MAX = 100;

/** 与联机握手独立的更新状态，离线时单机仍可启动。 */
export const updateState = signal<UpdateState | null>(null);

/** IPC 只接受已知状态和有界字段，不将异常消息显示给玩家（COD-053）。 */
export function parseUpdateState(raw: unknown): UpdateState | null {
  if (!isRecord(raw)) return null;
  const { phase, version, percent, automatic, failed } = raw;
  if (!phaseOf(phase)) return null;
  if (typeof version !== 'string' || version.length > VERSION_MAX_CHARS || (version !== '' && !/^\d+\.\d+\.\d+$/.test(version))) return null;
  if (typeof percent !== 'number' || !(percent >= 0 && percent <= PERCENT_MAX)) return null;
  if (typeof automatic !== 'boolean') return null;
  if (failed !== undefined && failed !== 'check' && failed !== 'download' && failed !== 'install') return null;
  return { phase, version, percent, automatic, failed };
}

function receive(raw: unknown): void {
  const state = parseUpdateState(raw);
  if (state) updateState.value = state;
}

/** 安装会退出游戏；只有菜单和未匹配、未开房的大厅提供安装操作。 */
export function canInstallUpdate(): boolean {
  return !st.busy && (screen.value === Screen.Menu || screen.value === Screen.Online) && st.phase <= Phase.Lobby;
}

/** 点击原有更新提示下载，或下载完成后重启安装。 */
export async function updateAction(action: UpdateAction): Promise<void> {
  if (action === 'install' && !canInstallUpdate()) return;
  try {
    receive(await native()?.update(action));
  } catch (err) {
    logError('更新', err);
    updateState.value = {
      phase: 'error',
      version: updateState.value?.version ?? '',
      percent: 0,
      automatic: updateState.value?.automatic ?? false,
      failed: action === 'status' ? 'check' : action,
    };
  }
}

/** 订阅后立即检查，不登录、不创建对战 WebSocket。返回的函数供页面卸载时释放监听。 */
export function bootUpdater(): () => void {
  const bridge = native();
  if (!bridge?.update || !bridge.onUpdate) return () => {};
  const stop = bridge.onUpdate(receive);
  // check 不会覆盖已经下载完成的更新，窗口重载后仍可继续安装。
  void updateAction('check'); // 内部捕获异常，检查在后台进行，不等待网络才显示菜单
  return stop;
}

/** 复用开始菜单与大厅的更新提示：下载进度、失败重试和明确的重启安装入口。 */
import { updateAction, updateState, canInstallUpdate } from '../app/updater';
import { netTick, st } from '../online/state';
import { T, TF } from '../i18n';
import { Fit } from './widgets';

const DOWNLOAD_PAGE = 'https://yi.lightking.com.cn/download/';

/** 返回要显示的提示及玩家点击后的操作，检查与下载期间不提供重复操作。 */
function presentation() {
  const state = updateState.value;
  if (!state || state.phase === 'idle') {
    const old = st.update;
    return old ? { text: TF('有新版本 %s，点这里下载', old.version), action: 'check' as const } : null;
  }
  switch (state.phase) {
    case 'checking':
      return { text: T('正在检查更新'), action: null };
    case 'available':
      return { text: TF('有新版本 %s，点这里下载', state.version), action: state.automatic ? ('download' as const) : ('website' as const) };
    case 'downloading':
      return { text: TF('正在下载更新：%d%%', state.percent), action: null };
    case 'ready':
      return {
        text: canInstallUpdate() ? T('更新已下载，点这里重启并安装') : T('更新已下载，请返回开始菜单安装'),
        action: canInstallUpdate() ? ('install' as const) : null,
      };
    case 'installing':
      return { text: T('正在安装更新'), action: null };
    case 'error':
      return { text: T('更新失败，点这里重试'), action: state.failed ?? ('check' as const) };
  }
}

/** macOS 与浏览器保留官网下载；桌面原生更新器不接受服务器下发的任意下载地址。 */
export function UpdateNote({ style }: { style?: Record<string, string> }) {
  netTick.value;
  const shown = presentation();
  if (!shown) return null;
  const go = () => {
    if (!shown.action) return;
    if (shown.action === 'website' || !updateState.value) window.open(DOWNLOAD_PAGE);
    else void updateAction(shown.action); // 更新模块捕获错误并提供重试，不留下未处理的 Promise
  };
  return (
    <button type="button" class={'update-note' + (shown.action ? ' link' : '')} style={style} disabled={!shown.action} onClick={go}>
      <Fit size={13} lines={2}>
        {shown.text}
      </Fit>
    </button>
  );
}

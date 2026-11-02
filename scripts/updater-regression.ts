/** 游戏内更新的真实组件验证：三语、进度、键盘可达入口、安装限制（I18N-021、TST-013）。 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { Lang, settings, setSettings } from '../src/app/settings';
import { screen, Screen } from '../src/app/state';
import { updateState } from '../src/app/updater';
import { native } from '../src/app/native';
import { Phase, st } from '../src/online/state';
import { UpdateNote } from '../src/ui/updateNote';
import type { UpdateAction, UpdateState } from '../electron/update';

const WIDTH_PX = 300;
const ROUNDING_PX = 1;
const READY: UpdateState = { phase: 'ready', version: '4.1.0', percent: 100, automatic: true };

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`更新组件回归：${message}`);
}

async function probe(root: HTMLElement, state: UpdateState, disabled: boolean) {
  await act(() => {
    updateState.value = { ...state };
    render(h(UpdateNote, { style: undefined }), root);
  });
  const button = root.querySelector('button');
  assert(button, '有更新状态时必须显示提示');
  assert(button.disabled === disabled, `${state.phase} 的操作状态错误，页面 ${screen.value}，联机 ${st.phase}，期望禁用 ${disabled}，实际 ${button.disabled}`);
  const fit = button.querySelector<HTMLElement>('.fit');
  assert(fit && fit.textContent, '必须显示有内容的译文');
  assert(fit.scrollHeight <= fit.clientHeight + ROUNDING_PX, `译文超出两行：${fit.textContent}`);
  return button;
}

/** 由 text-fit 驱动，在真实 Chromium DOM 中检查更新入口及点击后发送的有限操作。 */
export async function runUpdateRegressions() {
  const previous = { native: native(), lang: settings.value.lang, screen: screen.value, phase: st.phase, update: updateState.value };
  const calls: UpdateAction[] = [];
  const root = document.createElement('div');
  root.style.cssText = `position:absolute;left:0;top:0;width:${WIDTH_PX}px`;
  document.body.append(root);
  Object.assign(window, {
    yiNative: {
      ...previous.native,
      update: async (action: UpdateAction) => {
        calls.push(action);
        return READY;
      },
    },
  });
  try {
    await document.fonts.ready;
    screen.value = Screen.Menu;
    st.phase = Phase.Off;
    for (const lang of [Lang.WY, Lang.ZH, Lang.EN]) {
      setSettings({ lang });
      for (const phase of ['checking', 'available', 'downloading', 'ready', 'installing', 'error'] as const) {
        await probe(root, { ...READY, phase, failed: phase === 'error' ? 'download' : undefined }, ['checking', 'downloading', 'installing'].includes(phase));
      }
    }
    const download = await probe(root, { ...READY, phase: 'available' }, false);
    await act(() => download.click());
    assert(calls[0] === 'download', '点击新版提示必须请求下载');
    st.phase = Phase.Playing;
    await probe(root, READY, true);
    st.phase = Phase.Off;
    const install = await probe(root, READY, false);
    install.focus();
    assert(document.activeElement === install, '安装按钮必须可由键盘聚焦');
    await act(() => install.click());
    assert(calls.join(',') === 'download,install', '空闲时才允许明确请求安装');
  } finally {
    await act(() => render(null, root));
    root.remove();
    Object.assign(window, { yiNative: previous.native });
    setSettings({ lang: previous.lang });
    screen.value = previous.screen;
    st.phase = previous.phase;
    updateState.value = previous.update;
  }
}

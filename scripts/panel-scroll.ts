/** 小窗口面板的真实组件回归（TST-013）：固定面板高度，验证底部操作可滚动到达，不依赖机器速度。由 text-fit 执行。 */
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { T } from '../src/i18n';
import { OnlinePanel } from '../src/ui/online';
import { SettingsPanel } from '../src/ui/panels';

const SMALL_HEIGHT_PX = 330;
const LARGE_HEIGHT_PX = 760;
const ROUNDING_PX = 1;

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`面板滚动回归：${message}`);
}

/** 小窗口里，设置页和好友页的末尾按钮应能完整滚入面板。 */
export async function runPanelScroll() {
  const root = document.createElement('div');
  root.className = 'panel';
  root.style.cssText = `left:0;top:0;height:${SMALL_HEIGHT_PX}px;opacity:0;pointer-events:none`;
  document.body.append(root);
  try {
    for (const component of [SettingsPanel, OnlinePanel]) {
      await act(() => render(h(component, { h: SMALL_HEIGHT_PX }), root));
      if (component === OnlinePanel) {
        const friend = [...root.querySelectorAll<HTMLElement>('.seg .opt')].find(el => el.textContent?.trim() === T('好友'));
        assert(friend, '须有好友选项');
        await act(() => friend.click());
      }
      const buttons = root.querySelectorAll('button');
      const last = buttons[buttons.length - 1];
      assert(last, '须有底部操作');
      assert(root.scrollHeight > root.clientHeight, '小窗口案例须确实包含超出面板的内容');
      last.focus();
      assert(root.scrollTop > 0, '聚焦超出面板的底部按钮须自动滚动');
      assert(last.getBoundingClientRect().bottom <= root.getBoundingClientRect().bottom + ROUNDING_PX, '底部按钮须完整进入面板');
      await act(() => render(null, root));
      root.scrollTop = 0;
    }
    root.style.height = `${LARGE_HEIGHT_PX}px`;
    await act(() => render(h(SettingsPanel, { h: LARGE_HEIGHT_PX }), root));
    assert(root.scrollHeight === root.clientHeight, '空间充足时不应出现滚动');
  } finally {
    await act(() => render(null, root));
    root.remove();
  }
}

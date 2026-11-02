/** 按钮动效回归：图标与按钮整体移动，不用反向位移抵消悬停或磁性跟随。 */
import { describe, expect, it } from 'vitest';
import { downloadStyle } from '../server/downloadStyle';
import { siteStyle } from '../server/pageStyle';

describe('官网按钮整体动效', () => {
  it('主按钮和棋子下载按钮的图标不做反向补偿位移', () => {
    const styles = siteStyle('test') + downloadStyle();
    expect(styles).toMatch(/\.btn:hover\s*\{\s*transform:\s*translateY\(-2px\)/);
    expect(styles).toMatch(/\.stone-btn:hover \.stone\s*\{\s*transform:\s*translateY\(-6px\) scale\(1\.04\)/);
    expect(styles).not.toMatch(/\.btn:hover \.ico\s*\{[^}]*\btransform\s*:/);
    expect(styles).not.toMatch(/\.stone-btn:hover \.ico\s*\{/);
  });
});

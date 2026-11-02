/** AppImage 安装顺序与文件系统失败恢复：任何替换前错误都不损坏旧程序（EDGE-002、TST-030）。 */
import { expect, it } from 'vitest';
import { replaceAppImage, type ImageFiles } from '../electron/appImageInstall';

it('跨磁盘下载先复制到原程序目录，设权限并落盘后才原子替换，失败始终保留原程序', () => {
  for (const failure of ['', 'copy', 'executable', 'flush', 'rename']) {
    const contents = new Map([
      ['/app/Yi.AppImage', 'old'],
      ['/cache/update.AppImage', 'verified-new'],
    ]);
    const order: string[] = [];
    const step = (name: string) => {
      order.push(name);
      if (failure === name) throw new Error(name);
    };
    const files: ImageFiles = {
      copy: (from, to) => {
        step('copy');
        contents.set(to, contents.get(from) ?? '');
      },
      executable: () => step('executable'),
      flush: () => step('flush'),
      rename: (from, to) => {
        step('rename');
        contents.set(to, contents.get(from) ?? '');
        contents.delete(from);
      },
      remove: file => {
        step('remove');
        contents.delete(file);
      },
    };
    const install = () => replaceAppImage(files, { downloaded: '/cache/update.AppImage', temporary: '/app/.temp', current: '/app/Yi.AppImage' });
    if (failure) expect(install).toThrow(failure);
    else install();
    expect(contents.get('/app/Yi.AppImage')).toBe(failure ? 'old' : 'verified-new');
    expect(contents.has('/app/.temp')).toBe(false);
    expect(contents.get('/cache/update.AppImage')).toBe('verified-new');
    if (!failure) expect(order).toEqual(['copy', 'executable', 'flush', 'rename', 'remove']);
  }
});

/** 官网安装程序与网站代码独立更新；固定清单和真实校验阻止损坏文件影响现行下载。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { installWebsiteDownloads, websitePackages } from '../scripts/website-downloads';

it('只安装并公布指定已发布版本的四个程序，校验失败时保留原下载目录', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-web-downloads-'));
  const files = ['Yi-3.1.0-win-x64-setup.exe', 'Yi-3.1.0-mac-arm64.dmg', 'Yi-3.1.0-mac-x64.dmg', 'Yi-3.1.0-linux-x86_64.AppImage'];
  const sums = files.map(file => `${createHash('sha256').update(file).digest('hex')}  ${file}`).join('\n');
  const options = { root, version: '3.1.0', sums, fetch: (file: string, target: string) => fs.writeFileSync(target, file) };
  try {
    expect(websitePackages('3.1.0')).toEqual(files);
    expect(() => websitePackages('../invalid')).toThrow();
    installWebsiteDownloads(options);
    installWebsiteDownloads(options);
    const current = path.join(root, 'downloads/current');
    expect(fs.readlinkSync(current)).toBe('releases/3.1.0');
    expect(fs.readdirSync(current).sort()).toEqual(['SHA256SUMS', ...files].sort());
    expect(() =>
      installWebsiteDownloads({
        ...options,
        version: '3.2.0',
        sums: sums.replaceAll('3.1.0', '3.2.0'),
        fetch: (_file, target) => fs.writeFileSync(target, 'corrupt'),
      }),
    ).toThrow('校验不符');
    expect(fs.readlinkSync(current)).toBe('releases/3.1.0');
    expect(() => installWebsiteDownloads({ ...options, sums: '' })).toThrow('项数');
    expect(fs.readdirSync(path.join(root, 'downloads')).filter(name => name.startsWith('.incoming-'))).toEqual([]);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});

/** 官网安装程序目录独立维护；只安装已发布游戏版本的四个固定文件，核对 SHA-256 后原子切换。 */
import fs from 'node:fs';
import path from 'node:path';
import { switchWebsiteLink, verifyWebsiteFiles } from './website-deploy';

const DIRECTORY_MODE = 0o755;
const FILE_MODE = 0o644;

/** 一个游戏版本的四个平台安装程序名称。 */
export function websitePackages(version: string): string[] {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('游戏版本格式无效');
  return [`Yi-${version}-win-x64-setup.exe`, `Yi-${version}-mac-arm64.dmg`, `Yi-${version}-mac-x64.dmg`, `Yi-${version}-linux-x86_64.AppImage`];
}

/** 安装程序复制或下载的系统边界；不得执行这些文件。 */
export interface DownloadInstallation {
  root: string;
  version: string;
  sums: string;
  fetch: (file: string, target: string) => void;
}

/** 校验失败时保留原下载目录，网站代码版本与安装程序版本互不绑定。 */
export function installWebsiteDownloads(opt: DownloadInstallation): void {
  const files = websitePackages(opt.version);
  const root = path.join(opt.root, 'downloads');
  fs.mkdirSync(path.join(root, 'releases'), { recursive: true });
  const stage = fs.mkdtempSync(path.join(root, '.incoming-'));
  try {
    const sums = opt.sums.split('\n').filter(line => files.includes(line.trim().split(/\s+/)[1] ?? ''));
    fs.writeFileSync(path.join(stage, 'SHA256SUMS'), sums.join('\n') + '\n');
    for (const file of files) opt.fetch(file, path.join(stage, file));
    verifyWebsiteFiles(stage, files);
    const relative = path.join('releases', opt.version);
    const target = path.join(root, relative);
    if (fs.existsSync(target)) {
      verifyWebsiteFiles(target, files);
      if (fs.readFileSync(path.join(target, 'SHA256SUMS'), 'utf8') !== fs.readFileSync(path.join(stage, 'SHA256SUMS'), 'utf8'))
        throw new Error('同一游戏版本的安装程序不可替换');
    } else {
      for (const file of [...files, 'SHA256SUMS']) fs.chmodSync(path.join(stage, file), FILE_MODE);
      fs.chmodSync(stage, DIRECTORY_MODE);
      fs.renameSync(stage, target);
    }
    fs.chmodSync(root, DIRECTORY_MODE);
    fs.chmodSync(path.join(root, 'releases'), DIRECTORY_MODE);
    switchWebsiteLink(root, 'current', relative);
    // 服务器只保留当前安装包；历史版本由 GitHub Release 保存。只清理由本流程建立的版本目录。
    for (const entry of fs.readdirSync(path.join(root, 'releases'), { withFileTypes: true })) {
      if (entry.name !== opt.version && /^\d+\.\d+\.\d+$/.test(entry.name) && entry.isDirectory())
        fs.rmSync(path.join(root, 'releases', entry.name), { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/** Linux 更新安装适配：沿用官方更新器的下载校验和退出流程，改为同目录原子替换。 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppImageUpdater } from 'electron-updater';
import type { InstallOptions } from 'electron-updater/out/BaseUpdater';
import { replaceAppImage, type ImageFiles } from './appImageInstall';

const EXECUTABLE_MODE = 0o755;
const FILES: ImageFiles = {
  copy: (from, to) => fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL),
  executable: file => fs.chmodSync(file, EXECUTABLE_MODE),
  flush: file => {
    const descriptor = fs.openSync(file, 'r');
    try {
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
  },
  rename: (from, to) => fs.renameSync(from, to),
  remove: file => fs.rmSync(file, { force: true }),
};

/** 不使用上游先 unlink 旧程序再 mv 的安装顺序，保持原文件名与现有快捷方式。 */
export class AtomicAppImageUpdater extends AppImageUpdater {
  protected override doInstall(options: InstallOptions): boolean {
    const current = process.env.APPIMAGE;
    const downloaded = this.installerPath;
    if (!current || !path.isAbsolute(current) || current.includes('\0') || !downloaded) throw new Error('AppImage 更新路径无效');
    const temporary = path.join(path.dirname(current), `.yi-update-${randomUUID()}.AppImage`);
    replaceAppImage(FILES, { downloaded, temporary, current });
    if (options.isForceRunAfter) {
      void this.spawnLog(current, [], { ...process.env, APPIMAGE_SILENT_INSTALL: 'true' }).catch(err => this.dispatchError(err));
      // 安装后重新打开新文件；启动异常由更新器统一报告，不执行 shell 命令。
    }
    return true;
  }
}

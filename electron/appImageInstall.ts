/** AppImage 同目录暂存并原子替换，防止跨磁盘复制或磁盘写满时先丢失原程序（EDGE-002）。 */

/** 只替换已由更新器完成 SHA-512 校验的程序；文件系统操作作为测试边界注入。 */
export interface ImageFiles {
  copy(source: string, target: string): void;
  executable(file: string): void;
  flush(file: string): void;
  rename(source: string, target: string): void;
  remove(file: string): void;
}

/** 所有可能失败的复制、权限与落盘操作均在替换当前路径之前完成。 */
export function replaceAppImage(files: ImageFiles, paths: { downloaded: string; temporary: string; current: string }): void {
  try {
    files.copy(paths.downloaded, paths.temporary);
    files.executable(paths.temporary);
    files.flush(paths.temporary);
    files.rename(paths.temporary, paths.current);
  } finally {
    files.remove(paths.temporary); // 仅清理自己生成的暂存文件，绝不删除 current
  }
}

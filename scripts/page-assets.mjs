/**
 * 下载页面用到的资源（API-060 的 /assets/ 名单）：构建时读成 base64，经 define 嵌入服务端（build-node.mjs）与测试（vite.config.ts），
 * 服务端运行时不读取磁盘。新增资源时同时在 server/files.ts 的 ASSET_TYPES 中登记内容类型。
 */
import fs from 'node:fs';

/** 发布路径中的文件名 → 仓库中的源文件 */
const SOURCES = {
  'title-yi.png': 'src/ui/assets/title-yi.png',
  'icon.png': 'public/icon.png',
  'yi-serif-900.woff2': 'src/ui/assets/fonts/yi-serif-900.woff2',
};

/** 读取全部资源；root 为仓库根目录的 URL */
export function pageAssets(root) {
  return Object.fromEntries(Object.entries(SOURCES).map(([name, file]) => [name, fs.readFileSync(new URL(file, root)).toString('base64')]));
}

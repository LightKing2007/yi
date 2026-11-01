/** 下载与安装类帮助文章，保持目录中的显示顺序。 */
import mobileTablet from '../support/mobile-tablet.md?raw';
import chooseVersion from '../support/choose-version.md?raw';
import downloadNotStarting from '../support/download-not-starting.md?raw';
import windowsSmartscreen from '../support/windows-smartscreen.md?raw';
import macosNotOpen from '../support/macos-not-open.md?raw';
import linuxAppimage from '../support/linux-appimage.md?raw';
import verifyDownload from '../support/verify-download.md?raw';

/** 下载与安装类 Markdown 源文件及问题地址。 */
export const SOURCES: readonly (readonly [string, string])[] = [
  ['mobile-tablet', mobileTablet],
  ['choose-version', chooseVersion],
  ['download-not-starting', downloadNotStarting],
  ['windows-smartscreen', windowsSmartscreen],
  ['macos-not-open', macosNotOpen],
  ['linux-appimage', linuxAppimage],
  ['verify-download', verifyDownload],
];

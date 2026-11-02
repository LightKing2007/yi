/** 装配可信官网更新源：Windows 使用 NSIS，Linux 使用 AppImage；macOS 在取得正式签名前仅检查版本。 */
import { app, net } from 'electron';
import { NsisUpdater } from 'electron-updater';
import { AtomicAppImageUpdater } from './appImageUpdater';
import { latestMacVersion, UpdateController, type UpdateState } from './update';

const WEBSITE = 'https://yi.lightking.com.cn/';
const CHECK_TIMEOUT_MS = 15_000;
const SUMS_MAX_BYTES = 32_768;

/** 有界读取官网清单，网络或响应异常不会阻断单机启动。 */
async function macVersion(): Promise<string | null> {
  const response = await net.fetch(`${WEBSITE}SHA256SUMS`, {
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    redirect: 'error',
    cache: 'no-store',
    credentials: 'omit',
  });
  if (!response.ok || !response.body) throw new Error(`更新检查 HTTP ${response.status}`);
  const reader = response.body.getReader();
  let text = '',
    bytes = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > SUMS_MAX_BYTES) throw new Error(`更新清单超过 ${SUMS_MAX_BYTES} 字节`);
      text += decoder.decode(chunk.value, { stream: true });
    }
    return latestMacVersion(text + decoder.decode(), app.getVersion(), process.arch);
  } finally {
    await reader.cancel();
  }
}

/** 只在打包后的程序中启用真实下载，开发版不会误更新开发目录。 */
export function createUpdater(notify: (state: UpdateState) => void, warn: (err: unknown) => void): UpdateController {
  const automatic = app.isPackaged && (process.platform === 'win32' || (process.platform === 'linux' && !!process.env.APPIMAGE));
  if (!automatic) {
    return new UpdateController({ check: app.isPackaged ? macVersion : async () => null, download: async () => {}, install: () => {} }, notify, warn, false);
  }
  const options = { provider: 'generic', url: WEBSITE, useMultipleRangeRequest: false } as const;
  const updater = process.platform === 'win32' ? new NsisUpdater(options) : new AtomicAppImageUpdater(options);
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.disableDifferentialDownload = true; // 官网先提供完整程序，无须额外部署 blockmap
  updater.allowDowngrade = false;
  updater.logger = { info: () => {}, debug: () => {}, warn, error: warn };
  let progress: (percent: number) => void = () => {};
  const controller = new UpdateController(
    {
      check: async () => {
        const result = await updater.checkForUpdates();
        return result?.isUpdateAvailable ? result.updateInfo.version : null;
      },
      download: async callback => {
        progress = callback;
        await updater.downloadUpdate(); // electron-updater 按发布元数据核对 SHA-512，失败不允许安装
      },
      install: () => updater.quitAndInstall(true, true),
    },
    notify,
    warn,
    true,
  );
  updater.on('download-progress', info => progress(info.percent));
  updater.on('error', err => {
    // 检查和下载的异常由调用的 Promise 统一处理；安装阶段的错误仅通过事件报告。
    if (controller.snapshot().phase === 'installing') controller.fail('install', err);
  });
  return controller;
}

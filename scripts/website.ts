/** 官网独立入口：只有页面和安装包下载；版本由网站构建提交确定，与游戏版本无关。 */
import { loadWebsiteConfig } from '../server/websiteConfig';
import { startWebsite } from '../server/websiteHost';

const EXIT_CONFIG = 78;
const MS_PER_SEC = 1000;
const config = loadWebsiteConfig();
if (config.version) {
  process.stdout.write(`yi-web ${__APP_COMMIT__}\n`);
  process.exit(0);
}
if (config.errors.length) {
  process.stderr.write(config.errors.join('\n') + '\n');
  process.exit(EXIT_CONFIG);
}
void startWebsite({ port: config.port, files: config.files, pages: config.pages, commit: __APP_COMMIT__, now: () => performance.now() / MS_PER_SEC })
  .then(site => {
    process.stdout.write(`yi-web ${__APP_COMMIT__} 127.0.0.1:${site.port}\n`);
    const stop = () => void site.close().then(() => process.exit(0));
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
  })
  .catch((err: unknown) => {
    process.stderr.write(`官网启动失败：${String(err)}\n`);
    process.exit(1);
  });

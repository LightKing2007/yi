/**
 * 弈 · 联机服务端：node server.cjs [端口]（默认 8443）；node server.cjs --version 只打出版本号与提交号。
 * 环境变量：
 *   PORT          端口
 *   EXTRA_PORTS   另外同时监听的端口，逗号分隔（换端口的过渡期让老版本客户端照常连上，例如 7700）
 *   HOST          监听地址（默认所有网卡，放在反向代理后面时设为 127.0.0.1）
 *   YI_DATA       段位存档（默认当前目录下的 yi-ratings.json）
 *   YI_LATEST     最新的客户端版本号（例如 2.0.1），客户端版本较旧时提示更新
 *   YI_DOWNLOAD   新版本的下载地址
 *   YI_FILES      安装包所在的目录：设了就在同一个端口上提供下载页（http://地址:端口/）
 */
import path from 'node:path';
import { PROTO_PORT, PROTO_VERSION } from '../src/shared/protocol';
import { startHost } from './host';
import { FileStore, StoreLoadError, type StoreLog } from './store';

const BUILD = `${__APP_VERSION__}（${__APP_COMMIT__}）`;
if (process.argv.includes('--version')) {
  console.log(BUILD);
  process.exit(0);
}

const port = Number(process.argv[2] ?? process.env.PORT ?? PROTO_PORT);
const extra = (process.env.EXTRA_PORTS ?? '')
  .split(',')
  .map(s => Number(s.trim()))
  .filter(n => n > 0 && n !== port);
const host = process.env.HOST || undefined;
const latest = process.env.YI_LATEST || undefined;
const download = process.env.YI_DOWNLOAD || undefined;
const files = process.env.YI_FILES ? path.resolve(process.env.YI_FILES) : undefined;

const log = (text: string) => {
  const d = new Date(),
    p = (n: number) => String(n).padStart(2, '0');
  console.log(`[${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}] ${text}`);
};

const storeLog: StoreLog = (level, text) => log(level === 'info' ? text : `[${level}] ${text}`);

const dataFile = path.resolve(process.env.YI_DATA ?? 'yi-ratings.json');
let store: FileStore;
try {
  store = new FileStore(dataFile, { log: storeLog });
} catch (e) {
  if (!(e instanceof StoreLoadError)) throw e;
  // 存档损坏时宁可不启动，也不以空数据覆盖原文件（DAT-050）
  storeLog('error', e.message);
  process.exit(e.exitCode);
}

startHost([port, ...extra], { log, store, host, latest, download, files })
  .then(h => {
    log(
      `弈 联机服务端 ${BUILD} 已启动，${host ? `地址 ${host}，` : ''}端口 ${h.ports.join('、')}（协议版本 ${PROTO_VERSION}），段位存档 ${dataFile}` +
        (latest ? `，最新客户端 ${latest}` : '') +
        (files ? `，安装包目录 ${files}` : ''),
    );
    const stop = () => {
      log('正在关闭…');
      store.close();
      h.close().then(() => process.exit(0));
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  })
  .catch((e: Error) => {
    console.error(`无法在端口 ${[port, ...extra].join('、')} 启动：${e.message}`);
    process.exit(1);
  });

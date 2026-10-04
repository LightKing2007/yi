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
 *   YI_LOG_LEVEL  日志级别：error、warn、info（默认）、debug（OPS-062）
 *
 * 日志按 07-operations.md 第 5 节输出 JSON Lines 到标准输出（server/log.ts）。
 */
import path from 'node:path';
import { PROTO_PORT, PROTO_VERSION } from '../src/shared/protocol';
import { startHost } from './host';
import { processLogger } from './log';
import { FileStore, StoreLoadError } from './store';

/** 退出码：配置不合法（sysexits.h 的 EX_CONFIG） */
const EXIT_CONFIG = 78;
/** 输出日志汇总行（OPS-063）的间隔 */
const LOG_FLUSH_MS = 1000;

if (process.argv.includes('--version')) {
  process.stdout.write(`${__APP_VERSION__}（${__APP_COMMIT__}）\n`);
  process.exit(0);
}

const logger = processLogger(process.env, {
  ver: `${__APP_VERSION__}+${__APP_COMMIT__}`,
  write: line => process.stdout.write(line + '\n'),
  now: Date.now,
});
if (!logger) process.exit(EXIT_CONFIG);
const { log } = logger;

const port = Number(process.argv[2] ?? process.env.PORT ?? PROTO_PORT);
const extra = (process.env.EXTRA_PORTS ?? '')
  .split(',')
  .map(item => Number(item.trim()))
  .filter(n => n > 0 && n !== port);
const host = process.env.HOST || undefined;
const latest = process.env.YI_LATEST || undefined;
const download = process.env.YI_DOWNLOAD || undefined;
const files = process.env.YI_FILES ? path.resolve(process.env.YI_FILES) : undefined;

const dataFile = path.resolve(process.env.YI_DATA ?? 'yi-ratings.json');
let store: FileStore;
try {
  store = new FileStore(dataFile, { log });
} catch (err) {
  if (!(err instanceof StoreLoadError)) throw err;
  // 存档损坏时宁可不启动，也不以空数据覆盖原文件（DAT-050）
  log('error', 'store.load-failed', { msg: err.message, file: dataFile, err });
  process.exit(err.exitCode);
}

const flusher = setInterval(() => logger.flush(), LOG_FLUSH_MS);
flusher.unref();

startHost([port, ...extra], { log, store, host, latest, download, files })
  .then(started => {
    const msg = `弈 联机服务端已启动${host ? `，地址 ${host}` : ''}${latest ? `，最新客户端 ${latest}` : ''}${files ? `，安装包目录 ${files}` : ''}`;
    log('info', 'server.start', { msg, ports: started.ports, protoRange: [PROTO_VERSION, PROTO_VERSION], dataFile });
    const stop = (signal: NodeJS.Signals) => {
      log('info', 'server.stop', { msg: '正在关闭', reason: signal });
      store.close();
      void started.close().then(() => {
        logger.flush(true);
        process.exit(0);
      }); // 关闭不会失败：各端口的 close 回调总会被调用
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
  })
  .catch((err: Error) => {
    log('error', 'server.listen-failed', { msg: `无法在端口 ${[port, ...extra].join('、')} 启动`, ports: [port, ...extra], err });
    process.exit(1);
  });

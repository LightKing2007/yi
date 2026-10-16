/**
 * 弈 · 联机服务端：node server.cjs [端口]（默认 8443）；node server.cjs --version 只打出版本号与提交号。
 * 环境变量（由 server/config.ts 解析并校验，不合法时写 server.config-invalid 并以退出码 78 退出，ARC-042）：
 *   PORT          端口
 *   EXTRA_PORTS   另外同时监听的端口，逗号分隔（换端口的过渡期让老版本客户端照常连上，例如 7700）
 *   HOST          监听地址（默认所有网卡，放在反向代理后面时设为 127.0.0.1）
 *   YI_DATA       旧段位存档（默认当前目录下的 yi-ratings.json），首个数据库版本同时写入（决定 D5-1）
 *   YI_DB         数据库（默认当前目录下的 yi.db）
 *   YI_LATEST     最新的客户端版本号（例如 2.0.1），客户端版本较旧时提示更新
 *   YI_DOWNLOAD   新版本的下载地址
 *   YI_FILES      安装包所在的目录：设了就在同一个端口上提供下载页（http://地址:端口/）
 *   YI_LOG_LEVEL  日志级别：error、warn、info（默认）、debug（OPS-062）
 *
 * 日志按 07-operations.md 第 5 节输出 JSON Lines 到标准输出（server/log.ts）。
 * 信号：SIGTERM、SIGINT 以 1001 断开全部连接、落盘后退出（OPS-052）；SIGUSR2 进入维护模式（OPS-045），只能以重启结束。
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { PROTO_VERSION } from '../src/shared/protocol';
import { EXIT_CONFIG, loadConfig } from './config';
import { startHost } from './host';
import { processLogger } from './log';
import { Metrics, countingLog } from './metrics';
import { startPersistence } from './db/startup';

/** 输出日志汇总行（OPS-063）的间隔 */
const LOG_FLUSH_MS = 1000;
/** 指标快照 metrics.snapshot 的间隔（OPS-071） */
const SNAPSHOT_MS = 60_000;
/** 事件循环延迟的采样精度（毫秒） */
const LAG_RESOLUTION_MS = 20;
/** 纳秒换算为秒 */
const NS_PER_SEC = 1e9;
/** 毫秒换算为秒 */
const MS_PER_SEC = 1000;
/** 事件循环延迟取 p99 */
const LAG_PERCENTILE = 99;

const { config, errors } = loadConfig();
if (config.version) {
  process.stdout.write(`${__APP_VERSION__}（${__APP_COMMIT__}）\n`);
  process.exit(0);
}

const logger = processLogger(config, {
  ver: `${__APP_VERSION__}+${__APP_COMMIT__}`,
  write: line => process.stdout.write(line + '\n'),
  now: Date.now,
});
const { log } = logger;
for (const { variable, expected } of errors) log('error', 'server.config-invalid', { msg: `${variable} 不合法，拒绝启动`, variable, expected });
if (errors.length) {
  logger.flush(true);
  process.exit(EXIT_CONFIG);
}

const { port, extraPorts: extra, host, latest, download, files, dataFile } = config;

const build = { version: __APP_VERSION__, commit: __APP_COMMIT__ };
const metrics = new Metrics(build);
// 事件循环延迟：每次写快照后重新统计，/metrics 与快照中为上一次快照以来的 p99。
// monitorEventLoopDelay 记录的是相邻两次采样的间隔，含采样周期本身，减去采样周期才是延迟
const lag = monitorEventLoopDelay({ resolution: LAG_RESOLUTION_MS });
lag.enable();
const eventLoopLag = () => (lag.count ? Math.max(0, lag.percentile(LAG_PERCENTILE) / NS_PER_SEC - LAG_RESOLUTION_MS / MS_PER_SEC) : 0);

const persistence = startPersistence({ dbFile: config.dbFile, dataFile, appVersion: __APP_VERSION__, now: Date.now, log: countingLog(log, metrics) });
if (typeof persistence === 'number') process.exit(persistence); // 失败的原因已写入日志
const { store } = persistence;

const flusher = setInterval(() => logger.flush(), LOG_FLUSH_MS);
flusher.unref();

startHost([port, ...extra], { log, store, host, latest, download, files, build, metrics, eventLoopLag })
  .then(started => {
    const msg = `弈 联机服务端已启动${host ? `，地址 ${host}` : ''}${latest ? `，最新客户端 ${latest}` : ''}${files ? `，安装包目录 ${files}` : ''}`;
    const snapshots = setInterval(() => {
      log('info', 'metrics.snapshot', { msg: '指标快照', ...metrics.snapshot(started.gauges()) });
      lag.reset();
    }, SNAPSHOT_MS);
    snapshots.unref();
    log('info', 'server.start', { msg, ports: started.ports, protoRange: [PROTO_VERSION, PROTO_VERSION], dataFile });
    const stop = (signal: NodeJS.Signals) => {
      log('info', 'server.stop', { msg: '正在关闭', reason: signal });
      persistence.close();
      void started.close().then(() => {
        logger.flush(true);
        process.exit(0);
      }); // 关闭不会失败：各端口的 close 回调总会被调用
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    process.on('SIGUSR2', () => started.server.maintain());
  })
  .catch((err: Error) => {
    log('error', 'server.listen-failed', { msg: `无法在端口 ${[port, ...extra].join('、')} 启动`, ports: [port, ...extra], err });
    process.exit(1);
  });

/**
 * 弈 · 联机服务端：node server.cjs [端口]（默认 8443）；node server.cjs --version 只打出版本号与提交号；
 * node server.cjs backup 备份数据库后退出（server/backupCommand.ts）。
 * 环境变量（由 server/config.ts 解析并校验，不合法时写 server.config-invalid 并以退出码 78 退出，ARC-042）：
 *   PORT          端口
 *   HOST          监听地址（默认所有网卡，放在反向代理后面时设为 127.0.0.1）
 *   YI_DB         数据库（默认当前目录下的 yi.db）
 *   YI_BACKUP_DIR 备份目录（默认数据库所在目录下的 backup/）
 *   YI_LATEST     最新的客户端版本号（例如 2.0.1），客户端版本较旧时提示更新
 *   YI_DOWNLOAD   新版本的下载地址
 *   YI_FILES      旧配置兼容字段，联机入口已不使用；官网由独立进程提供
 *   YI_LOG_LEVEL  日志级别：error、warn、info（默认）、debug（OPS-062）
 *
 * 日志按 07-operations.md 第 5 节输出 JSON Lines 到标准输出（server/log.ts）。
 * 信号：SIGTERM、SIGINT 以 1001 断开全部连接、落盘后退出（OPS-052）；SIGUSR2 进入维护模式（OPS-045），只能以重启结束。
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { runBackup } from './backupCommand';
import { EXIT_CONFIG, loadConfig } from './config';
import { processLogger } from './log';
import { LAG_RESOLUTION_MS, lagSeconds } from './metrics';
import { serve } from './serve';

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
for (const { variable, expected } of errors) logger.log('error', 'server.config-invalid', { msg: `${variable} 不合法，拒绝启动`, variable, expected });
if (errors.length) {
  logger.flush(true);
  process.exit(EXIT_CONFIG);
}
if (config.command === 'backup') {
  const code = runBackup({ config, log: logger.log, now: Date.now });
  logger.flush(true);
  process.exit(code);
}

// 事件循环延迟：每次写指标快照后重新统计，/metrics 与快照中为上一次快照以来的 p99（server/metrics.ts 的 lagSeconds）
const lag = monitorEventLoopDelay({ resolution: LAG_RESOLUTION_MS });
lag.enable();

void serve({
  config,
  logger,
  build: { version: __APP_VERSION__, commit: __APP_COMMIT__ },
  now: Date.now,
  exit: code => process.exit(code),
  onSignal: (signal, handler) => process.on(signal, handler),
  every: (ms, fn) => {
    const timer = setInterval(fn, ms);
    timer.unref();
    return () => clearInterval(timer);
  },
  eventLoopLag: () => lagSeconds(lag),
  afterSnapshot: () => lag.reset(),
});

/**
 * 联机服务端的运行：打开数据库、监听端口、定时输出日志汇总与指标快照、按信号关闭或进入维护模式。
 * 进程级的依赖（退出、信号、定时器、事件循环延迟）都由入口 server/main.ts 注入，测试中以假实现替换。
 */
import type { ServerConfig } from './config';
import { startEntry } from './config';
import { startPersistence } from './db/startup';
import type { Build } from './health';
import { startHost, type Host } from './host';
import type { Logger } from './log';
import { Metrics } from './metrics';
import type { Persistence } from './db/startup';

/** 输出日志汇总行（OPS-063）的间隔 */
export const LOG_FLUSH_MS = 1000;
/** 指标快照 metrics.snapshot 的间隔（OPS-071） */
export const SNAPSHOT_MS = 60_000;
/** 退出码：端口无法监听 */
const EXIT_LISTEN = 1;

/** 运行服务端所需的进程级依赖 */
export interface ServeDeps {
  /** 已通过校验的配置 */
  config: ServerConfig;
  /** 日志（07-operations.md 第 5 节） */
  logger: Logger;
  /** 版本号与提交号，用于健康检查、指标与迁移前备份的文件名 */
  build: Build;
  /** 当前时刻（Unix 毫秒） */
  now: () => number;
  /** 退出进程 */
  exit: (code: number) => void;
  /** 注册信号的处理函数 */
  onSignal: (signal: NodeJS.Signals, handler: () => void) => void;
  /** 每隔 ms 毫秒执行一次 fn，返回停止的函数；不能阻止进程退出 */
  every: (ms: number, fn: () => void) => () => void;
  /** 事件循环延迟 p99（秒） */
  eventLoopLag?: () => number;
  /** 每写一次指标快照后调用（重新统计事件循环延迟） */
  afterSnapshot?: () => void;
}

/** 运行服务端：失败时写日志并以对应的退出码退出；成功时一直运行，直到收到 SIGINT 或 SIGTERM */
export async function serve(deps: ServeDeps): Promise<void> {
  const { config, logger, build } = deps;
  const { log } = logger;
  const metrics = new Metrics(build);
  const persistence = startPersistence({
    dbFile: config.dbFile,
    appVersion: build.version,
    now: deps.now,
    log,
    repo: { onTransaction: seconds => metrics.observe('yi_db_transaction_seconds', seconds) },
  });
  if (typeof persistence === 'number') {
    deps.exit(persistence); // 失败的原因已写入日志
    return;
  }
  const stopFlush = deps.every(LOG_FLUSH_MS, () => logger.flush());
  const started = await listen(deps, persistence, metrics);
  if (!started) {
    persistence.close();
    stopFlush();
    deps.exit(EXIT_LISTEN);
    return;
  }
  const stopSnapshots = deps.every(SNAPSHOT_MS, () => {
    log('info', 'metrics.snapshot', { msg: '指标快照', ...metrics.snapshot(started.gauges()) });
    deps.afterSnapshot?.();
  });
  log('info', 'server.start', startEntry(config, started.ports));
  const stop = (signal: NodeJS.Signals) => {
    log('info', 'server.stop', { msg: '正在关闭', reason: signal });
    stopSnapshots();
    persistence.close();
    void started.close().then(() => {
      stopFlush();
      logger.flush(true);
      deps.exit(0);
    }); // 关闭不会失败：各端口的 close 回调总会被调用
  };
  deps.onSignal('SIGINT', () => stop('SIGINT'));
  deps.onSignal('SIGTERM', () => stop('SIGTERM'));
  deps.onSignal('SIGUSR2', () => started.server.maintain());
}

/** 监听端口；失败时写 server.listen-failed 日志并返回 undefined */
async function listen(deps: ServeDeps, persistence: Persistence, metrics: Metrics): Promise<Host | undefined> {
  const { config } = deps;
  const { host, latest, download } = config;
  const ports = [config.port];
  try {
    return await startHost(ports, {
      log: deps.logger.log,
      store: persistence.store,
      host,
      latest,
      download,
      build: deps.build,
      metrics,
      eventLoopLag: deps.eventLoopLag,
      dbFileBytes: persistence.fileBytes,
    });
  } catch (err) {
    deps.logger.log('error', 'server.listen-failed', { msg: `无法在端口 ${ports.join('、')} 启动`, ports, err });
    return undefined;
  }
}

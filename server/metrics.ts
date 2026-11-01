/**
 * 服务端的监控指标（OPS-071、OPS-072，07-operations.md 第 9 节）：计数器与直方图在事件发生时累计，
 * 仪表（连接数、房间数等）在读取时由调用方给出。以 Prometheus 文本格式输出到 /metrics（仅本机，API-061），
 * 并每 60 秒以 metrics.snapshot 事件写入日志。
 */
import { PROTO_VERSION } from '../src/shared/protocol';

/** 直方图的分桶（秒，07-operations.md 第 9 节）：单条消息处理耗时与数据库事务耗时共用 */
const BUCKET_SECONDS = { '1ms': 0.001, '5ms': 0.005, '10ms': 0.01, '50ms': 0.05, '100ms': 0.1 };
/** 分桶的上界（秒），从小到大 */
export const HANDLE_BUCKETS: readonly number[] = Object.values(BUCKET_SECONDS);

/** 读取时由调用方给出的仪表 */
export interface Gauges {
  connections: number;
  playersOnline: number;
  rooms: { kind: string; state: string; count: number }[];
  queue: { mode: string; type: string; count: number }[];
  downloadsActive: number;
  eventLoopLagSeconds: number;
  residentMemoryBytes: number;
  /** 数据库文件与其 WAL 文件的字节数合计 */
  dbFileBytes: number;
  /** 正在统计加入房间失败次数的 IP 数（API-044） */
  joinFailIps: number;
}

type Labels = Record<string, string>;
/** 直方图的名称与说明（07-operations.md 第 9 节） */
const HISTOGRAMS = {
  yi_message_handle_seconds: '单条消息处理耗时',
  yi_db_transaction_seconds: '数据库事务耗时（含提交或回滚）',
} as const;
/** 直方图的名称 */
export type HistogramName = keyof typeof HISTOGRAMS;

/** 一个直方图：各桶的计数（不累计）、超出最大桶的次数、总和与次数 */
class Histogram {
  private buckets: number[] = HANDLE_BUCKETS.map(() => 0);
  private over = 0;
  private sum = 0;
  private count = 0;

  observe(seconds: number) {
    const i = HANDLE_BUCKETS.findIndex(le => seconds <= le);
    if (i < 0) this.over++;
    else this.buckets[i] = (this.buckets[i] ?? 0) + 1;
    this.sum += seconds;
    this.count++;
  }

  /** 样本：各桶的累计次数，以及 _sum、_count */
  samples(name: string): [string, number][] {
    const out: [string, number][] = [];
    let cumulative = 0;
    HANDLE_BUCKETS.forEach((le, i) => {
      cumulative += this.buckets[i] ?? 0;
      out.push([`${name}_bucket{le="${le}"}`, cumulative]);
    });
    out.push([`${name}_bucket{le="+Inf"}`, cumulative + this.over], [`${name}_sum`, this.sum], [`${name}_count`, this.count]);
    return out;
  }
}
/** 计数器的名称、说明与标签名（07-operations.md 第 9 节） */
const COUNTERS = {
  yi_games_finished_total: { help: '已结束的对局数', labels: ['kind', 'reason'] },
  yi_messages_total: { help: '入站消息数', labels: ['type'] },
  yi_errors_total: { help: '下发的错误码数', labels: ['code'] },
  yi_rate_limited_total: { help: '触发限流的次数', labels: [] },
  yi_db_write_failures_total: { help: '对局记录写入数据库失败的次数', labels: [] },
} as const;
/** 计数器的名称 */
export type CounterName = keyof typeof COUNTERS;

/** Prometheus 文本格式的标签：值中的反斜杠、双引号与换行转义 */
function labelText(labels: Labels) {
  const parts = Object.entries(labels).map(([name, value]) => `${name}="${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
}

/** 一个服务端进程的全部指标：计数器与直方图在此累计，仪表在输出时由调用方给出 */
export class Metrics {
  /** 计数器：名称 → 标签文本 → 值 */
  private counters = new Map<CounterName, Map<string, number>>();
  /** 直方图：名称 → 直方图 */
  private histograms = new Map<HistogramName, Histogram>((Object.keys(HISTOGRAMS) as HistogramName[]).map(name => [name, new Histogram()]));

  constructor(private readonly build: { version: string; commit: string }) {}

  /** 计数器加 n；labels 须与该计数器的标签名一致 */
  inc(name: CounterName, labels: Labels = {}, n = 1) {
    const series = this.counters.get(name) ?? new Map<string, number>();
    const key = labelText(labels);
    series.set(key, (series.get(key) ?? 0) + n);
    this.counters.set(name, series);
  }

  /** 在直方图 name 中记下一次耗时（秒） */
  observe(name: HistogramName, seconds: number) {
    this.histograms.get(name)?.observe(seconds);
  }

  /** 全部指标的样本：[名称加标签, 值]，按第 9 节的次序 */
  samples(g: Gauges): [string, number][] {
    const out: [string, number][] = [
      [`yi_build_info${labelText({ version: this.build.version, commit: this.build.commit, proto: String(PROTO_VERSION) })}`, 1],
      ['yi_connections', g.connections],
      ['yi_players_online', g.playersOnline],
      ...g.rooms.map(({ kind, state, count }): [string, number] => [`yi_rooms_active${labelText({ kind, state })}`, count]),
      ...g.queue.map(({ mode, type, count }): [string, number] => [`yi_queue_waiting${labelText({ mode, type })}`, count]),
    ];
    for (const name of Object.keys(COUNTERS) as CounterName[]) {
      const series = this.counters.get(name);
      if (!series || series.size === 0) out.push([name, 0]);
      else for (const [key, value] of series) out.push([name + key, value]);
    }
    for (const [name, histogram] of this.histograms) out.push(...histogram.samples(name));
    out.push(
      ['yi_event_loop_lag_seconds', g.eventLoopLagSeconds],
      ['yi_downloads_active', g.downloadsActive],
      ['process_resident_memory_bytes', g.residentMemoryBytes],
      ['yi_db_file_bytes', g.dbFileBytes],
      ['yi_join_fail_ips', g.joinFailIps],
    );
    return out;
  }

  /** Prometheus 文本格式（text/plain; version=0.0.4） */
  render(g: Gauges) {
    const help: Record<string, [string, string]> = {
      yi_build_info: ['gauge', '构建信息，恒为 1'],
      yi_connections: ['gauge', '当前 WebSocket 连接数'],
      yi_players_online: ['gauge', '已握手的在线玩家数'],
      yi_rooms_active: ['gauge', '房间数'],
      yi_queue_waiting: ['gauge', '匹配队列中的人数'],
      ...Object.fromEntries(Object.entries(COUNTERS).map(([name, counter]) => [name, ['counter', counter.help] as [string, string]])),
      ...Object.fromEntries(Object.entries(HISTOGRAMS).map(([name, text]) => [name, ['histogram', text] as [string, string]])),
      yi_event_loop_lag_seconds: ['gauge', '事件循环延迟 p99'],
      yi_downloads_active: ['gauge', '进行中的下载数'],
      process_resident_memory_bytes: ['gauge', '常驻内存'],
      yi_db_file_bytes: ['gauge', '数据库文件与其 WAL 文件的字节数'],
      yi_join_fail_ips: ['gauge', '正在统计加入房间失败次数的 IP 数'],
    };
    const lines: string[] = [];
    let last = '';
    for (const [sample, value] of this.samples(g)) {
      const name = sample.replace(/\{.*$/, '');
      const family = Object.keys(HISTOGRAMS).find(histogram => name.startsWith(`${histogram}_`)) ?? name; // 直方图的 _bucket、_sum、_count 同属一族
      if (family !== last) {
        const [type, text] = help[family] ?? ['untyped', family];
        lines.push(`# HELP ${family} ${text}`, `# TYPE ${family} ${type}`);
        last = family;
      }
      lines.push(`${sample} ${value}`);
    }
    return lines.join('\n') + '\n';
  }

  /** metrics.snapshot 事件的附加字段：各样本的名称（含标签）与值 */
  snapshot(g: Gauges) {
    return Object.fromEntries(this.samples(g));
  }
}

/** 事件循环延迟的采样精度（毫秒），即 monitorEventLoopDelay 的 resolution */
export const LAG_RESOLUTION_MS = 20;
/** 纳秒换算为秒 */
const NS_PER_SEC = 1e9;
/** 毫秒换算为秒 */
const MS_PER_SEC = 1000;
/** 事件循环延迟取 p99 */
const LAG_PERCENTILE = 99;

/**
 * 事件循环延迟 p99（秒）：monitorEventLoopDelay 记录的是相邻两次采样的间隔，含采样周期本身，减去采样周期才是延迟；
 * 还没有样本时为 0，不为负
 */
export function lagSeconds(histogram: { count: number; percentile(p: number): number }): number {
  if (!histogram.count) return 0;
  return Math.max(0, histogram.percentile(LAG_PERCENTILE) / NS_PER_SEC - LAG_RESOLUTION_MS / MS_PER_SEC);
}

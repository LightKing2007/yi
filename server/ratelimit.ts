/**
 * 限流（API-041 至 API-045）：令牌桶、滑动时间窗计数，以及由它们组成的每条连接的限额与按 IP 的新建连接频率。
 * 都不读真实时钟，时刻（秒）由调用方传入，测试时以假时钟驱动（TST-020）。
 */

/** 每条连接入站消息的令牌桶每秒补充的令牌数，即持续速率上限（API-043） */
export const MSG_RATE_PER_SEC = 20;
/** 每条连接入站消息的令牌桶容量，即允许连续发送的条数（API-043） */
export const MSG_BURST = 40;
/** 超出限额时，多少秒内只回复一次“操作过于频繁”（API-043） */
export const LIMITED_NOTICE_SECS = 1;
/** 违规（限流 E3、协议错误 E4）累计的时间窗（API-045） */
export const VIOLATION_WINDOW_SECS = 60;
/** 时间窗内累计违规达到这个次数即断开（API-045） */
export const VIOLATION_MAX = 10;
/** 因累计违规被断开后，同一匿名身份多久内不能再连上（API-045） */
export const BAN_SECS = 5 * 60;
/** 改名频率的时间窗（API-044） */
export const NAME_WINDOW_SECS = 10;
/** 时间窗内至多改名几次（API-044） */
export const NAME_CHANGES_MAX = 1;
/** 进入、退出匹配队列频率的时间窗（API-044） */
export const QUEUE_WINDOW_SECS = 10;
/** 时间窗内至多进入、退出匹配队列合计几次（API-044） */
export const QUEUE_OPS_MAX = 10;
/** 同一 IP 在时间窗内至多新建几条连接（API-041） */
export const NEW_CONN_MAX = 30;
/** 按 IP 统计新建连接的时间窗（API-041） */
export const NEW_CONN_WINDOW_SECS = 60;
/** 同一 IP 新建连接过频后，多久内拒绝它的新连接（API-041） */
export const NEW_CONN_BLOCK_SECS = 60;

/** 令牌桶：每秒补充 rate 个令牌，最多存 burst 个；每条消息取一个，取不到即超出限速 */
export class TokenBucket {
  private tokens: number;
  private at: number;

  /** rate：每秒补充的令牌数；burst：桶的容量；now：创建时刻（秒），桶在此刻是满的 */
  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.at = now;
  }

  /** 取一个令牌；桶空时返回 false（不扣成负数，超出的请求不拖长恢复时间） */
  take(now: number): boolean {
    this.tokens = Math.min(this.burst, this.tokens + Math.max(0, now - this.at) * this.rate);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens--;
    return true;
  }
}

/** 滑动时间窗计数：最近 windowSecs 秒内记了几次。只保留窗内的时刻，占用随 max 有界 */
export class WindowCounter {
  private times: number[] = [];

  /** windowSecs：时间窗长度（秒）；max：上限，窗内次数达到它即 full */
  constructor(
    private readonly windowSecs: number,
    private readonly max: number,
  ) {}

  /** 记一次，返回记过之后窗内的次数 */
  hit(now: number): number {
    this.prune(now);
    this.times.push(now);
    if (this.times.length > this.max) this.times.shift(); // 超过上限的部分不必记：full 已经成立
    return this.times.length;
  }

  /** 窗内的次数 */
  count(now: number): number {
    this.prune(now);
    return this.times.length;
  }

  /** 窗内的次数已达到上限 */
  full(now: number): boolean {
    return this.count(now) >= this.max;
  }

  private prune(now: number) {
    while (this.times.length && now - this.times[0] >= this.windowSecs) this.times.shift();
  }
}

/** IpGate 的参数 */
export interface IpGateOptions {
  /** 每个 IP 在 windowSecs 秒内最多新建几条连接 */
  max: number;
  windowSecs: number;
  /** 超出后拒绝该 IP 的新连接多少秒 */
  blockSecs: number;
}

/** 按 IP 的新建连接频率（API-041）：超出时拒绝，并在 blockSecs 秒内继续拒绝该 IP */
export class IpGate {
  private recent = new Map<string, WindowCounter>();
  private blocked = new Map<string, number>();

  constructor(private readonly opt: IpGateOptions) {}

  /** 记一次新连接；返回 false 表示应拒绝这条连接。被拒绝期间的尝试不计数，不会延长拒绝时间 */
  admit(ip: string, now: number): boolean {
    const until = this.blocked.get(ip);
    if (until !== undefined) {
      if (now < until) return false;
      this.blocked.delete(ip);
    }
    let c = this.recent.get(ip);
    if (!c) this.recent.set(ip, (c = new WindowCounter(this.opt.windowSecs, this.opt.max + 1)));
    if (c.hit(now) <= this.opt.max) return true;
    this.recent.delete(ip);
    this.blocked.set(ip, now + this.opt.blockSecs);
    return false;
  }

  /** 清掉已过期的记录（定时调用），免得来过一次的 IP 一直占着内存 */
  prune(now: number) {
    for (const [ip, until] of this.blocked) if (now >= until) this.blocked.delete(ip);
    for (const [ip, c] of this.recent) if (!c.count(now)) this.recent.delete(ip);
  }

  /** 正在追踪的 IP 数（测试与监控用） */
  get size() {
    return this.recent.size + this.blocked.size;
  }
}

/** 受频率限制的操作：改名、进入或退出匹配队列（API-044） */
export type LimitedOp = 'name' | 'queue';

/** 一条连接的各项限额（API-043 至 API-045）：消息令牌桶、按操作的频率、违规累计 */
export class ConnLimits {
  private bucket: TokenBucket;
  private violationWindow = new WindowCounter(VIOLATION_WINDOW_SECS, VIOLATION_MAX);
  private ops: Record<LimitedOp, WindowCounter> = {
    name: new WindowCounter(NAME_WINDOW_SECS, NAME_CHANGES_MAX),
    queue: new WindowCounter(QUEUE_WINDOW_SECS, QUEUE_OPS_MAX),
  };
  private noticedAt = -Infinity;

  /** now：连接建立的时刻（秒） */
  constructor(now: number) {
    this.bucket = new TokenBucket(MSG_RATE_PER_SEC, MSG_BURST, now);
  }

  /** 收到一条消息时调用；返回 false 表示超出限速，这条消息应丢弃 */
  message(now: number): boolean {
    return this.bucket.take(now);
  }

  /** 执行一次受限操作前调用；返回 false 表示超出频率，这次操作应拒绝 */
  allow(op: LimitedOp, now: number): boolean {
    const c = this.ops[op];
    if (c.full(now)) return false;
    c.hit(now);
    return true;
  }

  /** 记一次违规；返回 true 表示累计已达上限，连接应断开 */
  violate(now: number): boolean {
    return this.violationWindow.hit(now) >= VIOLATION_MAX;
  }

  /** 时间窗内累计的违规次数（用于日志） */
  violations(now: number): number {
    return this.violationWindow.count(now);
  }

  /** 这次超限是否应回复提示：1 秒内只回复一次，免得回复本身成了洪泛 */
  notice(now: number): boolean {
    if (now - this.noticedAt < LIMITED_NOTICE_SECS) return false;
    this.noticedAt = now;
    return true;
  }
}

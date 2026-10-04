/** 段位存档：一个 JSON 文件；存档损坏时拒绝启动，写盘失败时保留内存中的数据并退避重试（实现 DAT-050 至 DAT-054） */
import fs from 'node:fs';
import path from 'node:path';
import type { Rating, Ratings } from '../src/shared/protocol';
import type { Log } from './log';
import type { RatingStore } from './rooms';

/** 每秒的毫秒数 */
const MS_PER_SEC = 1000;
/** 段位变化后延迟多久写盘，把同一时段的多次变化合并为一次写入 */
const FLUSH_DELAY_MS = 2000;
/** 写盘失败后第一次重试的间隔；之后每次加倍（DAT-052） */
const RETRY_BASE_MS = 1000;
/** 重试间隔的上限（DAT-052） */
const RETRY_MAX_MS = 60_000;
/** 连续失败达到此次数时写 error 日志（DAT-052） */
const FAILS_BEFORE_ERROR = 3;
/** 退出码：存档存在但无法解析（sysexits.h 的 EX_DATAERR，DAT-050） */
export const EXIT_DATA_ERROR = 65;
/** 退出码：存档存在但无法读取（sysexits.h 的 EX_IOERR） */
export const EXIT_IO_ERROR = 74;

/** 存档中一名玩家的记录 */
interface Entry {
  name: string;
  ratings: Ratings;
}

/** 存档读写用到的文件系统函数；测试中以假实现替换，模拟磁盘写满等故障 */
export type StoreFs = Pick<
  typeof fs,
  'readFileSync' | 'writeFileSync' | 'openSync' | 'writeSync' | 'fsyncSync' | 'closeSync' | 'renameSync' | 'copyFileSync' | 'unlinkSync'
>;

/** 存档的可选依赖 */
export interface StoreOptions {
  /** 日志输出（事件码 `store.*`，07-operations.md 第 8 节），默认不输出 */
  log?: Log;
  /** 文件系统，默认为 `node:fs` */
  fs?: StoreFs;
  /** 当前时刻（Unix 毫秒），用于应急转储的文件名，默认为 `Date.now` */
  now?: () => number;
}

/** 存档存在但无法读取或解析。调用方必须以 `exitCode` 退出，严禁以空数据继续运行（DAT-050） */
export class StoreLoadError extends Error {
  constructor(
    readonly file: string,
    readonly exitCode: number,
    reason: string,
  ) {
    super(`段位存档 ${file} ${reason}，已拒绝启动；原文件保持不动，请从 ${file}.prev 或备份恢复`);
    this.name = 'StoreLoadError';
  }
}

/** 段位分为非负安全整数 */
const isCount = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

function isRating(v: unknown): v is Rating {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return isCount(r.points) && isCount(r.win) && isCount(r.loss) && isCount(r.draw);
}

function isEntry(v: unknown): v is Entry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Record<string, unknown>;
  if (typeof e.name !== 'string' || typeof e.ratings !== 'object' || e.ratings === null) return false;
  const rs = e.ratings as Record<string, unknown>;
  return isRating(rs.gomoku) && isRating(rs.go);
}

const errCode = (e: unknown) => (e as NodeJS.ErrnoException | undefined)?.code;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 文件名可用的 UTC 时间，如 `20261002T014217Z` */
const stamp = (ms: number) =>
  new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d+Z$/, 'Z');

/** 段位存档：内存中保存全部记录，变化后延迟写盘 */
export class FileStore implements RatingStore {
  private data: Record<string, Entry> = {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private dirty = false;
  private fails = 0;
  private readonly fs: StoreFs;
  private readonly log: Log;
  private readonly now: () => number;

  /** 读取存档。文件不存在时视为首次运行；存在但无法读取或解析时抛出 `StoreLoadError` */
  constructor(
    private readonly file: string,
    opt: StoreOptions = {},
  ) {
    this.fs = opt.fs ?? fs;
    this.log = opt.log ?? (() => {});
    this.now = opt.now ?? Date.now;
    this.load();
  }

  get(key: string) {
    return this.data[key]?.ratings;
  }

  set(key: string, ratings: Ratings, name: string) {
    this.data[key] = { name, ratings: { gomoku: { ...ratings.gomoku }, go: { ...ratings.go } } };
    this.dirty = true;
    // 退避重试期间已有定时器，不提前写盘
    this.timer ??= setTimeout(() => this.flush(), FLUSH_DELAY_MS);
  }

  /** 立即写盘。成功（或没有需要写入的变化）时返回 true；失败时保留内存中的数据并安排重试，返回 false */
  flush(): boolean {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.dirty) return true;
    try {
      this.write();
    } catch (err) {
      this.onWriteFailed(err);
      return false;
    }
    this.dirty = false;
    if (this.fails > 0) this.log('info', 'store.write-recovered', { msg: `段位存档在失败 ${this.fails} 次后写入成功`, file: this.file, attempts: this.fails });
    this.fails = 0;
    return true;
  }

  /**
   * 进程退出前调用：最后一次写盘，并取消重试定时器以免阻止退出。
   * 写盘失败时把数据转储到存档目录下的 `emergency-时间.json`（DAT-053）。返回数据是否已落盘
   */
  close(): boolean {
    const ok = this.flush();
    clearTimeout(this.timer);
    this.timer = undefined;
    if (ok) return true;
    const dump = path.join(path.dirname(this.file), `emergency-${stamp(this.now())}.json`);
    try {
      this.fs.writeFileSync(dump, JSON.stringify(this.data));
      this.log('error', 'store.dumped', { msg: '退出前写盘失败，段位数据已转储', file: this.file, dump });
      return true;
    } catch (err) {
      this.log('error', 'store.dump-failed', { msg: '退出前写盘与转储都失败，本次运行后的段位变化已丢失', file: this.file, dump, err });
      return false;
    }
  }

  private load() {
    let raw: string;
    try {
      raw = this.fs.readFileSync(this.file, 'utf8');
    } catch (e) {
      if (errCode(e) === 'ENOENT') return; // 文件不存在：首次运行
      throw new StoreLoadError(this.file, EXIT_IO_ERROR, `无法读取（${errText(e)}）`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new StoreLoadError(this.file, EXIT_DATA_ERROR, `无法解析（${errText(e)}）`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new StoreLoadError(this.file, EXIT_DATA_ERROR, '顶层不是对象');
    }
    const bad: string[] = [];
    for (const [key, entry] of Object.entries(parsed)) {
      if (isEntry(entry)) this.data[key] = entry;
      else bad.push(key);
    }
    if (bad.length > 0) this.keepCorrupt(bad);
  }

  /** 个别记录损坏：这些玩家按新玩家处理，原文件另存为 `.corrupt`，不整体丢弃（10-edge-cases.md 第 4 节） */
  private keepCorrupt(keys: string[]) {
    const copy = this.file + '.corrupt';
    try {
      this.fs.copyFileSync(this.file, copy);
    } catch (err) {
      throw new StoreLoadError(this.file, EXIT_IO_ERROR, `有 ${keys.length} 条记录损坏，且无法另存为 ${copy}（${errText(err)}）`);
    }
    this.log('warn', 'store.records-invalid', { msg: `段位存档中有记录损坏，已按新玩家处理；首条：${keys[0]}`, file: this.file, count: keys.length, copy });
  }

  /** 写临时文件 → fsync → 上一版另存为 .prev → 原子改名 → fsync 目录（DAT-051、DAT-054） */
  private write() {
    const tmp = this.file + '.tmp';
    try {
      const fd = this.fs.openSync(tmp, 'w');
      try {
        this.fs.writeSync(fd, JSON.stringify(this.data));
        this.fs.fsyncSync(fd);
      } finally {
        this.fs.closeSync(fd);
      }
      this.keepPrevious();
      this.fs.renameSync(tmp, this.file);
    } catch (e) {
      try {
        this.fs.unlinkSync(tmp);
      } catch {
        /* 临时文件可能尚未创建；残留的临时文件不影响下一次写盘 */
      }
      throw e;
    }
    this.syncDir();
  }

  private keepPrevious() {
    try {
      this.fs.copyFileSync(this.file, this.file + '.prev');
    } catch (e) {
      if (errCode(e) !== 'ENOENT') throw e; // 首次写盘时还没有上一版
    }
  }

  /** 改名后 fsync 所在目录，确保断电后改名本身不丢失；Windows 不支持打开目录，跳过 */
  private syncDir() {
    if (process.platform === 'win32') return;
    const fd = this.fs.openSync(path.dirname(this.file), 'r');
    try {
      this.fs.fsyncSync(fd);
    } finally {
      this.fs.closeSync(fd);
    }
  }

  private onWriteFailed(err: unknown) {
    this.fails++;
    const wait = Math.min(RETRY_BASE_MS * 2 ** (this.fails - 1), RETRY_MAX_MS);
    const msg = `段位存档写入失败（第 ${this.fails} 次）：${errText(err)}；数据保留在内存中，${wait / MS_PER_SEC} 秒后重试`;
    const entry = { msg, file: this.file, attempts: this.fails, retryMs: wait };
    if (this.fails >= FAILS_BEFORE_ERROR) this.log('error', 'store.write-failed', { ...entry, err });
    else this.log('warn', 'store.write-failed', entry);
    this.timer = setTimeout(() => this.flush(), wait);
  }
}

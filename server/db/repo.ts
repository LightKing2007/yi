/** 数据访问：服务端读写数据库的 SQL 全部集中于此，每条语句预编译一次、以参数绑定（DAT-044、DAT-045） */
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { newRating, type Rating, type Ratings } from '../../src/shared/protocol';

/** 昵称的字节上限（DAT-022：16 个字素 × 4 字节） */
const NAME_BYTES = 64;
/** 昵称为空时使用的名字，与服务端握手时的默认昵称相同 */
const NAME_FALLBACK = '棋手';
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const encoder = new TextEncoder();

/** 棋类在数据库中的取值，与段位记录的键相同（roadmap.md 第 5.2.2 条） */
export type GameType = keyof Ratings;
/** 全部棋类 */
export const GAME_TYPES: readonly GameType[] = ['gomoku', 'go'];

/** 段位变化的原因（`rating_changes.cause`） */
export type ChangeCause = 'game' | 'import' | 'rollback' | 'admin';

/** 按字素截短到 64 字节以内（决定 D5-5），不拆开任何一个字素；为空时取默认昵称 */
export function clipNameBytes(name: string): string {
  let out = '',
    size = 0;
  for (const { segment } of graphemes.segment(name)) {
    size += encoder.encode(segment).length;
    if (size > NAME_BYTES) break;
    out += segment;
  }
  return out || NAME_FALLBACK;
}

/** 数据库中一行段位转为协议中的段位 */
const toRating = (row: Record<string, unknown>): Rating => ({
  points: Number(row.points),
  win: Number(row.win_count),
  loss: Number(row.loss_count),
  draw: Number(row.draw_count),
});

/** 数据库中的一名玩家：设备散列、昵称与段位 */
export interface StoredPlayer {
  uidHash: string;
  name: string;
  ratings: Ratings;
}

/** 预编译的语句 */
function statements(db: DatabaseSync) {
  return {
    userOf: db.prepare('SELECT user_id FROM devices WHERE uid_hash = ? ORDER BY id LIMIT 1'),
    insertUser: db.prepare("INSERT INTO users (kind, name, created_at, last_seen_at) VALUES ('guest', ?, ?, ?)"),
    insertDevice: db.prepare('INSERT INTO devices (uid_hash, user_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)'),
    seeUser: db.prepare('UPDATE users SET name = ?, last_seen_at = ? WHERE id = ?'),
    seeDevice: db.prepare('UPDATE devices SET last_seen_at = ? WHERE uid_hash = ? AND user_id = ?'),
    ratingsOf: db.prepare('SELECT game_type, points, win_count, loss_count, draw_count FROM ratings WHERE user_id = ?'),
    saveRating: db.prepare(
      'INSERT INTO ratings (user_id, game_type, points, win_count, loss_count, draw_count, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
        'ON CONFLICT (user_id, game_type) DO UPDATE SET points = excluded.points, win_count = excluded.win_count, ' +
        'loss_count = excluded.loss_count, draw_count = excluded.draw_count, updated_at = excluded.updated_at',
    ),
    recordChange: db.prepare(
      'INSERT INTO rating_changes (game_id, user_id, game_type, points_before, points_after, cause, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ),
    players: db.prepare(
      'SELECT d.uid_hash, u.id AS user_id, u.name FROM devices d JOIN users u ON u.id = d.user_id ' +
        'WHERE u.kind = ? AND EXISTS (SELECT 1 FROM ratings r WHERE r.user_id = u.id)',
    ),
    metaText: db.prepare('SELECT meta_text FROM meta WHERE meta_name = ?'),
    setMeta: db.prepare('INSERT INTO meta (meta_name, meta_text) VALUES (?, ?) ON CONFLICT (meta_name) DO UPDATE SET meta_text = excluded.meta_text'),
  } satisfies Record<string, StatementSync>;
}

/** 服务端的数据访问；方法都是同步的，多条写入由调用方以 `transaction` 包成一个事务（DAT-040） */
export class Repo {
  private readonly sql: ReturnType<typeof statements>;

  constructor(private readonly db: DatabaseSync) {
    this.sql = statements(db);
  }

  /** 在一个事务内执行；抛出异常时回滚并原样抛出。不支持嵌套 */
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** 这台设备对应的用户编号；还没有时为 undefined */
  userOf(uidHash: string): number | undefined {
    const row = this.sql.userOf.get(uidHash);
    return row === undefined ? undefined : Number(row.user_id);
  }

  /** 这台设备对应的用户；还没有时新建一个游客用户与设备行，返回用户编号 */
  ensure(uidHash: string, name: string, now: number): number {
    const found = this.userOf(uidHash);
    if (found !== undefined) return found;
    const userId = Number(this.sql.insertUser.run(clipNameBytes(name), now, now).lastInsertRowid);
    this.sql.insertDevice.run(uidHash, userId, now, now);
    return userId;
  }

  /** 玩家上线：找到或新建用户，记下最近使用的昵称与时刻，返回用户编号 */
  touch(uidHash: string, name: string, now: number): number {
    const userId = this.ensure(uidHash, name, now);
    this.sql.seeUser.run(clipNameBytes(name), now, userId);
    this.sql.seeDevice.run(now, uidHash, userId);
    return userId;
  }

  /** 用户的段位；没有记录的棋类为初始段位 */
  ratingsOf(userId: number): Ratings {
    const ratings: Ratings = { gomoku: newRating(), go: newRating() };
    for (const row of this.sql.ratingsOf.all(userId)) ratings[row.game_type as GameType] = toRating(row);
    return ratings;
  }

  /** 写入用户一种棋的段位 */
  saveRating(userId: number, type: GameType, rating: Rating, now: number) {
    this.sql.saveRating.run(userId, type, rating.points, rating.win, rating.loss, rating.draw, now);
  }

  /** 写一条段位变化明细；`gameId` 只在原因为 game 时给出 */
  recordChange(change: { userId: number; type: GameType; before: number; after: number; cause: ChangeCause; gameId?: number }, now: number) {
    this.sql.recordChange.run(change.gameId ?? null, change.userId, change.type, change.before, change.after, change.cause, now);
  }

  /** 有段位记录的全部游客：设备散列、昵称与段位 */
  guests(): StoredPlayer[] {
    return this.sql.players.all('guest').map(row => ({ uidHash: String(row.uid_hash), name: String(row.name), ratings: this.ratingsOf(Number(row.user_id)) }));
  }

  /** 元数据的值；没有时为 undefined */
  meta(name: string): string | undefined {
    const row = this.sql.metaText.get(name);
    return row === undefined ? undefined : String(row.meta_text);
  }

  /** 写入元数据 */
  setMeta(name: string, text: string) {
    this.sql.setMeta.run(name, text);
  }
}

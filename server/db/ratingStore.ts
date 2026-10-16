/** 数据库中的段位存放处：联机服务端经 RatingStore 接口读写；首个数据库版本同时写入旧存档（决定 D5-1） */
import type { Ratings } from '../../src/shared/protocol';
import type { RatingStore } from '../roomTypes';
import type { LegacyFile } from './legacy';
import { GAME_TYPES, type Repo } from './repo';

/** 数据库中的段位存放处的依赖 */
export interface DbRatingStoreOptions {
  /** 当前时刻（Unix 毫秒） */
  now: () => number;
  /** 同时写入的旧存档（yi-ratings.json）；不设时只写数据库 */
  legacy?: Pick<LegacyFile, 'set'>;
}

/** 以设备散列为键的段位存放处，数据在数据库中 */
export class DbRatingStore implements RatingStore {
  constructor(
    private readonly repo: Repo,
    private readonly opt: DbRatingStoreOptions,
  ) {}

  /** 这台设备的段位；还没有用户时为 undefined */
  get(key: string): Ratings | undefined {
    const userId = this.repo.userOf(key);
    return userId === undefined ? undefined : this.repo.ratingsOf(userId);
  }

  /** 玩家完成握手：找到或新建游客用户，记下昵称与时刻（roadmap.md 第 5.4 节） */
  seen(key: string, name: string) {
    this.repo.touch(key, name, this.opt.now());
  }

  /** 写入这台设备两种棋的段位，在一个事务内；随后写入旧存档 */
  set(key: string, ratings: Ratings, name: string) {
    const now = this.opt.now();
    this.repo.transaction(() => {
      const userId = this.repo.touch(key, name, now);
      for (const type of GAME_TYPES) this.repo.saveRating(userId, type, ratings[type], now);
    });
    this.opt.legacy?.set(key, ratings, name);
  }
}

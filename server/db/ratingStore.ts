/** 数据库中的段位与对局记录：联机服务端经 RatingStore 接口读写 */
import type { Ratings } from '../../src/shared/protocol';
import type { GameEnd, GameStart, RatedPair, RatingStore, Settle } from '../roomTypes';
import { GAME_TYPES, type Repo } from './repo';

/** 棋谱 JSON 的版本（DAT-024、VER-012：棋谱单独编号） */
export const RECORD_VERSION = 1;
/** 协议中的胜方（1 黑、2 白、3 和）在数据库中的取值 */
const WINNERS = { 1: 'black', 2: 'white', 3: 'draw' } as const;

/** 数据库中的段位存放处的依赖 */
export interface DbRatingStoreOptions {
  /** 当前时刻（Unix 毫秒） */
  now: () => number;
}

/** 以设备散列为键的段位存放处，段位与对局记录在数据库中 */
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

  /** 写入这台设备两种棋的段位，在一个事务内 */
  set(key: string, ratings: Ratings, name: string) {
    const now = this.opt.now();
    this.repo.transaction(() => {
      const userId = this.repo.touch(key, name, now);
      for (const type of GAME_TYPES) this.repo.saveRating(userId, type, ratings[type], now);
    });
  }

  /** 开局：写入对局记录（双方、种类、棋类、路数），返回对局编号 */
  startGame(start: GameStart): number {
    const now = this.opt.now();
    const id = this.repo.transaction(() =>
      this.repo.insertGame(
        {
          kind: start.kind,
          type: start.type,
          size: start.size,
          blackUserId: this.repo.ensure(start.black.key, start.black.name, now),
          whiteUserId: this.repo.ensure(start.white.key, start.white.name, now),
        },
        now,
      ),
    );
    return id;
  }

  /**
   * 终局：在一个事务内写入棋谱与结果；给出 settle 时重新读取双方段位（不用握手时的缓存，原问题 A8），
   * 结算并写入段位与两条变化明细（DAT-040）。已经终局的对局不再写入，返回 undefined
   */
  finishGame(id: number, end: GameEnd, settle?: Settle): RatedPair | undefined {
    const now = this.opt.now();
    const rated = this.repo.transaction(() => {
      const game = this.repo.gameOf(id);
      if (!game || game.ended) return undefined;
      const record = JSON.stringify({ v: RECORD_VERSION, ...end.record });
      const winner = WINNERS[end.winner as keyof typeof WINNERS] ?? 'draw';
      this.repo.endGame(id, { record, moveCount: end.record.moves.length, winner, reason: end.reason, rated: settle !== undefined }, now);
      if (!settle) return undefined;
      const black = this.repo.ratingsOf(game.blackUserId)[game.type],
        white = this.repo.ratingsOf(game.whiteUserId)[game.type];
      const result = settle(black, white);
      for (const [userId, side] of [
        [game.blackUserId, result.black],
        [game.whiteUserId, result.white],
      ] as const) {
        this.repo.saveRating(userId, game.type, side.rating, now);
        this.repo.recordChange({ userId, type: game.type, before: side.before, after: side.rating.points, cause: 'game', gameId: id }, now);
      }
      return result;
    });
    return rated;
  }

  /** 服务端放弃了这一局（异常隔离）：记为 aborted、和棋、不计段位 */
  abortGame(id: number) {
    this.repo.abortGames(this.opt.now(), id);
  }
}

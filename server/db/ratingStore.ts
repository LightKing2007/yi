/** 数据库中的段位与对局记录：联机服务端经 RatingStore 接口读写 */
import type { Ratings } from '../../src/shared/protocol';
import type { GameEnd, GameStart, RatedPair, RatingStore, Settle } from '../roomTypes';
import type { Repo } from './repo';

/** 棋谱 JSON 的版本（DAT-024、VER-012：棋谱单独编号） */
export const RECORD_VERSION = 1;
/** 协议中的胜方（1 黑、2 白、3 和）在数据库中的取值 */
const WINNERS = { 1: 'black', 2: 'white', 3: 'draw' } as const;

/** 数据库中的段位存放处的依赖 */
export interface DbRatingStoreOptions {
  /** 当前时刻（Unix 毫秒） */
  now: () => number;
}

/** 以账号的内部编号（users.id）为键的段位存放处，段位与对局记录在数据库中（protocol-v4.md 第 5 章） */
export class DbRatingStore implements RatingStore {
  constructor(
    private readonly repo: Repo,
    private readonly opt: DbRatingStoreOptions,
  ) {}

  /** 账号两种棋的段位；没有段位记录的棋种为起始段位 */
  get(userId: number): Ratings | undefined {
    return this.repo.ratingsOf(userId);
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
          blackUserId: start.black.userId,
          whiteUserId: start.white.userId,
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

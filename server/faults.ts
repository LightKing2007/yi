/**
 * 未预期的异常的隔离（整改项 P2-12 自 rooms.ts 拆出；API-023、EDGE-002）：记录调用栈与错误编号，
 * 只断开或清理出错的那一项——一位玩家、一个配对或一个房间——其余连接与对局照常。
 */
import { randomUUID } from 'node:crypto';
import { BLACK, WHITE } from '../src/core/types';
import { CLOSE_CODE } from '../src/shared/protocol';
import { drop, forget } from './hub';
import type { LogEntry } from './log';
import { freeRoom, seat } from './room';
import { recordAbort } from './record';
import { errorMsg } from './errorMsg';
import { type Match, type Player, type Room, type ServerContext } from './roomTypes';

/** 记录一次未预期的异常：完整调用栈与新的错误编号（UUID v4）写入 internal.error 日志；返回错误编号，供下发给客户端对照 */
export function report(ctx: ServerContext, err: unknown, entry: LogEntry): string {
  const errorId = randomUUID();
  ctx.log('error', 'internal.error', { ...entry, errorId, err });
  return errorId;
}

/** 执行一项定时检查；出现未预期的异常时按 fault 记录，再以 clean 清理出错的那一项 */
export function guard(ctx: ServerContext, work: () => void, fault: LogEntry, clean: (errorId: string) => void) {
  try {
    work();
  } catch (err) {
    clean(report(ctx, err, fault));
  }
}

/** 以服务端内部错误（E5）断开一位玩家：先下发提示与错误编号（不含异常的内容），再按断线处理并以 1011 关闭 */
export function kick(ctx: ServerContext, p: Player, errorId: string) {
  try {
    ctx.send(p, errorMsg('server.internal', { errorId }));
  } catch {
    // 发送本身抛出说明连接已经出错：异常已记录，不再告知，照常断开
  }
  drop(ctx, p, CLOSE_CODE.internal);
}

/** 放弃出错的配对：双方不再等待确认，以 1011 断开 */
export function scrapMatch(ctx: ServerContext, m: Match, errorId: string) {
  ctx.matches.delete(m); // 出错时可能尚未移除；断开时便不会再处理这个配对
  for (const side of m.side) kick(ctx, side.p, errorId);
}

/** 放弃出错的房间：先移除房间（对局不再继续，也不结算段位），再以 1011 断开座位上的玩家；他们重连时收到 resumeFailed */
export function scrapRoom(ctx: ServerContext, r: Room, errorId: string) {
  recordAbort(ctx, r); // 尚未写入终局的（含终局途中出错的）记为服务端放弃，已终局的不改写
  freeRoom(ctx, r);
  for (const color of [BLACK, WHITE]) {
    const p = seat(ctx, r, color);
    if (p) kick(ctx, p, errorId);
  }
}

/** 移除出错的玩家：放弃其所在的房间，以 1011 断开（已断开的直接移除）；不再保留席位，免得每次检查都再出错 */
export function evict(ctx: ServerContext, p: Player, errorId: string) {
  const r = ctx.rooms.get(p.room);
  if (r) scrapRoom(ctx, r, errorId);
  kick(ctx, p, errorId);
  forget(ctx, p);
}

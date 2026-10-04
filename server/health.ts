/**
 * 健康检查 GET /healthz（API-061）：只回应来自本机的请求，供上线脚本在重启前读取活跃对局数、重启后核对版本（OPS-045、OPS-046）。
 * 其他来源、其他方法与其他路径一律交给下一个处理者（下载页对白名单以外的路径返回 404）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PROTO_VERSION } from '../src/shared/protocol';
import type { Health } from './rooms';

/** 同一端口上的普通网页请求的处理者 */
export type Web = (req: IncomingMessage, res: ServerResponse) => void;

/** 服务端的版本号与提交号（OPS-046 据此核对重启后的版本） */
export interface Build {
  version: string;
  commit: string;
}

/** 健康检查的路径 */
export const HEALTH_PATH = '/healthz';
const HTTP_OK = 200;
/** 本机地址；双栈监听时 IPv4 的本机请求以 IPv4 映射地址出现 */
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** 请求的路径；无法解析时为空串 */
function pathOf(url: string | undefined) {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return '';
  }
}

/** 在 next 之前接上 /healthz；health 在每次请求时读取 */
export function withHealth(build: Build, health: () => Health, next: Web): Web {
  return (req, res) => {
    if (req.method !== 'GET' || !LOOPBACK.has(req.socket.remoteAddress ?? '') || pathOf(req.url) !== HEALTH_PATH) {
      next(req, res);
      return;
    }
    const body = JSON.stringify({ version: build.version, commit: build.commit, proto: PROTO_VERSION, ...health() });
    res.writeHead(HTTP_OK, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  };
}

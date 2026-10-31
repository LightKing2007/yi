/** HTTP 请求的超时与按来源限流；官网和联机传输层共用，不依赖对局或数据库。 */
import type http from 'node:http';
import type { Web } from './health';
import type { Log } from './log';
import { clientIp, fromThisHost } from './clientIp';
import { HttpGate } from './ratelimit';

/** 限流日志的最短间隔（秒）。 */
const HTTP_LIMITED_LOG_SECS = 60;

/** HTTP 服务器的超时与请求头上限（API-047），防止慢速请求占住连接 */
export const HTTP_LIMITS = {
  headersTimeout: 10_000,
  requestTimeout: 30_000,
  keepAliveTimeout: 5_000,
  maxHeadersCount: 50,
} as const;

/** 给 HTTP 服务器设上 HTTP_LIMITS（Node.js 的默认值过于宽松） */
export function hardenHttp(server: http.Server) {
  server.headersTimeout = HTTP_LIMITS.headersTimeout;
  server.requestTimeout = HTTP_LIMITS.requestTimeout;
  server.keepAliveTimeout = HTTP_LIMITS.keepAliveTimeout;
  server.maxHeadersCount = HTTP_LIMITS.maxHeadersCount;
}

/**
 * 在 next 之前按 IP 限制 HTTP 请求的频率（API-041）：超出时返回 429 与 Retry-After（04-api.md 第 4.1 条）。
 * 本机直接发出的请求（上线脚本读健康检查）不计。被限流时至多每 HTTP_LIMITED_LOG_SECS 秒写一行 warn 日志，
 * 只记次数，不记 IP（DAT-073）
 */
export function withHttpLimit(next: Web, gate: HttpGate, now: () => number, opt: { log?: Log; limited?: Limited } = {}): Web {
  const { log, limited = tooManyRequests } = opt;
  let count = 0,
    loggedAt = -Infinity;
  return (req, res) => {
    const wait = fromThisHost(req) ? 0 : gate.admit(clientIp(req), now());
    if (!wait) {
      next(req, res);
      return;
    }
    limited(res, wait, req);
    count++;
    if (now() - loggedAt < HTTP_LIMITED_LOG_SECS) return;
    log?.('warn', 'http.limited', { msg: 'HTTP 请求超出频率限制', count });
    loggedAt = now();
    count = 0;
  };
}

/** 超出频率限制时的回应；账号接口改用自己的错误格式（accountApi.ts 的 apiLimited） */
export type Limited = (res: import('node:http').ServerResponse, retryAfterSecs: number, req: import('node:http').IncomingMessage) => void;

/** HTTP 请求超出频率限制；官网和联机端口共用相同的状态码与等待提示。 */
export function tooManyRequests(res: import('node:http').ServerResponse, retryAfterSecs: number) {
  const status = 429;
  res
    .writeHead(status, { 'X-Content-Type-Options': 'nosniff', 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': String(retryAfterSecs) })
    .end('请求过于频繁，请稍后再试。');
}

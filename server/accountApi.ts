/**
 * 账号 HTTP 接口的入口（账号接口契约第 2 章）：只接管 `/api/` 路径，依次检查来源、路径与方法，再交给 accountRoutes.ts 的处理。
 * 业务抛出的 ApiProblem 转为错误响应；其他异常记 error 日志与 errorId，响应只带 errorId（API-023）。其余路径交给下一个处理者。
 */
import { createHmac } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiProblem, internalProblem, originOf, preflight, readEmpty, readJson, sendJson, sendProblem } from './apiHttp';
import { ROUTES, type Handler, type RouteDeps } from './accountRoutes';
import { clientIp } from './clientIp';
import type { Web } from './health';
import type { Limited } from './http';
import type { Log } from './log';

/** 由本入口接管的路径前缀 */
export const API_PREFIX = '/api/';
const HTTP_NOT_FOUND = 404;
const MS_PER_SEC = 1000;
const HTTP_TOO_LARGE = 413;
const PARAM_ROUTE = /^(\/api\/v1\/email-codes)\/([^/]+)$/;

/** 入口的选项：业务依赖，加上来源允许名单、来源标识的密钥与日志 */
export interface AccountApiOptions extends RouteDeps {
  /** 精确允许的 Origin（契约第 2.4.2 条），生产环境仅 app://yi */
  origins: readonly string[];
  /** 计算来源标识的 HMAC 密钥（契约第 2.5.1 条），由配置提供 */
  sourceKey: Buffer;
  log?: Log;
}

/** 路径对应的路由与路径参数；不是已知路径时为空 */
function route(path: string): { methods: Readonly<Record<string, Handler>>; param?: string } | undefined {
  const fixed = ROUTES[path];
  if (fixed) return { methods: fixed };
  const match = PARAM_ROUTE.exec(path);
  const methods = match ? ROUTES[`${match[1]}/{}`] : undefined;
  return methods && match ? { methods, param: match[2] } : undefined;
}

/** 请求的路径；无法解析时为空串 */
function pathOf(url: string | undefined): string {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return '';
  }
}

/** 处理一次已确认来源的接口请求 */
async function handle(req: IncomingMessage, res: ServerResponse, origin: string | undefined, opt: AccountApiOptions) {
  const found = route(pathOf(req.url));
  if (!found) {
    req.resume();
    res.writeHead(HTTP_NOT_FOUND, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).end();
    return;
  }
  const methods = Object.keys(found.methods);
  if (req.method === 'OPTIONS' && origin) {
    preflight(res, origin, methods);
    return;
  }
  const handler = found.methods[req.method ?? ''];
  if (!handler) {
    req.resume();
    sendProblem(res, origin, { status: 405, code: 'request.method-not-allowed' }, { Allow: methods.join(', ') });
    return;
  }
  const body = handler.fields ? await readJson(req, handler.fields) : (await readEmpty(req), {});
  const source = createHmac('sha256', opt.sourceKey).update(clientIp(req)).digest('hex');
  const reply = await handler.run({ req, body, source, param: found.param }, opt);
  sendJson(res, origin, reply.status, reply.body);
}

/** 在 next 之前接上账号接口；`/api/` 以外的请求原样交给 next */
export function withAccountApi(next: Web, opt: AccountApiOptions): Web {
  const allowed = new Set(opt.origins);
  return (req, res) => {
    if (!pathOf(req.url).startsWith(API_PREFIX)) {
      next(req, res);
      return;
    }
    const { allowed: permitted, origin } = originOf(req, allowed);
    if (!permitted) {
      req.resume();
      sendProblem(res, undefined, { status: 403, code: 'request.origin-denied' });
      return;
    }
    handle(req, res, origin, opt).catch((error: unknown) => {
      if (res.headersSent) return;
      if (error instanceof ApiProblem) {
        sendProblem(res, origin, error.problem, error.problem.status === HTTP_TOO_LARGE ? { Connection: 'close' } : {});
        return;
      }
      const problem = internalProblem();
      opt.log?.('error', 'internal.error', { msg: '账号接口异常', errorId: problem.errorId, err: error });
      sendProblem(res, origin, problem);
    });
  };
}

/**
 * 按 IP 的 HTTP 限流（API-041）落在账号接口上时的回应：契约第 2.5.2 条的 429 `rate.limited`，带 retryAfterMs，
 * 允许的来源照常回显，页面才能读到等待时长；其他路径交给 fallback
 */
export function apiLimited(origins: readonly string[], fallback: Limited): Limited {
  const allowed = new Set(origins);
  return (res, retryAfterSecs, req) => {
    if (!pathOf(req.url).startsWith(API_PREFIX)) {
      fallback(res, retryAfterSecs, req);
      return;
    }
    req.resume();
    sendProblem(res, originOf(req, allowed).origin, { status: 429, code: 'rate.limited', retryAfterMs: retryAfterSecs * MS_PER_SEC });
  };
}

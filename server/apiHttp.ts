/**
 * `/api/*` 的通用 HTTP 边界（账号接口契约第 2 章）：有界读取 JSON 请求体、RFC 9457 错误响应、精确来源允许名单与预检、Bearer 令牌。
 * 不含业务；响应统一不缓存并带 nosniff 与 no-referrer。
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isRecord } from '../src/shared/check';
import { ERRORS, type ErrorCode } from '../src/shared/errors';

/** 请求体字节上限，按实际读取计（契约第 2.1 条，与 API-002 一致） */
export const API_BODY_MAX_BYTES = 4096;
/** 未知字段超过此数按非法请求处理（与 API-011 一致） */
const UNKNOWN_FIELDS_MAX = 16;
/** 预检结果的缓存时长（秒） */
const PREFLIGHT_MAX_AGE_SECS = 600;
const MS_PER_SEC = 1000;
const HTTP_NO_CONTENT = 204;
const TOKEN = /^Bearer ([0-9a-f]{32})$/;
const JSON_TYPE = /^application\/json\s*(;\s*charset=utf-8\s*)?$/i;
/** 官网与接口共用的公开来源；错误类型与文书地址以此为前缀 */
export const SITE_ORIGIN = 'https://yi.lightking.com.cn';
const ERROR_TYPE_BASE = `${SITE_ORIGIN}/errors/`;

/** 一次错误响应：状态码、错误码与可选的附加内容 */
export interface Problem {
  status: number;
  code: ErrorCode;
  params?: Record<string, string | number>;
  retryAfterMs?: number;
  errorId?: string;
}

/** 业务处理中抛出，由入口转为错误响应；其他异常一律按 E5 处理 */
export class ApiProblem extends Error {
  constructor(readonly problem: Problem) {
    super(problem.code);
  }
}

/** 各响应共有的头；来源被允许时回显该来源（契约第 2.4.1 条） */
function baseHeaders(origin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers.Vary = 'Origin';
  }
  return headers;
}

/** 写出 JSON 成功响应；body 为空时只写状态码（204） */
export function sendJson(res: ServerResponse, origin: string | undefined, status: number, body?: unknown) {
  const headers = baseHeaders(origin);
  if (body === undefined) {
    res.writeHead(status, headers).end();
    return;
  }
  const text = JSON.stringify(body);
  res.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(Buffer.byteLength(text)) }).end(text);
}

/** 写出 RFC 9457 错误响应，字段与 API-020 一致，不含自然语言文本；等待时长同时写入 Retry-After（向上取整的秒数） */
export function sendProblem(res: ServerResponse, origin: string | undefined, problem: Problem, extra: Record<string, string> = {}) {
  const { status, code, params, retryAfterMs, errorId } = problem;
  const body = { type: ERROR_TYPE_BASE + code, status, code, level: ERRORS[code].level, params, retryAfterMs, errorId };
  const text = JSON.stringify(body);
  const headers: Record<string, string> = {
    ...baseHeaders(origin),
    ...extra,
    'Content-Type': 'application/problem+json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(text)),
  };
  if (retryAfterMs !== undefined) headers['Retry-After'] = String(Math.max(1, Math.ceil(retryAfterMs / MS_PER_SEC)));
  res.writeHead(status, headers).end(text);
}

/** 未预期的异常：响应只带 errorId，调用栈只进日志（API-023） */
export function internalProblem(): Problem {
  return { status: 500, code: 'server.internal', errorId: randomUUID() };
}

/** 来源检查的结果：不带 Origin 时 allowed 为真、origin 为空；带了但不在名单内时 allowed 为假 */
export function originOf(req: IncomingMessage, allowed: ReadonlySet<string>): { allowed: boolean; origin?: string } {
  const origin = req.headers.origin;
  if (origin === undefined) return { allowed: true };
  return allowed.has(origin) ? { allowed: true, origin } : { allowed: false };
}

/** 预检的回应：只允许列出的方法与两个请求头，不允许携带凭据（契约第 2.4.3 条） */
export function preflight(res: ServerResponse, origin: string, methods: readonly string[]) {
  res
    .writeHead(HTTP_NO_CONTENT, {
      ...baseHeaders(origin),
      'Access-Control-Allow-Methods': methods.join(', '),
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': String(PREFLIGHT_MAX_AGE_SECS),
    })
    .end();
}

/** Authorization 头中的登录令牌；缺失或格式不符时为空 */
export function bearer(req: IncomingMessage): string | undefined {
  return TOKEN.exec(req.headers.authorization ?? '')?.[1];
}

/** 读完请求体；超过上限时立即停止读取并以 413 拒绝，不信任 Content-Length */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > API_BODY_MAX_BYTES) {
        req.removeAllListeners('data');
        req.resume();
        reject(new ApiProblem({ status: 413, code: 'request.too-large' }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const invalid = (field?: string) => new ApiProblem({ status: 400, code: 'request.invalid', params: field ? { field } : undefined });

/**
 * 读取并校验 JSON 对象请求体（契约第 2.1 条）：内容类型、大小、UTF-8、顶层对象，以及 known 之外的字段数。
 * 返回的对象尚未逐字段校验，调用者须再校验每个字段
 */
export async function readJson(req: IncomingMessage, known: readonly string[]): Promise<Record<string, unknown>> {
  if (!JSON_TYPE.test(req.headers['content-type'] ?? '')) {
    req.resume();
    throw invalid();
  }
  const raw = await readBody(req);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch {
    throw invalid();
  }
  if (!isRecord(value) || Object.keys(value).filter(key => !known.includes(key)).length > UNKNOWN_FIELDS_MAX) throw invalid();
  return value;
}

/** 不带请求体的方法：有任何请求体都按非法请求处理 */
export async function readEmpty(req: IncomingMessage): Promise<void> {
  if ((await readBody(req)).length) throw invalid();
}

/** 字段校验失败：400 并指明字段名 */
export function invalidField(field: string): ApiProblem {
  return invalid(field);
}

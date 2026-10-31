/** 官网 HTML 响应：统一安全头和 HEAD 语义，仅平台推荐页请求额外设备提示（API-063）。 */
import type { ServerResponse } from 'node:http';
import { CLIENT_HINT_HEADERS } from './platform';

const OK = 200;
const MOVED = 301;
const HTML_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'",
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-cache',
};

/** HEAD 与 GET 的长度一致但不发送正文；纯阅读页面不请求客户端芯片等提示。 */
export function sendPage(res: ServerResponse, body: Buffer, head: boolean, platform = true) {
  res.writeHead(OK, { ...HTML_HEADERS, ...(platform ? CLIENT_HINT_HEADERS : {}), 'Content-Length': body.length }).end(head ? undefined : body);
}

/** 文书白名单：直接返回草案页或规范化尾斜杠，不接受其他文件名或子路径。 */
export function sendDocument(res: ServerResponse, pages: ReadonlyMap<string, Buffer>, name: string, head: boolean) {
  const body = pages.get(name);
  if (body) {
    sendPage(res, body, head, false);
    return true;
  }
  const canonical = name.endsWith('/') ? name.slice(0, -1) : '';
  if (!pages.has(canonical)) return false;
  res.writeHead(MOVED, { 'X-Content-Type-Options': 'nosniff', Location: `/${encodeURIComponent(canonical)}` }).end();
  return true;
}

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

interface PageOptions {
  head: boolean;
  platform?: boolean;
  status?: number;
  /** 仅静态帮助目录允许加载同源外部脚本 */
  script?: boolean;
}

/** HEAD 与 GET 的长度一致但不发送正文；纯阅读页面不请求客户端芯片等提示。 */
export function sendPage(res: ServerResponse, body: Buffer, { head, platform = true, status = OK, script = false }: PageOptions) {
  const security = script ? { ...HTML_HEADERS, 'Content-Security-Policy': `${HTML_HEADERS['Content-Security-Policy']}; script-src 'self'` } : HTML_HEADERS;
  res.writeHead(status, { ...security, ...(platform ? CLIENT_HINT_HEADERS : {}), 'Content-Length': body.length }).end(head ? undefined : body);
}

/** 路径逐段编码，保留文书目录中的斜杠。 */
function documentLocation(name: string) {
  return `/${name.split('/').map(encodeURIComponent).join('/')}`;
}

/** 文书白名单：直接返回页面或规范化尾斜杠，不接受其他路径。 */
export function sendDocument(res: ServerResponse, pages: ReadonlyMap<string, Buffer>, name: string, head: boolean) {
  const body = pages.get(name);
  if (body) {
    sendPage(res, body, { head, platform: false });
    return true;
  }
  const canonical = name.endsWith('/') ? name.slice(0, -1) : '';
  if (!pages.has(canonical)) return false;
  res.writeHead(MOVED, { 'X-Content-Type-Options': 'nosniff', Location: documentLocation(canonical) }).end();
  return true;
}

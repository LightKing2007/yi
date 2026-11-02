/** 官网更新清单的固定白名单；异步读取小文件，不将任意路径交给文件系统（API-060、SEC-070）。 */
import fs from 'node:fs';
import path from 'node:path';
import type { ServerResponse } from 'node:http';

const MAX_BYTES = 65_536;
const OK = 200,
  NOT_FOUND = 404,
  UNAVAILABLE = 503;
const NAMES: ReadonlySet<string> = new Set(['latest.yml', 'latest-linux.yml']);

/** 命中固定更新清单时接管响应；安装程序仍复用原有并发限制和流式下载。 */
export function sendUpdateFeed(dir: string, name: string, res: ServerResponse, head: boolean): boolean {
  if (!NAMES.has(name)) return false;
  const file = path.join(dir, name);
  const headers = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Content-Type': 'text/yaml; charset=utf-8' };
  fs.stat(file, (err, stat) => {
    if (res.destroyed) return;
    if (err || !stat.isFile() || stat.size > MAX_BYTES) {
      res.writeHead(NOT_FOUND, headers).end();
      return;
    }
    // 跟随 current 切换时允许本次读取失败，由客户端显式重试，绝不发送半份清单。
    fs.readFile(file, (failure, body) => {
      if (res.destroyed) return;
      if (failure || body.length > MAX_BYTES) res.writeHead(UNAVAILABLE, { ...headers, 'Retry-After': '30' }).end();
      else res.writeHead(OK, { ...headers, 'Content-Length': body.length }).end(head ? undefined : body);
    });
  });
  return true;
}

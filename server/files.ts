/**
 * 安装包下载：联机端口上的普通网页请求（不是 WebSocket 的）走这里，不用另开端口。路径白名单（API-060）：
 *   GET /             下载页面（page.ts）
 *   GET /<文件名>     下载这个文件，支持断点续传；目录里只认 Yi-版本-平台 这样命名的文件，其他文件与子目录一概不给
 *   GET /SHA256SUMS   各安装程序的 SHA-256（SEC-070）
 *   GET /assets/<名>  下载页面的标题图、图标与字体：名单见 ASSET_TYPES，内容在构建时嵌入，运行时不读取磁盘
 * 每个 IP 同时最多 2 个下载、全服最多 8 个，免得下载把带宽占满影响对局；下载速率持续过低的连接被断开（API-047）。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PLATFORMS, downloadPage, type PagePkg } from './page';

const PER_IP = 2,
  TOTAL = 8;
const NAME = /^Yi-(\d+(?:\.\d+)*)-(mac-arm64|mac-x64|win-x64|linux-x86_64)[\w.-]*\.(dmg|exe|AppImage)$/;
const ORDER = Object.keys(PLATFORMS);
/** 下载并发已满或校验值尚未算完时，建议客户端多久后重试 */
const RETRY_AFTER_SECS = 30;
/** 资源的浏览器缓存时长：地址带版本参数，换版本即换地址 */
const ASSET_MAX_AGE_SECS = 7 * 24 * 3600;

/** 下载速率的下限（API-047）：每 stallMs 毫秒内送出的字节数低于 minBytesPerSec 对应的量时断开，免得慢速读取长期占住下载名额 */
export interface StallLimit {
  stallMs: number;
  minBytesPerSec: number;
}
/** 写入速率低于 1 KB/s 持续 60 秒即断开 */
const STALL: StallLimit = { stallMs: 60_000, minBytesPerSec: 1024 };

/** /assets/ 下允许的资源与内容类型（API-060 的名单）；内容见 scripts/page-assets.mjs */
const ASSET_TYPES: Record<string, string> = {
  'title-yi.png': 'image/png',
  'icon.png': 'image/png',
  'yi-serif-900.woff2': 'font/woff2',
};

/** 所有响应都带的头（API-063） */
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff' };
/** HTML 响应另带的头（API-063）：不允许任何脚本 */
const HTML_HEADERS = {
  ...BASE_HEADERS,
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'",
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-cache',
};

interface Pkg {
  file: string;
  version: string;
  platform: string;
  size: number;
  mtimeMs: number;
}

const cmpVer = (a: string, b: string) => {
  const x = a.split('.').map(Number),
    y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** 目录里每个平台最新的安装包 */
function list(dir: string): Pkg[] {
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const best = new Map<string, Pkg>();
  for (const file of names) {
    const m = NAME.exec(file);
    if (!m) continue;
    let st: fs.Stats;
    try {
      st = fs.statSync(path.join(dir, file));
    } catch {
      continue;
    } // 刚好被删掉或改名：本次不列出
    if (!st.isFile()) continue;
    const p = { file, version: m[1], platform: m[2], size: st.size, mtimeMs: st.mtimeMs };
    const old = best.get(p.platform);
    if (!old || cmpVer(p.version, old.version) > 0) best.set(p.platform, p);
  }
  return ORDER.filter(k => best.has(k)).map(k => best.get(k)!); // 例外 COD-052：best.has(k) 刚确认过有这一项
}

/**
 * 安装程序的 SHA-256：在后台流式计算一次，按文件名、大小与修改时间缓存；文件被替换后自动重算。
 * 尚未算完时 get 返回 null
 */
function checksums(dir: string) {
  const done = new Map<string, string>(),
    running = new Set<string>();
  const key = (p: Pkg) => `${p.file}:${p.size}:${p.mtimeMs}`;
  return {
    get(p: Pkg): string | null {
      const k = key(p),
        hex = done.get(k);
      if (hex) return hex;
      if (!running.has(k)) {
        running.add(k);
        const hash = createHash('sha256');
        fs.createReadStream(path.join(dir, p.file))
          .on('data', d => hash.update(d))
          .on('end', () => {
            done.set(k, hash.digest('hex'));
            running.delete(k);
          })
          .on('error', () => {
            running.delete(k);
          }); // 文件在计算途中被替换：下次请求时按新文件重算
      }
      return null;
    },
  };
}

/** 下载页面与安装包的请求处理；dir 为安装包所在的目录，stall 为下载速率的下限（测试时可调小） */
export function fileServer(dir: string, stall: StallLimit = STALL) {
  const perIp = new Map<string, number>();
  let total = 0;
  const sums = checksums(dir);
  const notFound = (res: ServerResponse) => {
    res.writeHead(404, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' }).end('未找到所请求的文件。');
  };

  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...BASE_HEADERS, Allow: 'GET, HEAD' }).end();
      return;
    }
    let name: string;
    try {
      name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.slice(1));
    } catch {
      res.writeHead(400, BASE_HEADERS).end();
      return;
    }
    const head = req.method === 'HEAD';

    if (name === '') {
      const pkgs: PagePkg[] = list(dir).map(p => ({ ...p, sha256: sums.get(p) }));
      const body = downloadPage(pkgs, __APP_VERSION__);
      res.writeHead(200, { ...HTML_HEADERS, 'Content-Length': Buffer.byteLength(body) }).end(head ? undefined : body);
      return;
    }

    if (name.startsWith('assets/')) {
      const asset = name.slice('assets/'.length);
      const type = Object.hasOwn(ASSET_TYPES, asset) ? ASSET_TYPES[asset] : undefined;
      const data = type && __PAGE_ASSETS__[asset] ? Buffer.from(__PAGE_ASSETS__[asset], 'base64') : undefined;
      if (!type || !data) {
        notFound(res);
        return;
      }
      res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': `public, max-age=${ASSET_MAX_AGE_SECS}` });
      res.end(head ? undefined : data);
      return;
    }

    if (name === 'SHA256SUMS') {
      const pkgs = list(dir),
        lines = pkgs.map(p => [sums.get(p), p.file] as const);
      if (lines.some(([hex]) => !hex)) {
        res
          .writeHead(503, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': String(RETRY_AFTER_SECS) })
          .end('校验值正在计算，请稍后再试。');
        return;
      }
      const body = lines.map(([hex, file]) => `${hex}  ${file}\n`).join('');
      const type = 'text/plain; charset=utf-8';
      res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache' });
      res.end(head ? undefined : body);
      return;
    }

    const pkg = NAME.test(name) ? list(dir).find(p => p.file === name) : undefined;
    if (!pkg) {
      notFound(res);
      return;
    }

    // 断点续传：只认 bytes=开始-结束 一段
    let start = 0,
      end = pkg.size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      if (range[1]) {
        start = Number(range[1]);
        if (range[2]) end = Math.min(end, Number(range[2]));
      } else start = Math.max(0, pkg.size - Number(range[2]));
      if (start > end) {
        res.writeHead(416, { ...BASE_HEADERS, 'Content-Range': `bytes */${pkg.size}` }).end();
        return;
      }
    }
    const headers = {
      ...BASE_HEADERS,
      'Content-Type': 'application/octet-stream',
      'Content-Length': end - start + 1,
      'Content-Disposition': `attachment; filename="${pkg.file}"`,
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${pkg.size}` } : {}),
    };
    if (head) {
      res.writeHead(range ? 206 : 200, headers).end();
      return;
    }

    const ip = req.socket.remoteAddress ?? '';
    if ((perIp.get(ip) ?? 0) >= PER_IP || total >= TOTAL) {
      res
        .writeHead(503, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': String(RETRY_AFTER_SECS) })
        .end('当前下载请求过多，请稍后再试。');
      return;
    }
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
    total++;
    let done = false;
    const release = () => {
      if (done) return;
      done = true;
      total--;
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n > 0) perIp.set(ip, n);
      else perIp.delete(ip);
    };
    res.writeHead(range ? 206 : 200, headers);
    const stream = fs.createReadStream(path.join(dir, pkg.file), { start, end });
    // 管道按对方的读取速度送数据：对方不读时 data 事件随之停下，以此计量实际送出的字节数
    let sent = 0;
    stream.on('data', chunk => {
      sent += chunk.length;
    });
    const minBytes = (stall.minBytesPerSec * stall.stallMs) / 1000;
    const watch = setInterval(() => {
      if (sent < minBytes) res.destroy();
      else sent = 0;
    }, stall.stallMs);
    stream.on('end', () => clearInterval(watch)); // 文件已读完：剩下的只是套接字缓冲区里有限的数据
    res.on('close', () => {
      clearInterval(watch);
      stream.destroy();
      release();
    });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  };
}

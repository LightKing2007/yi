/**
 * 安装包下载：联机端口上的普通网页请求（不是 WebSocket 的）走这里，不用另开端口。路径白名单（API-060）：
 *   GET /             主页（homePage.ts）
 *   GET /download/    下载页面（downloadPage.ts）；带 ?start 时推断确定的访客进入页面即开始下载。/download 重定向到 /download/
 *   GET /agreement   文书目录；三份文件各用 /文件名 访问（agreementText.ts）；尾斜杠重定向至规范路径
 *   GET /<文件名>     下载这个文件，支持断点续传；目录里只认 Yi-版本-平台 这样命名的文件，其他文件与子目录一概不给
 *   GET /SHA256SUMS   各安装程序的 SHA-256（SEC-070）
 *   GET /assets/<名>  页面的标题图、图标、备案图标与字体：名单见 ASSET_TYPES，内容在构建时嵌入，运行时不读取磁盘
 * 主页与下载页面按请求头推断访客的操作系统（platform.ts），推荐对应的安装程序；页面不含脚本（API-063）。
 * 每个 IP（经反向代理时按真实地址，clientIp.ts）同时最多 2 个下载、全服最多 8 个，免得下载把带宽占满影响对局；下载速率持续过低的连接被断开（API-047）。
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { clientIp } from './clientIp';
import { agreementPages } from './agreementPage';
import { downloadPage } from './downloadPage';
import { homePage } from './homePage';
import { PLATFORMS, type PagePkg } from './page';
import { sendDocument, sendPage } from './pageResponse';
import { detectPlatform } from './platform';

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
  'yi-serif-400.woff2': 'font/woff2',
  'icp.png': 'image/png',
};

/** 所有响应都带的头（API-063） */
const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff' };
/** 响应的状态码；超出 HTTP 请求频率时回应 TOO_MANY_REQUESTS（04-api.md 第 4.1 条） */
const OK = 200,
  PARTIAL = 206,
  MOVED = 301,
  BAD_REQUEST = 400,
  NOT_FOUND = 404,
  METHOD_NOT_ALLOWED = 405,
  RANGE_NOT_SATISFIABLE = 416,
  TOO_MANY_REQUESTS = 429,
  UNAVAILABLE = 503;

/** 回应超出按 IP 的 HTTP 请求频率（API-041）：429 与 Retry-After（秒） */
export function tooManyRequests(res: ServerResponse, retryAfterSecs: number) {
  res
    .writeHead(TOO_MANY_REQUESTS, { ...BASE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': String(retryAfterSecs) })
    .end('请求过于频繁，请稍后再试。');
}

/** 页面的路径（不含开头的斜杠）：主页与下载页面 */
const HOME = '',
  DOWNLOAD = 'download/';

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
    const [, version, platform] = NAME.exec(file) ?? [];
    if (!version || !platform) continue;
    let st: fs.Stats;
    try {
      st = fs.statSync(path.join(dir, file));
    } catch {
      continue;
    } // 刚好被删掉或改名：本次不列出
    if (!st.isFile()) continue;
    const p = { file, version, platform, size: st.size, mtimeMs: st.mtimeMs };
    const old = best.get(p.platform);
    if (!old || cmpVer(p.version, old.version) > 0) best.set(p.platform, p);
  }
  return ORDER.flatMap(k => best.get(k) ?? []);
}

/**
 * 目录列表的缓存（P2-17）：目录的 inode 与修改时间都不变时沿用上次的结果，省去每次请求读目录、逐个查看文件。
 * 目录里增删、改名文件，或经 current 切换到另一个版本的目录时，二者之一会变；原地改写文件不会改变目录，
 * 故下载前另以 fresh 核对该文件，不一致时作废缓存
 */
function listing(dir: string) {
  let key = '',
    pkgs: Pkg[] = [];
  const load = (): Pkg[] => {
    let st: fs.Stats;
    try {
      st = fs.statSync(dir);
    } catch {
      key = '';
      return [];
    }
    const k = `${st.ino}:${st.mtimeMs}`;
    if (k !== key) {
      pkgs = list(dir);
      key = k;
    }
    return pkgs;
  };
  return {
    load,
    /** 按文件名取安装包，并核对文件的大小与修改时间仍与缓存一致；不一致时重新读取目录 */
    fresh(file: string): Pkg | undefined {
      const pkg = load().find(p => p.file === file);
      if (!pkg) return undefined;
      let st: fs.Stats | null = null;
      try {
        st = fs.statSync(path.join(dir, file));
      } catch {
        // 文件刚被删掉或改名：重新读取目录
      }
      if (st && st.size === pkg.size && st.mtimeMs === pkg.mtimeMs) return pkg;
      key = '';
      return load().find(p => p.file === file);
    },
  };
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

/**
 * 生成主页与下载页面，并缓存：安装包列表未变、校验值都已算好时沿用上次生成的页面。页面随推断的操作系统与是否自动开始下载而不同，
 * 按这几项分别缓存；各项的取值都有限（platform.ts），缓存不会无限增长。route 为 HOME 或 DOWNLOAD
 */
function pages(pkgs: ReturnType<typeof listing>, sums: ReturnType<typeof checksums>) {
  let cache = { from: null as Pkg[] | null, bodies: new Map<string, Buffer>() };
  return (route: string, req: IncomingMessage, starting: boolean) => {
    const current = pkgs.load();
    if (cache.from !== current) cache = { from: null, bodies: new Map() };
    const detected = detectPlatform(req.headers);
    const key = `${route}|${detected.platform}|${detected.mobile}|${detected.sure}|${starting}`;
    const cached = cache.bodies.get(key);
    if (cached !== undefined) return cached;
    const shown: PagePkg[] = current.map(p => ({ ...p, sha256: sums.get(p) }));
    const html = route === HOME ? homePage(shown, detected, __APP_VERSION__) : downloadPage(shown, detected, __APP_VERSION__, starting);
    const body = Buffer.from(html);
    if (shown.every(p => p.sha256)) cache = { from: current, bodies: cache.bodies.set(key, body) }; // 校验值未算完时不缓存，下次重新生成
    return body;
  };
}

const MS_PER_SEC = 1000;
const TEXT = 'text/plain; charset=utf-8';

function notFound(res: ServerResponse) {
  res.writeHead(NOT_FOUND, { ...BASE_HEADERS, 'Content-Type': TEXT }).end('未找到所请求的文件。');
}

/** 暂时无法提供（下载并发已满或校验值尚未算完）：503 与 Retry-After */
function unavailable(res: ServerResponse, text: string) {
  res.writeHead(UNAVAILABLE, { ...BASE_HEADERS, 'Content-Type': TEXT, 'Retry-After': String(RETRY_AFTER_SECS) }).end(text);
}

/** 从请求地址取出路径（不含开头的斜杠）与是否带 start；地址无法解析时返回 null */
function parseUrl(req: IncomingMessage): { name: string; starting: boolean } | null {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    return { name: decodeURIComponent(url.pathname.slice(1)), starting: url.searchParams.has('start') };
  } catch {
    return null; // 路径中的百分号编码不合法
  }
}

/** /assets/ 下的资源：只给 ASSET_TYPES 名单中、构建时已嵌入的 */
function sendAsset(res: ServerResponse, asset: string, head: boolean) {
  const type = Object.hasOwn(ASSET_TYPES, asset) ? ASSET_TYPES[asset] : undefined;
  const data = type && __PAGE_ASSETS__[asset] ? Buffer.from(__PAGE_ASSETS__[asset], 'base64') : undefined;
  if (!type || !data) {
    notFound(res);
    return;
  }
  res.writeHead(OK, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': data.length, 'Cache-Control': `public, max-age=${ASSET_MAX_AGE_SECS}` });
  res.end(head ? undefined : data);
}

/** /SHA256SUMS：各安装程序的校验值；尚未全部算完时回应 503 */
function sendSums(res: ServerResponse, current: Pkg[], sums: ReturnType<typeof checksums>, head: boolean) {
  const lines = current.map(p => [sums.get(p), p.file] as const);
  if (lines.some(([hex]) => !hex)) {
    unavailable(res, '校验值正在计算，请稍后再试。');
    return;
  }
  const body = lines.map(([hex, file]) => `${hex}  ${file}\n`).join('');
  res.writeHead(OK, { ...BASE_HEADERS, 'Content-Type': TEXT, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache' });
  res.end(head ? undefined : body);
}

/** 要送出的字节区间；partial 为请求带了 Range（回应 206 与 Content-Range） */
interface Span {
  start: number;
  end: number;
  partial: boolean;
}

/** 断点续传：只认 bytes=开始-结束 一段；区间不成立时返回 null（回应 416） */
function parseRange(header: string | undefined, size: number): Span | null {
  let start = 0,
    end = size - 1;
  const range = /^bytes=(\d*)-(\d*)$/.exec(header ?? '');
  if (range && (range[1] || range[2])) {
    if (range[1]) {
      start = Number(range[1]);
      if (range[2]) end = Math.min(end, Number(range[2]));
    } else start = Math.max(0, size - Number(range[2]));
    if (start > end) return null;
  }
  return { start, end, partial: Boolean(range) };
}

/** 下载的并发名额：每个 IP 同时最多 PER_IP 个、全服最多 TOTAL 个 */
function slots() {
  const perIp = new Map<string, number>();
  let total = 0;
  return {
    active: () => total,
    /** 占用一个名额，返回只生效一次的释放函数；名额已满时返回 null */
    take(ip: string): (() => void) | null {
      if ((perIp.get(ip) ?? 0) >= PER_IP || total >= TOTAL) return null;
      perIp.set(ip, (perIp.get(ip) ?? 0) + 1);
      total++;
      let done = false;
      return () => {
        if (done) return;
        done = true;
        total--;
        const n = (perIp.get(ip) ?? 1) - 1;
        if (n > 0) perIp.set(ip, n);
        else perIp.delete(ip);
      };
    },
  };
}

/** 把文件的一段送给对方，速率持续低于 stall 时断开（API-047）；连接关闭时调用 release */
function pipeFile(res: ServerResponse, file: string, span: Span, opts: { stall: StallLimit; release: () => void }) {
  const stream = fs.createReadStream(file, { start: span.start, end: span.end });
  // 管道按对方的读取速度送数据：对方不读时 data 事件随之停下，以此计量实际送出的字节数
  let sent = 0;
  stream.on('data', chunk => {
    sent += chunk.length;
  });
  const minBytes = (opts.stall.minBytesPerSec * opts.stall.stallMs) / MS_PER_SEC;
  const watch = setInterval(() => {
    if (sent < minBytes) res.destroy();
    else sent = 0;
  }, opts.stall.stallMs);
  stream.on('end', () => clearInterval(watch)); // 文件已读完：剩下的只是套接字缓冲区里有限的数据
  res.on('close', () => {
    clearInterval(watch);
    stream.destroy();
    opts.release();
  });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

/** 安装程序的下载：支持 Range；HEAD 只回头部，不占下载名额 */
function installers(dir: string, stall: StallLimit) {
  const pool = slots();
  const send = (req: IncomingMessage, res: ServerResponse, pkg: Pkg) => {
    const span = parseRange(req.headers.range, pkg.size);
    if (!span) {
      res.writeHead(RANGE_NOT_SATISFIABLE, { ...BASE_HEADERS, 'Content-Range': `bytes */${pkg.size}` }).end();
      return;
    }
    const headers = {
      ...BASE_HEADERS,
      'Content-Type': 'application/octet-stream',
      'Content-Length': span.end - span.start + 1,
      'Content-Disposition': `attachment; filename="${pkg.file}"`,
      'Accept-Ranges': 'bytes',
      ...(span.partial ? { 'Content-Range': `bytes ${span.start}-${span.end}/${pkg.size}` } : {}),
    };
    const status = span.partial ? PARTIAL : OK;
    if (req.method === 'HEAD') {
      res.writeHead(status, headers).end();
      return;
    }
    const release = pool.take(clientIp(req));
    if (!release) {
      unavailable(res, '当前下载请求过多，请稍后再试。');
      return;
    }
    res.writeHead(status, headers);
    pipeFile(res, path.join(dir, pkg.file), span, { stall, release });
  };
  return { send, active: pool.active };
}

/** 主页、下载页面与安装包的请求处理；dir 为安装包所在的目录，stall 为下载速率的下限（测试时可调小） */
export function fileServer(dir: string, stall: StallLimit = STALL) {
  const sums = checksums(dir);
  const pkgs = listing(dir);
  const render = pages(pkgs, sums);
  const agreements = agreementPages(__APP_VERSION__);
  const downloads = installers(dir, stall);
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(METHOD_NOT_ALLOWED, { ...BASE_HEADERS, Allow: 'GET, HEAD' }).end();
      return;
    }
    const url = parseUrl(req);
    if (!url) {
      res.writeHead(BAD_REQUEST, BASE_HEADERS).end();
      return;
    }
    const { name, starting } = url;
    const head = req.method === 'HEAD';
    if (sendDocument(res, agreements, name, head)) return;
    if (name === HOME || name === DOWNLOAD) sendPage(res, render(name, req, name === DOWNLOAD && starting), head);
    // 只保留页面认得的 start：主页的下载按钮若被写成 /download?start，重定向之后仍自动开始下载
    else if (`${name}/` === DOWNLOAD) res.writeHead(MOVED, { ...BASE_HEADERS, Location: `/${DOWNLOAD}${starting ? '?start' : ''}` }).end();
    else if (name.startsWith('assets/')) sendAsset(res, name.slice('assets/'.length), head);
    else if (name === 'SHA256SUMS') sendSums(res, pkgs.load(), sums, head);
    else {
      const pkg = NAME.test(name) ? pkgs.fresh(name) : undefined;
      if (pkg) downloads.send(req, res, pkg);
      else notFound(res);
    }
  };
  /** 进行中的下载数（指标 yi_downloads_active） */
  return Object.assign(handle, { active: downloads.active });
}

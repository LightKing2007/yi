/**
 * 把 RoomServer 接到 WebSocket 上：可以同时监听几个端口（换端口的过渡期新旧端口都开），共用同一个 RoomServer。
 * 同一个端口上的普通网页请求：本机来的 /healthz 回应健康检查（API-061），其余交给安装包下载（设了 files 目录时），没设就一律 404。
 * 连接层的限制：单条消息大小（API-002）、同一 IP 的连接数与新建频率（API-040、API-041）、HTTP 超时（API-047）。
 */
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { CLOSE_CODE } from '../src/shared/protocol';
import { fileServer } from './files';
import { withHealth, type Build, type Web } from './health';
import { IpGate, NEW_CONN_BLOCK_SECS, NEW_CONN_MAX, NEW_CONN_WINDOW_SECS } from './ratelimit';
import { RoomServer, type Conn, type RoomServerOptions } from './rooms';

const MAX_MSG_BYTES = 4096; // 单条消息的字节上限：远大于任何合法消息（API-002）
const MAX_PER_IP = 8; // 同一个 IP 同时最多几条连接（API-040）
/** 每秒的毫秒数 */
const MS_PER_SEC = 1000;
/** 检查各种超时的间隔 */
const TICK_MS = 250;
/** WebSocket 层心跳的间隔；同时清理按 IP 的连接记录 */
const BEAT_MS = 10_000;

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

export interface Host {
  server: RoomServer;
  port: number;
  ports: number[];
  close(): Promise<void>;
}

const notFound: Web = (_req, res) => {
  res.writeHead(404).end();
};

/** 一个监听中的端口 */
interface Listening {
  http: http.Server;
  wss: WebSocketServer;
}

function listen(port: number, host: string | undefined, web: Web) {
  const httpServer = http.createServer(web);
  hardenHttp(httpServer);
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MSG_BYTES, perMessageDeflate: false });
  return new Promise<Listening>((resolve, reject) => {
    // ws 把 HTTP 服务器的 error 事件转发给 WebSocketServer：监听期间两处都要接住，否则端口被占用时成了未处理的异常，进程直接崩溃
    httpServer.once('error', reject);
    wss.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      wss.off('error', reject);
      resolve({ http: httpServer, wss });
    });
  });
}

/** 依次监听 ports；有端口被占用时关掉已开的端口后抛出 */
async function listenAll(ports: number[], host: string | undefined, web: Web) {
  const listening: Listening[] = [];
  try {
    for (const port of ports) listening.push(await listen(port, host, web));
  } catch (err) {
    for (const item of listening) {
      item.wss.close();
      item.http.close();
    }
    throw err;
  }
  return listening;
}

/** 同一 IP 的连接数与新建频率（API-040、API-041），各端口共用 */
class IpLimits {
  private perIp = new Map<string, number>();
  private gate = new IpGate({ max: NEW_CONN_MAX, windowSecs: NEW_CONN_WINDOW_SECS, blockSecs: NEW_CONN_BLOCK_SECS });

  constructor(private readonly now: () => number) {}

  /** 新连接：允许时记上一条并返回 true */
  admit(ip: string): boolean {
    const n = this.perIp.get(ip) ?? 0;
    if (!this.gate.admit(ip, this.now()) || n >= MAX_PER_IP) return false;
    this.perIp.set(ip, n + 1);
    return true;
  }

  /** 连接关闭 */
  release(ip: string) {
    const left = (this.perIp.get(ip) ?? 1) - 1;
    if (left > 0) this.perIp.set(ip, left);
    else this.perIp.delete(ip);
  }

  /** 清理过期的新建记录 */
  prune() {
    this.gate.prune(this.now());
  }
}

/** 把一条 WebSocket 连接接到 RoomServer 上 */
function accept(ws: WebSocket, ip: string, server: RoomServer, limits: IpLimits) {
  if (!limits.admit(ip)) {
    ws.close(CLOSE_CODE.overload, 'too many');
    return;
  }
  const conn: Conn = {
    send: msg => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    },
    close: code => {
      if (code) ws.close(code);
      else ws.terminate();
    },
  };
  let sess = server.connect(conn);
  ws.on('close', code => {
    limits.release(ip);
    if (sess) server.disconnect(sess, conn, code);
    sess = null;
  });
  ws.on('error', () => {});
  if (!sess) {
    ws.close(CLOSE_CODE.overload, 'full');
    return;
  }
  ws.on('message', (data, isBinary) => {
    if (isBinary || !sess) return;
    let msg: unknown;
    try {
      msg = JSON.parse(String(data));
    } catch {
      msg = undefined; /* 不是 JSON：交给 parseC2S 按非法消息处理 */
    }
    sess = server.message(sess, msg, conn);
  });
  ws.on('pong', () => {
    if (sess) server.touch(sess, conn);
  });
}

/** 切断全部连接（含正在下载的；WebSocket 连接已由 RoomServer.shutdown 以 1001 发出关闭帧）并关闭各端口 */
function closeAll(listening: Listening[]) {
  return Promise.all(
    listening.map(
      item =>
        new Promise<void>(res => {
          for (const client of item.wss.clients) client.terminate();
          item.wss.close();
          item.http.close(() => res());
          item.http.closeAllConnections();
        }),
    ),
  ).then(() => {});
}

/** startHost 的选项：files 为安装包所在的目录；build 为健康检查中的版本号与提交号，不设时提交号为空串 */
export type HostOptions = RoomServerOptions & { host?: string; files?: string; build?: Build };

/** 在 ports 上开服（第一个是主端口）；有端口被占用时抛出 */
export async function startHost(ports: number | number[], opt: HostOptions = {}): Promise<Host> {
  const server = new RoomServer(opt);
  const build = opt.build ?? { version: __APP_VERSION__, commit: '' };
  const web = withHealth(build, () => server.health(), opt.files ? fileServer(opt.files) : notFound);
  const listening = await listenAll(Array.isArray(ports) ? ports : [ports], opt.host, web);
  const servers = listening.map(item => item.wss);
  const limits = new IpLimits(opt.now ?? (() => performance.now() / MS_PER_SEC));
  // 服务器对象本身出错（不是某条连接出错）：未预期，按 internal.error 记录（07-operations.md 第 8 节）
  const onError = (err: Error) => opt.log?.('error', 'internal.error', { msg: '服务端错误', errorId: randomUUID(), err });
  for (const item of listening) item.http.on('error', onError);
  for (const wss of servers) {
    wss.on('error', onError);
    wss.on('connection', (ws: WebSocket, req) => accept(ws, req.socket.remoteAddress ?? '', server, limits));
  }

  const timer = setInterval(() => server.tick(), TICK_MS);
  const beat = setInterval(() => {
    for (const wss of servers) for (const client of wss.clients) if (client.readyState === client.OPEN) client.ping();
    limits.prune();
  }, BEAT_MS);
  const actual = listening.map(item => (item.http.address() as AddressInfo).port);
  return {
    server,
    port: actual[0],
    ports: actual,
    close: () => {
      clearInterval(timer);
      clearInterval(beat);
      server.shutdown();
      return closeAll(listening);
    },
  };
}

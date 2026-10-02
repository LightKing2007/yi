/**
 * 把 RoomServer 接到 WebSocket 上：可以同时监听几个端口（换端口的过渡期新旧端口都开），共用同一个 RoomServer。
 * 同一个端口上的普通网页请求交给安装包下载（设了 files 目录时），没设就一律 404。
 * 连接层的限制：单条消息大小（API-002）、同一 IP 的连接数与新建频率（API-040、API-041）、HTTP 超时（API-047）。
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { CLOSE_CODE } from '../src/shared/protocol';
import { fileServer } from './files';
import { IpGate, NEW_CONN_BLOCK_SECS, NEW_CONN_MAX, NEW_CONN_WINDOW_SECS } from './ratelimit';
import { RoomServer, type Conn, type RoomServerOptions } from './rooms';

const MAX_MSG_BYTES = 4096; // 单条消息的字节上限：远大于任何合法消息（API-002）
const MAX_PER_IP = 8; // 同一个 IP 同时最多几条连接（API-040）
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

type Web = (req: http.IncomingMessage, res: http.ServerResponse) => void;
const notFound: Web = (_req, res) => {
  res.writeHead(404).end();
};

function listen(port: number, host: string | undefined, web: Web) {
  const httpServer = http.createServer(web);
  hardenHttp(httpServer);
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MSG_BYTES, perMessageDeflate: false });
  return new Promise<{ http: http.Server; wss: WebSocketServer }>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolve({ http: httpServer, wss });
    });
  });
}

/** 在 ports 上开服（第一个是主端口）；有端口被占用时抛出。files：安装包所在的目录 */
export async function startHost(ports: number | number[], opt: RoomServerOptions & { host?: string; files?: string } = {}): Promise<Host> {
  const list = Array.isArray(ports) ? ports : [ports];
  const web = opt.files ? fileServer(opt.files) : notFound;
  const listening: { http: http.Server; wss: WebSocketServer }[] = [];
  try {
    for (const p of list) listening.push(await listen(p, opt.host, web));
  } catch (e) {
    for (const l of listening) {
      l.wss.close();
      l.http.close();
    }
    throw e;
  }
  const servers = listening.map(l => l.wss);
  const server = new RoomServer(opt);
  const now = opt.now ?? (() => performance.now() / 1000);
  const perIp = new Map<string, number>();
  const gate = new IpGate({ max: NEW_CONN_MAX, windowSecs: NEW_CONN_WINDOW_SECS, blockSecs: NEW_CONN_BLOCK_SECS });

  for (const l of listening) l.http.on('error', e => opt.log?.(`服务端错误：${e.message}`));
  for (const wss of servers) {
    wss.on('error', e => opt.log?.(`服务端错误：${e.message}`));
    wss.on('connection', (ws: WebSocket, req) => {
      const ip = req.socket.remoteAddress ?? '';
      const n = perIp.get(ip) ?? 0;
      if (!gate.admit(ip, now()) || n >= MAX_PER_IP) {
        ws.close(CLOSE_CODE.overload, 'too many');
        return;
      }
      perIp.set(ip, n + 1);
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
      ws.on('close', () => {
        const left = (perIp.get(ip) ?? 1) - 1;
        if (left > 0) perIp.set(ip, left);
        else perIp.delete(ip);
        if (sess) server.disconnect(sess, conn);
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
    });
  }

  const timer = setInterval(() => server.tick(), TICK_MS);
  const beat = setInterval(() => {
    for (const w of servers) for (const c of w.clients) if (c.readyState === c.OPEN) c.ping();
    gate.prune(now());
  }, BEAT_MS);
  const actual = listening.map(l => (l.http.address() as AddressInfo).port);
  return {
    server,
    port: actual[0],
    ports: actual,
    close: () => {
      clearInterval(timer);
      clearInterval(beat);
      server.shutdown();
      return Promise.all(
        listening.map(
          l =>
            new Promise<void>(res => {
              for (const c of l.wss.clients) c.terminate();
              l.wss.close();
              l.http.close(() => res());
              l.http.closeAllConnections(); // 正在下载的连接也断掉
            }),
        ),
      ).then(() => {});
    },
  };
}

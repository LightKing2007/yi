/**
 * 把 RoomServer 接到 WebSocket 上：可以同时监听几个端口（换端口的过渡期新旧端口都开），共用同一个 RoomServer。
 * 同一个端口上的普通网页请求交给安装包下载（设了 files 目录时），没设就一律 404。
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { fileServer } from './files';
import { RoomServer, type Conn, type RoomServerOptions } from './rooms';

const MAX_MSG = 4096;           // 单条消息的字节上限：远大于任何合法消息
const MAX_PER_IP = 8;           // 同一个 IP 同时最多几条连接

export interface Host { server: RoomServer; port: number; ports: number[]; close(): Promise<void> }

type Web = (req: http.IncomingMessage, res: http.ServerResponse) => void;
const notFound: Web = (_req, res) => { res.writeHead(404).end(); };

function listen(port: number, host: string | undefined, web: Web) {
  const httpServer = http.createServer(web);
  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MSG, perMessageDeflate: false });
  return new Promise<{ http: http.Server; wss: WebSocketServer }>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => { httpServer.off('error', reject); resolve({ http: httpServer, wss }); });
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
    for (const l of listening) { l.wss.close(); l.http.close(); }
    throw e;
  }
  const servers = listening.map(l => l.wss);
  const server = new RoomServer(opt);
  const perIp = new Map<string, number>();

  for (const l of listening) l.http.on('error', e => opt.log?.(`服务端错误：${e.message}`));
  for (const wss of servers) {
    wss.on('error', e => opt.log?.(`服务端错误：${e.message}`));
    wss.on('connection', (ws: WebSocket, req) => {
      const ip = req.socket.remoteAddress ?? '';
      const n = perIp.get(ip) ?? 0;
      if (n >= MAX_PER_IP) { ws.close(1013, 'too many'); return; }
      perIp.set(ip, n + 1);
      const conn: Conn = {
        send: msg => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
        close: () => ws.terminate(),
      };
      let sess = server.connect(conn);
      ws.on('close', () => {
        const left = (perIp.get(ip) ?? 1) - 1;
        if (left > 0) perIp.set(ip, left); else perIp.delete(ip);
        if (sess) server.disconnect(sess, conn);
        sess = null;
      });
      ws.on('error', () => {});
      if (!sess) { ws.close(1013, 'full'); return; }
      ws.on('message', (data, isBinary) => {
        if (isBinary || !sess) return;
        let msg: unknown;
        try { msg = JSON.parse(String(data)); } catch { return; }
        sess = server.message(sess, msg, conn);
      });
      ws.on('pong', () => { if (sess) server.touch(sess, conn); });
    });
  }

  const timer = setInterval(() => server.tick(), 250);
  const beat = setInterval(() => { for (const w of servers) for (const c of w.clients) if (c.readyState === c.OPEN) c.ping(); }, 10000);
  const actual = listening.map(l => (l.http.address() as AddressInfo).port);
  return {
    server,
    port: actual[0],
    ports: actual,
    close: () => {
      clearInterval(timer);
      clearInterval(beat);
      server.shutdown();
      return Promise.all(listening.map(l => new Promise<void>(res => {
        for (const c of l.wss.clients) c.terminate();
        l.wss.close();
        l.http.close(() => res());
        l.http.closeAllConnections();                      // 正在下载的连接也断掉
      }))).then(() => {});
    },
  };
}

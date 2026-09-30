/** 把 RoomServer 接到 WebSocket 上：可以同时监听几个端口（换端口的过渡期新旧端口都开），共用同一个 RoomServer */
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { RoomServer, type Conn, type RoomServerOptions } from './rooms';

const MAX_MSG = 4096;           // 单条消息的字节上限：远大于任何合法消息
const MAX_PER_IP = 8;           // 同一个 IP 同时最多几条连接

export interface Host { server: RoomServer; port: number; ports: number[]; close(): Promise<void> }

function listen(port: number, host: string | undefined) {
  const wss = new WebSocketServer({ port, host, maxPayload: MAX_MSG, perMessageDeflate: false });
  return new Promise<WebSocketServer>((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => { wss.off('error', reject); resolve(wss); });
  });
}

/** 在 ports 上开服（第一个是主端口）；有端口被占用时抛出 */
export async function startHost(ports: number | number[], opt: RoomServerOptions & { host?: string } = {}): Promise<Host> {
  const list = Array.isArray(ports) ? ports : [ports];
  const servers: WebSocketServer[] = [];
  try {
    for (const p of list) servers.push(await listen(p, opt.host));
  } catch (e) {
    for (const w of servers) w.close();
    throw e;
  }
  const server = new RoomServer(opt);
  const perIp = new Map<string, number>();

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
  const actual = servers.map(w => (w.address() as AddressInfo).port);
  return {
    server,
    port: actual[0],
    ports: actual,
    close: () => {
      clearInterval(timer);
      clearInterval(beat);
      server.shutdown();
      return Promise.all(servers.map(w => new Promise<void>(res => {
        for (const c of w.clients) c.terminate();
        w.close(() => res());
      }))).then(() => {});
    },
  };
}

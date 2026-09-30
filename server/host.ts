/** 把 RoomServer 接到 WebSocket 上（独立服务端与桌面版的局域网主机共用） */
import { WebSocketServer, type WebSocket } from 'ws';
import type { AddressInfo } from 'node:net';
import { RoomServer, type RoomServerOptions } from './rooms';

const MAX_MSG = 4096;           // 单条消息的字节上限：远大于任何合法消息

export interface Host { server: RoomServer; port: number; close(): Promise<void> }

/** 在 port 上开服；端口被占用时抛出 */
export function startHost(port: number, opt: RoomServerOptions & { host?: string } = {}): Promise<Host> {
  const server = new RoomServer(opt);
  const wss = new WebSocketServer({ port, host: opt.host, maxPayload: MAX_MSG, perMessageDeflate: false });
  return new Promise((resolve, reject) => {
    wss.once('error', reject);
    wss.once('listening', () => {
      wss.off('error', reject);
      wss.on('error', e => opt.log?.(`服务端错误：${e.message}`));
      const timer = setInterval(() => server.tick(), 250);
      const beat = setInterval(() => { for (const c of wss.clients) if (c.readyState === c.OPEN) c.ping(); }, 10000);
      wss.on('connection', (ws: WebSocket) => {
        let sess = server.connect({
          send: msg => { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg)); },
          close: () => ws.terminate(),
        });
        if (!sess) { ws.close(1013, 'full'); return; }
        ws.on('message', (data, isBinary) => {
          if (isBinary || !sess) return;
          let msg: unknown;
          try { msg = JSON.parse(String(data)); } catch { return; }
          sess = server.message(sess, msg);
        });
        ws.on('pong', () => { if (sess) server.touch(sess); });
        ws.on('close', () => { if (sess) server.disconnect(sess); sess = null; });
        ws.on('error', () => {});
      });
      resolve({
        server,
        port: (wss.address() as AddressInfo).port,
        close: () => new Promise<void>(res => {
          clearInterval(timer);
          clearInterval(beat);
          server.shutdown();
          for (const c of wss.clients) c.terminate();
          wss.close(() => res());
        }),
      });
    });
  });
}

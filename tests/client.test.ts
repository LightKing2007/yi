/**
 * 联机客户端（src/online/client.ts）的状态机：用假的 WebSocket 把它直接接到进程内的 RoomServer 上（假时钟），
 * 模拟网络静默断开（服务端还没发现）、服务器重启、网络完全不通、断线期间对局结束等情况。
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { RoomServer, type Conn, type Session } from '../server/rooms';
import { PROTO_VERSION, type C2S, type S2C } from '../src/shared/protocol';

// ---------------- 浏览器环境的替身（必须在导入客户端之前装好） ----------------

const storage = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  location: { search: '' },
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      storage.set(k, v);
    },
    removeItem: (k: string) => {
      storage.delete(k);
    },
  },
  document: { hidden: false, title: '', addEventListener() {}, removeEventListener() {} },
});

// ---------------- 假的网络 ----------------

let T = 1000;
let server: RoomServer;
let netDown = false; // 网络完全不通：新连接一律失败
let dropTypes: string[] = []; // 服务端发出的这些消息在路上丢掉（模拟老版本服务端）
const q: (() => void)[] = [];
const pump = () => {
  for (let i = 0; i < 10000 && q.length; i++) q.shift()!();
};
const newServer = () => new RoomServer({ now: () => T, random: () => 0.3 });

class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  dead = false; // 网络静默断开：两边的消息都到不了，也没有断开事件
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  private srv = server;
  private sess: Session | null = null;
  private conn: Conn | null = null;
  constructor(_url: string) {
    sockets.push(this);
    q.push(() => (netDown ? this.fail() : this.open()));
  }
  private open() {
    if (this.readyState !== 0) return;
    this.conn = {
      send: (m: S2C) => {
        if (!this.dead && !dropTypes.includes(m.t))
          q.push(() => {
            if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(m) });
          });
      },
      close: () => this.fail(),
    };
    this.sess = this.srv.connect(this.conn);
    this.readyState = 1;
    this.onopen?.();
  }
  /** 连接被对端关掉或者连不上 */
  fail() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (!this.dead) q.push(() => this.onclose?.());
  }
  /** 网络断开，两端都察觉到 */
  cut() {
    if (this.sess && this.conn) this.srv.disconnect(this.sess, this.conn);
    this.fail();
  }
  send(data: string) {
    if (this.dead || this.readyState !== 1) return;
    const m = JSON.parse(data);
    q.push(() => {
      if (this.sess && this.conn) this.sess = this.srv.message(this.sess, m, this.conn);
    });
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    if (!this.dead && this.sess && this.conn) {
      const s = this.sess,
        c = this.conn;
      q.push(() => this.srv.disconnect(s, c));
    }
    q.push(() => this.onclose?.());
  }
}
const sockets: FakeWS[] = [];
(globalThis as any).WebSocket = FakeWS;

/** 另一位棋手：直接接在服务端上 */
class Peer {
  inbox: S2C[] = [];
  sess: Session;
  conn: Conn = {
    send: m => {
      this.inbox.push(m);
    },
    close: () => {},
  };
  constructor(public srv: RoomServer) {
    this.sess = srv.connect(this.conn)!;
    this.send({ t: 'hello', v: PROTO_VERSION, name: '乙', uid: 'peer-device-0000000001' });
  }
  send(m: C2S) {
    this.sess = this.srv.message(this.sess, m, this.conn);
    pump();
  }
  has(t: S2C['t']) {
    return this.inbox.some(m => m.t === t);
  }
}

// ---------------- 被测的客户端 ----------------

type Client = typeof import('../src/online/client');
let net: Client;
let state: typeof import('../src/app/state');

/** 时间流逝 s 秒：每秒推进服务端与客户端各一次；peer 照常发心跳 */
function advance(s: number, peer?: Peer) {
  for (let i = 0; i < s; i++) {
    T += 1;
    if (peer && i % 10 === 0) peer.send({ t: 'ping' });
    server.tick();
    net.update(T);
    pump();
  }
}

/** 客户端开好友房间，peer 加入，开局（客户端执黑） */
function startGame() {
  net.createRoom(0, 15, 0, true, 30);
  pump();
  expect(net.st.code).toMatch(/^\d{4}$/);
  const peer = new Peer(server);
  peer.send({ t: 'join', code: net.st.code });
  pump();
  expect(net.st.phase).toBe(net.Phase.Playing);
  expect(net.st.myColor).toBe(1);
  return peer;
}

beforeAll(async () => {
  const clock = await import('../src/core/clock');
  clock.setClock(() => T);
  net = await import('../src/online/client');
  state = await import('../src/app/state');
});

beforeEach(() => {
  net.disconnect();
  pump();
  server = newServer();
  netDown = false;
  dropTypes = [];
  sockets.length = 0;
  q.length = 0;
});

describe('联机客户端', () => {
  it('网络静默断开（服务端还没发现）：客户端察觉后自动重连，回到原来的对局', () => {
    const peer = startGame();
    net.move(7, 7);
    pump();
    expect(state.game.cur.moves).toBe(1);
    sockets[sockets.length - 1].dead = true; // 网络悄悄断了
    advance(24, peer);
    expect(net.st.reconnecting).toBe(false); // 还没到判定时间
    advance(6, peer); // 25 秒没有任何消息：主动断开并重连
    expect(net.st.reconnecting).toBe(false);
    expect(net.st.phase).toBe(net.Phase.Playing);
    expect(peer.inbox.some(m => m.t === 'peer' && m.online)).toBe(true);
    expect(state.game.cur.moves).toBe(1);
    peer.send({ t: 'move', x: 8, y: 8 });
    expect(state.game.cur.moves).toBe(2);
    expect(net.myTurn()).toBe(true);
  });

  it('服务器重启：重连后得知对局已不在，退出对局并提示', () => {
    startGame();
    state.screen.value = state.Screen.Game;
    const old = sockets[sockets.length - 1];
    server = newServer(); // 重启：旧连接全部断开
    old.fail();
    pump();
    expect(net.st.reconnecting).toBe(true);
    advance(3);
    expect(net.st.phase).toBe(net.Phase.Lobby);
    expect(net.st.notice[0][0]).toBe('这一局已经无法继续，可能是服务器重启过或掉线太久');
    expect(state.screen.value).toBe(state.Screen.Online);
  });

  it('老版本服务端不会说对局已不在：重连后等不到对局也会退出', () => {
    startGame();
    dropTypes = ['resumeFailed'];
    const old = sockets[sockets.length - 1];
    server = newServer();
    old.fail();
    advance(3);
    expect(net.st.phase).toBe(net.Phase.Playing); // 刚连上，还在等
    advance(4);
    expect(net.st.phase).toBe(net.Phase.Lobby);
  });

  it('断线期间对方认输：重连后看到结果', () => {
    const peer = startGame();
    sockets[sockets.length - 1].cut(); // 网络断开，两端都察觉到
    pump();
    expect(net.st.reconnecting).toBe(true);
    peer.send({ t: 'resign' });
    advance(3, peer);
    expect(net.st.over).toBe(true);
    expect(net.st.winner).toBe(1);
    expect(net.st.overReason).toBe('resign');
  });

  it('网络一直不通：宽限期过后判负，提示是自己掉线', () => {
    startGame();
    netDown = true;
    sockets[sockets.length - 1].cut();
    pump();
    advance(62);
    expect(net.st.over).toBe(true);
    expect(net.st.winner).toBe(2);
    expect(net.st.notice.map(m => m[0])).toContain('你掉线太久，对局已判负');
  });

  it('服务端告知新版本：比本机新才提示，并记在本地', () => {
    server = new RoomServer({ now: () => T, latest: '99.0.0', download: 'https://example.com/yi' });
    net.connect();
    pump();
    expect(net.st.update).toEqual({ version: '99.0.0', url: 'https://example.com/yi' });
    expect(JSON.parse(storage.get('yi.update')!).version).toBe('99.0.0');
    net.disconnect();
    server = new RoomServer({ now: () => T, latest: '0.0.1' });
    net.connect();
    pump();
    expect(net.st.update).toBeNull();
    expect(net.newerVersion('2.0.10', '2.0.9')).toBe(true);
    expect(net.newerVersion('2.0.1', '2.0.1')).toBe(false);
  });
});

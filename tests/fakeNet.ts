/**
 * 联机客户端测试的替身：浏览器环境（localStorage、document、桌面版日志）、假的 WebSocket（直接接到进程内的 RoomServer，假时钟），
 * 以及直接接在服务端上的另一位棋手。替身必须在导入客户端之前装好，所以客户端由 loadClient 在 beforeAll 中动态导入。
 */
import { expect } from 'vitest';
import { RoomServer, type Conn, type Session } from '../server/rooms';
import { PROTO_VERSION, type C2S, type S2C } from '../src/shared/protocol';
import { must } from './must';

// ---------------- 浏览器环境 ----------------

/** 本地存储的内容 */
export const storage = new Map<string, string>();
/** 写进桌面版日志文件的内容：[级别, 文字] */
export const logs: [string, string][] = [];
Object.assign(globalThis, {
  window: globalThis,
  location: { search: '' },
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, val: string) => {
      storage.set(key, val);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  },
  document: { hidden: false, title: '', addEventListener() {}, removeEventListener() {} },
  yiNative: {
    platform: 'test',
    quit() {},
    attention() {},
    openLogs() {},
    log: (level: string, text: string) => {
      logs.push([level, text]);
    },
  },
});

/** 写进日志的 warn 条目 */
export const warns = () => logs.filter(([level]) => level === 'warn').map(([, text]) => text);

// ---------------- 假的网络 ----------------

/** 假网络的可变状态 */
interface FakeState {
  /** 时钟（秒），客户端与服务端共用 */
  now: number;
  /** 当前的服务端；换一个新的即模拟服务器重启 */
  server: RoomServer;
  /** 网络完全不通：新连接一律失败 */
  netDown: boolean;
  /** 服务端发出的这些消息在路上丢掉（模拟老版本服务端或丢包） */
  dropTypes: string[];
}
export const newServer = () => new RoomServer({ now: () => fake.now, random: () => 0.3 });
export const fake: FakeState = { now: 1000, server: newServer(), netDown: false, dropTypes: [] };

const queue: (() => void)[] = [];
/** 把路上的消息与事件全部送达 */
export const pump = () => {
  for (let i = 0; i < 10000 && queue.length; i++) queue.shift()?.();
};
/** 连接异常断开（没有收到关闭帧）时浏览器给出的关闭码 */
const ABNORMAL = 1006;
/** 本端调用 close() 而没有给出关闭码时浏览器给出的关闭码 */
const NO_STATUS = 1005;
const OPEN = 1,
  CLOSED = 3;

class FakeWS {
  static CONNECTING = 0;
  static OPEN = OPEN;
  static CLOSING = 2;
  static CLOSED = CLOSED;
  readyState = 0;
  at = fake.now; // 发起这次连接的时刻
  dead = false; // 网络静默断开：两边的消息都到不了，也没有断开事件
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  private srv = fake.server;
  private sess: Session | null = null;
  private conn: Conn | null = null;
  constructor() {
    sockets.push(this);
    queue.push(() => (fake.netDown ? this.fail() : this.open()));
  }
  private open() {
    if (this.readyState !== 0) return;
    this.conn = {
      send: (m: S2C) => {
        if (!this.dead && !fake.dropTypes.includes(m.t))
          queue.push(() => {
            if (this.readyState === OPEN) this.onmessage?.({ data: JSON.stringify(m) });
          });
      },
      close: code => this.fail(code),
    };
    this.sess = this.srv.connect(this.conn);
    this.readyState = OPEN;
    this.onopen?.();
  }
  /** 连接被对端以关闭码 code 关掉；不带关闭码时为异常断开或连不上 */
  fail(code = ABNORMAL) {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    if (!this.dead) queue.push(() => this.onclose?.({ code }));
  }
  /** 网络断开，两端都察觉到；带 code 时模拟服务端以该关闭码断开这条连接 */
  cut(code?: number) {
    if (this.sess && this.conn) this.srv.disconnect(this.sess, this.conn);
    this.fail(code);
  }
  send(data: string) {
    if (this.dead || this.readyState !== OPEN) return;
    const m = JSON.parse(data);
    queue.push(() => {
      if (this.sess && this.conn) this.sess = this.srv.message(this.sess, m, this.conn);
    });
  }
  close() {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    if (!this.dead && this.sess && this.conn) {
      const sess = this.sess,
        conn = this.conn;
      queue.push(() => this.srv.disconnect(sess, conn));
    }
    queue.push(() => this.onclose?.({ code: NO_STATUS }));
  }
}
/** 客户端发起过的每一条连接，按先后排列 */
export const sockets: FakeWS[] = [];
Object.assign(globalThis, { WebSocket: FakeWS });

/** 客户端当前的连接 */
export const lastSocket = () => must(sockets.at(-1), '最近一次建立的连接');

/** 冒充服务端：不经服务端，直接往客户端当前的连接里送一帧（文本帧之外的取值模拟二进制帧） */
export function inject(data: unknown) {
  lastSocket().onmessage?.({ data: typeof data === 'string' || data instanceof ArrayBuffer ? data : JSON.stringify(data) });
}

/** 另一位棋手：直接接在服务端上 */
export class Peer {
  inbox: S2C[] = [];
  sess: Session;
  conn: Conn = {
    send: m => {
      this.inbox.push(m);
    },
    close: () => {},
  };
  /** token：带令牌重连，找回掉线的自己；uid：本机匿名身份，默认与客户端不同 */
  constructor(
    public srv: RoomServer = fake.server,
    token?: string,
    uid = 'peer-device-0000000001',
  ) {
    const sess = srv.connect(this.conn);
    expect(sess).not.toBeNull();
    this.sess = sess as Session;
    this.send({ t: 'hello', v: PROTO_VERSION, name: '乙', uid, token });
  }
  /** 收到的最后一条该类型的消息 */
  last<K extends S2C['t']>(type: K) {
    return this.inbox.filter((m): m is Extract<S2C, { t: K }> => m.t === type).at(-1);
  }
  /** 网络断开（服务端察觉到） */
  drop() {
    this.srv.disconnect(this.sess, this.conn);
  }
  send(m: C2S) {
    this.sess = this.srv.message(this.sess, m, this.conn);
    pump();
  }
}

// ---------------- 被测的客户端 ----------------

/** 被测的联机客户端模块 */
export type Client = typeof import('../src/online/client');
/** 界面与对局状态模块 */
export type State = typeof import('../src/app/state');
let net: Client;

/** 装好替身后导入客户端，并把它的时钟换成假时钟；在 beforeAll 中调用 */
export async function loadClient(): Promise<{ net: Client; state: State }> {
  const clock = await import('../src/core/clock');
  clock.setClock(() => fake.now);
  net = await import('../src/online/client');
  return { net, state: await import('../src/app/state') };
}

/** 每个测试开始前：断开客户端，换一个新的服务端，清空网络与日志；在 beforeEach 中调用 */
export function resetNet() {
  net.disconnect();
  pump();
  fake.server = newServer();
  fake.netDown = false;
  fake.dropTypes = [];
  sockets.length = 0;
  queue.length = 0;
  logs.length = 0;
  net.setRetryRandom(() => 0.5); // 重连间隔取退避上限的一半，测试结果与真实随机数无关（TST-020）
}

/** 时间流逝 secs 秒：每秒推进服务端与客户端各一次；peer 照常发心跳 */
export function advance(secs: number, peer?: Peer) {
  for (let i = 0; i < secs; i++) {
    fake.now += 1;
    if (peer && i % 10 === 0) peer.send({ t: 'ping' });
    fake.server.tick();
    net.update(fake.now);
    pump();
  }
}

/** 客户端开好友房间，peer 加入，开局（客户端执黑）；moveTime 为每步限时，0 为不限时 */
export function startGame(moveTime = 30) {
  net.createRoom(0, 15, 0, true, moveTime);
  pump();
  expect(net.st.code).toMatch(/^\d{4}$/);
  const peer = new Peer();
  peer.send({ t: 'join', code: net.st.code });
  pump();
  expect(net.st.phase).toBe(net.Phase.Playing);
  expect(net.st.myColor).toBe(1);
  return peer;
}

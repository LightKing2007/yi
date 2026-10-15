/** 联机服务端测试（tests/server*.test.ts）的公共部分：假连接的客户端、以假时钟驱动的服务端与开局的步骤 */
import { expect } from 'vitest';
import { MemoryStore, RoomServer, type Conn, type RoomServerOptions, type Session } from '../server/rooms';
import { PROTO_VERSION, type C2S, type S2C } from '../src/shared/protocol';
import { parseS2C } from '../src/shared/parse';

export type Msg<T extends S2C['t']> = Extract<S2C, { t: T }>;

/** 服务端发出的每条消息经 JSON 传输后都必须通过客户端的校验（API-016），否则客户端会把它丢掉 */
export function expectClientAccepts(m: S2C) {
  const wire = JSON.parse(JSON.stringify(m));
  expect(parseS2C(wire), m.t).toEqual(wire);
  return m;
}

let uidSeq = 0;
export const newUid = () => 'test-device-' + String(++uidSeq).padStart(8, '0');

/** 以假连接直接驱动 RoomServer 的客户端：收到的每条消息都检查能否通过客户端的校验，`expect` 按类型取出消息 */
export class Client {
  inbox: S2C[] = [];
  sess: Session;
  conn: Conn;
  id = 0;
  token = '';
  closed = false;
  closeCode?: number; // 服务端关闭这条连接时用的关闭码（直接切断时为 undefined）
  welcome?: Msg<'welcome'>;
  constructor(
    public srv: RoomServer,
    public name: string,
    token?: string,
    public uid = newUid(),
  ) {
    this.conn = {
      send: m => {
        expectClientAccepts(m); // 连接关闭后发出的消息也要检查
        if (!this.closed) this.inbox.push(m);
      },
      close: code => {
        this.closed = true;
        this.closeCode = code;
      },
    };
    this.sess = srv.connect(this.conn)!;
    this.send({ t: 'hello', v: PROTO_VERSION, name, uid, token });
    const w = (this.welcome = this.expect('welcome'));
    if (w) {
      this.id = w.id;
      this.token = w.token;
    }
  }
  send(m: C2S) {
    this.sess = this.srv.message(this.sess, m, this.conn);
  }
  /** 取出第一条该类型（且满足条件）的消息，连同它之前的消息一起丢掉 */
  expect<T extends S2C['t']>(t: T, where?: (m: Msg<T>) => boolean): Msg<T> | undefined {
    const i = this.inbox.findIndex(m => m.t === t && (!where || where(m as Msg<T>)));
    if (i < 0) return undefined;
    const m = this.inbox[i] as Msg<T>;
    this.inbox.splice(0, i + 1);
    return m;
  }
  has(t: S2C['t']) {
    return this.inbox.some(m => m.t === t);
  }
  drain() {
    this.inbox = [];
  }
  drop() {
    this.closed = true;
    this.srv.disconnect(this.sess, this.conn);
  }
  /** 网络断了但服务端还没发现：这条连接收不到消息，也不再发出任何消息 */
  silence() {
    this.closed = true;
  }
}

/** 一个以假时钟（从 1000 秒起）驱动的服务端：`advance` 让时间流逝并执行定时检查，`idle` 期间各客户端照常发心跳 */
export function world(store = new MemoryStore(), opt: RoomServerOptions = {}) {
  let t = 1000;
  const srv = new RoomServer({ now: () => t, random: () => 0.3, store, ...opt });
  const advance = (s: number) => {
    t += s;
    srv.tick();
  };
  /** 时间流逝，期间这些客户端照常每 10 秒发一次心跳 */
  const idle = (s: number, ...cs: Client[]) => {
    while (s > 0) {
      const d = Math.min(s, 10);
      cs.forEach(c => c.send({ t: 'ping' }));
      advance(d);
      s -= d;
    }
  };
  return { srv, advance, idle, store };
}

/** 按顺序落子，每一手双方都必须收到 `moved` */
export function play(a: Client, b: Client, seq: [Client, number, number][]) {
  for (const [who, x, y] of seq) {
    who.send({ t: 'move', x, y });
    expect(a.expect('moved')).toBeTruthy();
    expect(b.expect('moved')).toBeTruthy();
  }
}

/** 好友房间开一局：a 开房间，b 用房号加入 */
export function startGame(a: Client, b: Client, o: Partial<Extract<C2S, { t: 'create' }>> = {}) {
  a.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0, ...o });
  const code = a.expect('created')!.code;
  b.send({ t: 'join', code });
  return { code, sa: a.expect('start')!, sb: b.expect('start')! };
}

/** 两人进同一队列并都接受，返回双方的开局消息 */
export function matchUp(a: Client, b: Client, mode: 'match' | 'ranked' = 'match', type = 0) {
  a.send({ t: 'queue', mode, type, size: 19 });
  b.send({ t: 'queue', mode, type, size: 19 });
  a.send({ t: 'confirm', ok: true });
  b.send({ t: 'confirm', ok: true });
  return { sa: a.expect('start')!, sb: b.expect('start')! };
}

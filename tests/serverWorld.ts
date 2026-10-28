/** 联机服务端测试（tests/server*.test.ts）的公共部分：假连接的客户端、以假时钟驱动的服务端与开局的步骤 */
import { expect } from 'vitest';
import { MemoryStore, RoomServer, type Conn, type RatingStore, type RoomServerOptions, type Session } from '../server/rooms';
import { PROTO_VERSION, type C2S, type S2C } from '../src/shared/protocol';
import { parseS2C } from '../src/shared/parse';
import { must } from './must';

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
    this.sess = must(srv.connect(this.conn) ?? undefined, '服务端接受的连接');
    this.send({ t: 'hello', v: PROTO_VERSION, name, uid, token });
    const welcome = (this.welcome = this.expect('welcome'));
    if (welcome) {
      this.id = welcome.id;
      this.token = welcome.token;
    }
  }
  send(m: C2S) {
    this.sess = this.srv.message(this.sess, m, this.conn);
  }
  /** 取出第一条该类型（且满足条件）的消息，连同它之前的消息一起丢掉 */
  expect<T extends S2C['t']>(type: T, where?: (m: Msg<T>) => boolean): Msg<T> | undefined {
    const i = this.inbox.findIndex(m => m.t === type && (!where || where(m as Msg<T>)));
    if (i < 0) return undefined;
    const m = this.inbox[i] as Msg<T>;
    this.inbox.splice(0, i + 1);
    return m;
  }
  has(type: S2C['t']) {
    return this.inbox.some(m => m.t === type);
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
/** 从 ip 连上的客户端：连接带上真实地址，按 IP 的限制据此计数（host.ts 中由 clientIp 取得） */
export function clientAt(srv: RoomServer, name: string, ip: string) {
  const client = new Client(srv, name);
  Object.assign(client.conn, { ip });
  return client;
}

export function world(store: RatingStore = new MemoryStore(), opt: RoomServerOptions = {}) {
  let clock = 1000;
  const srv = new RoomServer({ now: () => clock, random: () => 0.3, store, ...opt });
  const advance = (secs: number) => {
    clock += secs;
    srv.tick();
  };
  /** 时间流逝，期间这些客户端照常每 10 秒发一次心跳 */
  const idle = (secs: number, ...cs: Client[]) => {
    while (secs > 0) {
      const step = Math.min(secs, 10);
      cs.forEach(client => client.send({ t: 'ping' }));
      advance(step);
      secs -= step;
    }
  };
  return { srv, advance, idle, store };
}

/** 按顺序落子，每一手双方都必须收到 `moved` */
export function play(first: Client, second: Client, seq: [Client, number, number][]) {
  for (const [who, x, y] of seq) {
    who.send({ t: 'move', x, y });
    expect(first.expect('moved')).toBeTruthy();
    expect(second.expect('moved')).toBeTruthy();
  }
}

/** 好友房间开一局：host 开房间，guest 用房号加入 */
export function startGame(host: Client, guest: Client, options: Partial<Extract<C2S, { t: 'create' }>> = {}) {
  host.send({ t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 0, ...options });
  const { code } = must(host.expect('created'), '开房间的回应');
  guest.send({ t: 'join', code });
  return { code, sa: must(host.expect('start'), '房主的开局消息'), sb: must(guest.expect('start'), '加入者的开局消息') };
}

/** 9 路围棋开一局（host 执黑）：黑子占满第 3 列、白子占满第 7 列，再在白地里落一颗孤零零的黑子 (7, 4)，留待点目时标为死子 */
export function startWithDeadStone(host: Client, guest: Client) {
  startGame(host, guest, { type: 1, size: 9 });
  for (let y = 0; y < 9; y++)
    play(host, guest, [
      [host, 2, y],
      [guest, 6, y],
    ]);
  play(host, guest, [[host, 7, 4]]);
}

/** 两人进同一队列并都接受，返回双方的开局消息 */
export function matchUp(first: Client, second: Client, mode: 'match' | 'ranked' = 'match', type = 0) {
  first.send({ t: 'queue', mode, type, size: 19 });
  second.send({ t: 'queue', mode, type, size: 19 });
  first.send({ t: 'confirm', ok: true });
  second.send({ t: 'confirm', ok: true });
  return { sa: must(first.expect('start'), '先进队列一方的开局消息'), sb: must(second.expect('start'), '后进队列一方的开局消息') };
}

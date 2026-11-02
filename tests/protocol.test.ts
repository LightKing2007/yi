/**
 * 联机协议：服务端入站消息的集中校验 parseC2S（API-010 至 API-015）、客户端入站消息的集中校验 parseS2C（API-016）。
 * 昵称清洗见 names.test.ts
 */
import { describe, expect, it } from 'vitest';
import { isInvalid, parseC2S, parseS2C } from '../src/shared/parse';
import { ACTS_MAX, PROTO_VERSION, type Act, type C2S, type S2C } from '../src/shared/protocol';

const UID = 'test-device-00000001';
/** 重连令牌的格式样例（32 位小写十六进制），不是真实令牌；已在 .gitleaks.toml 中登记为密钥扫描的例外 */
const TOKEN = '0123456789abcdef0123456789abcdef';

/** 每种消息一条合法的例子 */
const LEGAL: C2S[] = [
  { t: 'hello', v: PROTO_VERSION, auth: TOKEN },
  { t: 'hello', v: PROTO_VERSION, auth: TOKEN, resume: TOKEN },
  { t: 'ping' },
  { t: 'queue', mode: 'match', type: 1, size: 9 },
  { t: 'queue', mode: 'ranked', type: 0, size: 19 },
  { t: 'unqueue' },
  { t: 'confirm', ok: false },
  { t: 'create', type: 1, size: 13, hostColor: 2, renju: false, moveTime: 120 },
  { t: 'close' },
  { t: 'join', code: '0427' },
  { t: 'move', x: 0, y: 18, seq: 1, sv: 0 },
  { t: 'pass', seq: 2, sv: 1 },
  { t: 'undo', seq: 3, sv: 2 },
  { t: 'draw', seq: 4, sv: 3 },
  { t: 'rematch', seq: 5, sv: 4 },
  { t: 'reply', kind: 'rematch', ok: true, seq: 6, sv: 5 },
  { t: 'resign', seq: 7, sv: 6 },
  { t: 'mark', x: 3, y: 3, seq: 8, sv: 7 },
  { t: 'agree', seq: 9, sv: 8 },
  { t: 'resume', seq: 10, sv: 9 },
  { t: 'leave', seq: Number.MAX_SAFE_INTEGER, sv: Number.MAX_SAFE_INTEGER },
  { t: 'resync' },
];

/** 期望校验不通过，返回失败的种类 */
const kind = (raw: unknown) => {
  const r = parseC2S(raw);
  return isInvalid(r) ? r.invalid : 'ok';
};

describe('入站消息校验', () => {
  it('每种合法消息都原样通过', () => {
    for (const m of LEGAL) expect(parseC2S(m)).toEqual(m);
  });

  it('经 JSON 传输后同样通过，未知字段被丢弃', () => {
    const r = parseC2S(JSON.parse('{"t":"move","x":7,"y":7,"seq":1,"sv":0,"extra":1,"__proto__":{"t":"leave"}}'));
    expect(r).toEqual({ t: 'move', x: 7, y: 7, seq: 1, sv: 0 });
    expect(Object.keys(r)).toEqual(['t', 'x', 'y', 'seq', 'sv']);
  });

  it('顶层不是对象、类型未知或缺少类型时不通过', () => {
    for (const raw of [undefined, null, 7, 'ping', [], [{ t: 'ping' }], {}, { t: 7 }, { t: 'shout' }, { t: 'toString' }, { t: '__proto__' }]) {
      expect(kind(raw), JSON.stringify(raw)).toBe('format');
    }
  });

  it('数值为字符串、小数、负零、NaN、Infinity 或超出范围时不通过，严禁改成默认值', () => {
    for (const x of ['7', 1.5, -0, NaN, Infinity, -1, 19, null, true]) {
      expect(kind({ t: 'move', x, y: 0, seq: 1, sv: 0 }), String(x)).toBe('format');
      expect(kind({ t: 'mark', x: 0, y: x, seq: 1, sv: 0 }), String(x)).toBe('format');
    }
  });

  it('枚举与布尔字段取值不在规定范围内时不通过（API-012）', () => {
    const bad: unknown[] = [
      { t: 'queue', mode: 'casual', type: 0, size: 15 },
      { t: 'queue', mode: 'match', type: 2, size: 15 },
      { t: 'queue', mode: 'match', type: 0, size: 14 },
      { t: 'queue', mode: 'match', type: 0 },
      JSON.parse('{"t":"queue","mode":"match","type":-0,"size":15}'), // 负零不等于零（JSON 文本中的 -0 解析出来就是负零）
      { t: 'create', type: 0, size: 15, hostColor: 3, renju: true, moveTime: 0 },
      { t: 'create', type: 0, size: 15, hostColor: 0, renju: 1, moveTime: 0 },
      { t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 45 },
      { t: 'confirm', ok: 'yes' },
      { t: 'reply', kind: 'resign', ok: true, seq: 1, sv: 0 },
      { t: 'reply', kind: 'undo', seq: 1, sv: 0 },
    ];
    for (const m of bad) expect(kind(m), JSON.stringify(m)).toBe('format');
  });

  it('hello 的协议版本不同时报告版本不符，不再挑剔其余字段（旧版客户端的字段可能不同）', () => {
    expect(kind({ t: 'hello', v: PROTO_VERSION - 1 })).toBe('version');
    expect(kind({ t: 'hello', v: PROTO_VERSION + 1, name: 1, uid: '' })).toBe('version');
  });

  it('未知字段不超过 16 个时忽略，超过时不通过（API-011）', () => {
    const extra = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));
    expect(kind({ t: 'ping', ...extra(16) })).toBe('ok');
    expect(kind({ t: 'ping', ...extra(17) })).toBe('format');
  });
});

/** 一份段位 */
const RATING = { points: 1260, win: 3, loss: 1, draw: 0 };
/** 服务端每种消息一条合法的例子 */
const LEGAL_S2C: S2C[] = [
  { t: 'welcome', id: 7, resume: TOKEN, user: { publicId: '7KM4P9D2', name: '甲' }, ratings: { gomoku: RATING, go: RATING } },
  {
    t: 'welcome',
    id: 8,
    resume: TOKEN,
    user: { publicId: '00000001', name: '乙' },
    ratings: { gomoku: RATING, go: RATING },
    latest: '3.0.0',
    url: 'https://yi.lightking.com.cn/',
  },
  { t: 'resumeFailed' },
  { t: 'pong' },
  { t: 'queued', mode: 'ranked', type: 1, size: 19 },
  { t: 'found', opp: { name: '乙', points: 1200 }, secs: 15 },
  { t: 'found', opp: { name: '乙' }, secs: 15 },
  { t: 'accepted' },
  { t: 'unmatched', requeued: true, reason: 'match.unconfirmed' },
  { t: 'unmatched', requeued: false },
  { t: 'created', code: '0427' },
  { t: 'joinNo', code: 'room.not-found' },
  {
    t: 'start',
    kind: 'friend',
    color: 2,
    type: 1,
    size: 9,
    renju: false,
    moveTime: 120,
    black: { name: '甲' },
    white: { name: '乙' },
    match: 1,
    sv: 0,
  },
  { t: 'moved', x: 18, y: 0, sv: 1 },
  { t: 'passed', sv: 2 },
  { t: 'turn', color: 1, secs: 30 },
  { t: 'turn', color: 2, secs: -1 },
  { t: 'ask', kind: 'undo', from: 1, sv: 3 },
  { t: 'answer', kind: 'draw', from: 2, ok: false, sv: 4 },
  { t: 'undone', n: 2, sv: 5 },
  { t: 'marked', x: 3, y: 15, sv: 6 },
  { t: 'agreed', color: 1, sv: 7 },
  { t: 'resumed', sv: 8 },
  { t: 'over', winner: 3, reason: 'draw', sv: 9 },
  { t: 'over', winner: 3, reason: 'limit-moves', sv: 10 },
  { t: 'rated', type: 0, rating: RATING, delta: -16 },
  { t: 'peer', online: false, wait: 60 },
  { t: 'peer', online: true },
  { t: 'left' },
  {
    t: 'sync',
    acts: [{ k: 'M', x: 3, y: 3 }, { k: 'P' }, { k: 'U', n: 1 }, { k: 'K', x: 3, y: 3 }, { k: 'R' }],
    match: Number.MAX_SAFE_INTEGER,
    sv: 11,
    seq: 0,
  },
  { t: 'notice', code: 'server.maintenance' },
  { t: 'error', code: 'game.not-your-turn', level: 'E1' },
  { t: 'error', code: 'game.illegal-move', level: 'E1', params: { reject: 'ko' } },
  { t: 'error', code: 'rate.limited', level: 'E3', retryAfterMs: 3000 },
  { t: 'error', code: 'proto.version-mismatch', level: 'E4', params: { latest: '4.0.1', url: 'https://yi.lightking.com.cn/download/' } },
  { t: 'error', code: 'server.internal', level: 'E5', errorId: '0b6f1c52-9d4e-4f3a-8c21-5e7d9a0b1c2d' },
  { t: 'error', code: 'future.unknown-code', level: 'E2' },
];

/** 完整同步中除动作以外的字段（局编号、状态版本、已处理的请求序号） */
const SYNC = { match: 1, sv: 0, seq: 0 };

/** 期望服务端消息校验不通过，返回失败的种类 */
const kindS2C = (raw: unknown) => {
  const r = parseS2C(raw);
  return isInvalid(r) ? r.invalid : 'ok';
};

describe('服务端消息校验：结构', () => {
  it('每种合法消息都原样通过', () => {
    for (const m of LEGAL_S2C) expect(parseS2C(m), m.t).toEqual(m);
  });

  it('嵌套的对象与数组同样重建，未知字段被丢弃', () => {
    const r = parseS2C(
      JSON.parse(
        '{"t":"welcome","id":1,"resume":"' +
          TOKEN +
          '","user":{"publicId":"7KM4P9D2","name":"甲","extra":1},' +
          '"ratings":{"gomoku":{"points":1,"win":0,"loss":0,"draw":0,"x":1},"go":{"points":2,"win":0,"loss":0,"draw":0,"__proto__":{"points":9}}}}',
      ),
    );
    expect(r).toEqual({
      t: 'welcome',
      id: 1,
      resume: TOKEN,
      user: { publicId: '7KM4P9D2', name: '甲' },
      ratings: { gomoku: { points: 1, win: 0, loss: 0, draw: 0 }, go: { points: 2, win: 0, loss: 0, draw: 0 } },
    });
    const go = isInvalid(r) || r.t !== 'welcome' ? undefined : r.ratings.go;
    expect(Object.keys(go ?? {})).toEqual(['points', 'win', 'loss', 'draw']);
    expect(Object.getPrototypeOf(go)).toBe(Object.prototype);
    const sync = parseS2C(JSON.parse('{"t":"sync","acts":[{"k":"M","x":1,"y":2,"extra":true}],"match":1,"sv":0,"seq":0}'));
    expect(sync).toEqual({ t: 'sync', acts: [{ k: 'M', x: 1, y: 2 }], ...SYNC });
  });

  it('错误消息：级别须为 E1 至 E5，错误码须为两段式，附加参数有个数与取值的限制', () => {
    const many = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${'a'.repeat(i + 1)}`, i]));
    for (const raw of [
      { t: 'error', code: 'game.not-your-turn', level: 'E9' },
      { t: 'error', code: 'game.not-your-turn' },
      { t: 'error', code: 'game', level: 'E1' },
      { t: 'error', code: 'game.illegal-move', level: 'E1', params: many },
      { t: 'error', code: 'game.illegal-move', level: 'E1', params: { reject: { nested: true } } },
      { t: 'error', code: 'game.illegal-move', level: 'E1', params: { Reject: 'ko' } },
      { t: 'error', text: '服务器繁忙，请稍后再试' },
      { t: 'info', text: '还没轮到你' },
    ]) {
      expect(kindS2C(raw), JSON.stringify(raw)).toBe('format');
    }
  });

  it('顶层不是对象、类型未知或缺少类型时不通过（新版服务端的新消息也按此丢弃）', () => {
    for (const raw of [undefined, null, 7, 'pong', [], [{ t: 'pong' }], {}, { t: 7 }, { t: 'shout' }, { t: 'toString' }, { t: '__proto__' }]) {
      expect(kindS2C(raw), JSON.stringify(raw)).toBe('format');
    }
  });

  it('未知字段不超过 16 个时忽略，超过时不通过（与 API-011 一致）', () => {
    const extra = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, i]));
    expect(kindS2C({ t: 'pong', ...extra(16) })).toBe('ok');
    expect(kindS2C({ t: 'pong', ...extra(17) })).toBe('format');
    expect(kindS2C({ t: 'found', opp: { name: '乙', ...extra(17) }, secs: 15 })).toBe('format');
  });
});

describe('服务端消息校验：次数、路数、坐标、秒数与数组长度都有上限（A-05）', () => {
  it('伪造的悔棋次数不通过：一次最多退两手，客户端不会因此循环十亿次（A-05）', () => {
    for (const n of [3, 1e9, -1, 1.5, NaN, '1', null]) {
      expect(kindS2C({ t: 'undone', n, sv: 1 }), String(n)).toBe('format');
      expect(kindS2C({ t: 'sync', acts: [{ k: 'U', n }], ...SYNC }), String(n)).toBe('format');
    }
  });

  it('路数与坐标超出棋盘时不通过，棋盘数组不会越界（A-05）', () => {
    const start = LEGAL_S2C.find(m => m.t === 'start');
    for (const size of [0, 8, 14, 20, 25, 99, -19]) expect(kindS2C({ ...start, size }), String(size)).toBe('format');
    for (const t of ['moved', 'marked']) {
      for (const x of [19, -1, 1e9, 2.5, -0]) {
        expect(kindS2C({ t, x, y: 0, sv: 1 }), `${t} ${x}`).toBe('format');
        expect(kindS2C({ t, x: 0, y: x, sv: 1 }), `${t} ${x}`).toBe('format');
      }
    }
    expect(kindS2C({ t: 'sync', acts: [{ k: 'M', x: 19, y: 0 }], ...SYNC })).toBe('format');
    expect(kindS2C({ t: 'sync', acts: [{ k: 'K', x: 0, y: -1 }], ...SYNC })).toBe('format');
  });

  it('回放的动作超过上限、类型未知或不是数组时不通过（A-05）', () => {
    const passes = (n: number): Act[] => Array.from({ length: n }, () => ({ k: 'P' }));
    expect(kindS2C({ t: 'sync', acts: passes(ACTS_MAX), ...SYNC })).toBe('ok');
    expect(kindS2C({ t: 'sync', acts: passes(ACTS_MAX + 1), ...SYNC })).toBe('format');
    for (const acts of [{ length: 1, 0: { k: 'P' } }, 'P', null, [{ k: 'X' }], [{ k: 'toString' }], [null], [[{ k: 'P' }]]]) {
      expect(kindS2C({ t: 'sync', acts, ...SYNC }), JSON.stringify(acts)).toBe('format');
    }
  });

  it('计时与等待的秒数超出上限时不通过，不会算出离谱的截止时刻', () => {
    expect(kindS2C({ t: 'turn', color: 1, secs: -2 })).toBe('ok'); // 超时判定前重连可能算出 -2，按不限时显示
    for (const secs of [1e9, -1e9, Infinity, 0.5]) {
      expect(kindS2C({ t: 'turn', color: 1, secs }), String(secs)).toBe('format');
      expect(kindS2C({ t: 'found', opp: { name: '乙' }, secs }), String(secs)).toBe('format');
      expect(kindS2C({ t: 'peer', online: false, wait: secs }), String(secs)).toBe('format');
    }
    expect(kindS2C({ t: 'found', opp: { name: '乙' }, secs: -1 })).toBe('format');
  });
});

describe('服务端消息校验：枚举、文字与下载地址', () => {
  it('枚举、执子方、段位取值不合法时不通过', () => {
    const start = LEGAL_S2C.find(m => m.t === 'start');
    const bad: unknown[] = [
      { ...start, kind: 'casual' },
      { ...start, color: 0 },
      { ...start, color: 3 },
      { ...start, moveTime: 45 },
      { ...start, renju: 'yes' },
      { ...start, black: { name: 7 } },
      { ...start, white: { name: '乙', points: -1 } },
      { ...start, white: undefined },
      { t: 'over', winner: 0, reason: 'five', sv: 1 },
      { t: 'over', winner: 4, reason: 'five', sv: 1 },
      { t: 'over', winner: 1, reason: 'boom', sv: 1 },
      { t: 'over', winner: 1, reason: 'toString', sv: 1 },
      { t: 'ask', kind: 'resign', from: 1, sv: 1 },
      { t: 'ask', kind: 'undo', from: 0, sv: 1 },
      { t: 'answer', kind: 'undo', from: 3, ok: true, sv: 1 },
      { t: 'agreed', color: 3, sv: 1 },
      { t: 'queued', mode: 'casual', type: 0, size: 15 },
      { t: 'rated', type: 0, rating: { ...RATING, points: 1.5 }, delta: 0 },
      { t: 'rated', type: 0, rating: { ...RATING, win: undefined }, delta: 0 },
      { t: 'rated', type: 0, rating: RATING, delta: 0.5 },
      { t: 'welcome', id: 0, token: TOKEN, ratings: { gomoku: RATING, go: RATING } },
      { t: 'welcome', id: 1, token: TOKEN.toUpperCase(), ratings: { gomoku: RATING, go: RATING } },
      { t: 'welcome', id: 1, token: TOKEN, ratings: { gomoku: RATING } },
      { t: 'created', code: '12345' },
    ];
    for (const m of bad) expect(kindS2C(m), JSON.stringify(m)).toBe('format');
  });

  it('局编号、状态版本与请求序号须为范围内的整数；推进版本的消息缺少版本时不通过（protocol-v4.md 第 7 章）', () => {
    const start = LEGAL_S2C.find(m => m.t === 'start');
    for (const bad of [-1, 1.5, '1', null, Number.MAX_SAFE_INTEGER + 2]) {
      expect(kindS2C({ ...start, sv: bad }), `start.sv ${String(bad)}`).toBe('format');
      expect(kindS2C({ t: 'moved', x: 0, y: 0, sv: bad }), `moved.sv ${String(bad)}`).toBe('format');
      expect(kindS2C({ t: 'sync', acts: [], ...SYNC, seq: bad }), `sync.seq ${String(bad)}`).toBe('format');
      expect(kind({ t: 'pass', seq: 1, sv: bad }), `pass.sv ${String(bad)}`).toBe('format');
      expect(kind({ t: 'pass', seq: bad, sv: 0 }), `pass.seq ${String(bad)}`).toBe('format');
    }
    expect(kindS2C({ ...start, match: 0 })).toBe('format');
    expect(kindS2C({ t: 'sync', acts: [], ...SYNC, match: 0 })).toBe('format');
    expect(kind({ t: 'pass', seq: 0, sv: 0 })).toBe('format'); // 请求序号从 1 开始
    /** 去掉一个字段的副本 */
    const without = (m: object, key: string) => Object.fromEntries(Object.entries(m).filter(([field]) => field !== key));
    for (const m of LEGAL_S2C.filter(msg => 'sv' in msg)) expect(kindS2C(without(m, 'sv')), `${m.t} 缺少 sv`).toBe('format');
    for (const m of LEGAL.filter(msg => 'seq' in msg)) expect(kind(without(m, 'seq')), `${m.t} 缺少 seq`).toBe('format');
  });
});

describe('入站消息校验：握手与房号（API-013）', () => {
  it('房号、登录令牌、重连令牌不合格式时不通过；第 4 版不再接受昵称、uid 与改名（API-013，protocol-v4.md 第 3.1 条）', () => {
    const hello = { t: 'hello', v: PROTO_VERSION, auth: TOKEN };
    const bad: unknown[] = [
      { t: 'join', code: '12a4' },
      { t: 'join', code: '123' },
      { t: 'join', code: '12345' },
      { t: 'join', code: 1234 },
      { t: 'hello', v: PROTO_VERSION },
      { t: 'hello', v: PROTO_VERSION, name: '甲', uid: UID },
      { ...hello, auth: '' },
      { ...hello, auth: TOKEN.toUpperCase() },
      { ...hello, auth: TOKEN + '0' },
      { ...hello, resume: '' },
      { ...hello, resume: TOKEN.toUpperCase() },
      { ...hello, resume: TOKEN + '0' },
      { t: 'name', name: '乙' },
      { ...hello, v: 0 },
      { ...hello, v: 100 },
      { ...hello, v: '3' },
    ];
    for (const m of bad) expect(kind(m), JSON.stringify(m)).toBe('format');
  });
});

describe('服务端消息校验：文字、名字、版本号与下载地址', () => {
  it('提示文字、昵称、版本号、下载地址与错误编号过长或格式不对时不通过：下载地址只接受 http(s)，错误编号只接受小写的 UUID v4', () => {
    const welcome = LEGAL_S2C[0];
    const long = '字'.repeat(10000);
    const bad: unknown[] = [
      { t: 'info', text: long },
      { t: 'error', text: long },
      { t: 'joinNo', reason: long },
      { t: 'unmatched', requeued: true, reason: long },
      { t: 'found', opp: { name: long }, secs: 15 },
      { t: 'info', text: 7 },
      { ...welcome, url: 'javascript:alert(1)' },
      { ...welcome, url: 'file:///etc/passwd' },
      { ...welcome, url: 'http://a b' },
      { ...welcome, url: 'https://' },
      { ...welcome, url: 'https://x/' + 'a'.repeat(4096) },
      { ...welcome, latest: '<b>9.9.9</b>' },
      { ...welcome, latest: '9'.repeat(33) },
      { ...welcome, latest: 3 },
      { ...welcome, user: { publicId: '7km4p9d2', name: '甲' } },
      { ...welcome, user: { publicId: '7KM4P9DI', name: '甲' } },
      { ...welcome, user: { publicId: '7KM4P9D', name: '甲' } },
      { ...welcome, user: { publicId: '7KM4P9D2', name: long } },
      { ...welcome, user: { publicId: '7KM4P9D2' } },
      { ...welcome, token: TOKEN, resume: undefined },
      { t: 'error', text: '服务器出现问题，请稍后再试', errorId: '0B6F1C52-9D4E-4F3A-8C21-5E7D9A0B1C2D' },
      { t: 'error', text: '服务器出现问题，请稍后再试', errorId: '0b6f1c52-9d4e-1f3a-8c21-5e7d9a0b1c2d' },
      { t: 'error', text: '服务器出现问题，请稍后再试', errorId: '<script>' },
    ];
    for (const m of bad) expect(kindS2C(m), JSON.stringify(m).slice(0, 80)).toBe('format');
    expect(kindS2C({ ...welcome, url: 'https://yi.lightking.com.cn/' })).toBe('ok');
  });
});

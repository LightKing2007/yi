/**
 * 联机协议：服务端入站消息的集中校验 parseC2S（API-010 至 API-015）、客户端入站消息的集中校验 parseS2C（API-016），
 * 昵称清洗 cleanName 与按字素截断 clipName（API-014、I18N-030）
 */
import { describe, expect, it } from 'vitest';
import { isInvalid, parseC2S, parseS2C } from '../src/shared/parse';
import { ACTS_MAX, NAME_MAX, PROTO_VERSION, clipName, cleanName, type Act, type C2S, type S2C } from '../src/shared/protocol';

const UID = 'test-device-00000001';
/** 重连令牌的格式样例（32 位小写十六进制），不是真实令牌；已在 .gitleaks.toml 中登记为密钥扫描的例外 */
const TOKEN = '0123456789abcdef0123456789abcdef';

/** 每种消息一条合法的例子 */
const LEGAL: C2S[] = [
  { t: 'hello', v: PROTO_VERSION, name: '甲', uid: UID },
  { t: 'hello', v: PROTO_VERSION, name: '', uid: UID, token: TOKEN },
  { t: 'ping' },
  { t: 'name', name: '乙' },
  { t: 'queue', mode: 'match', type: 1, size: 9 },
  { t: 'queue', mode: 'ranked', type: 0, size: 19 },
  { t: 'unqueue' },
  { t: 'confirm', ok: false },
  { t: 'create', type: 1, size: 13, hostColor: 2, renju: false, moveTime: 120 },
  { t: 'close' },
  { t: 'join', code: '0427' },
  { t: 'move', x: 0, y: 18 },
  { t: 'pass' },
  { t: 'undo' },
  { t: 'draw' },
  { t: 'rematch' },
  { t: 'reply', kind: 'rematch', ok: true },
  { t: 'resign' },
  { t: 'mark', x: 3, y: 3 },
  { t: 'agree' },
  { t: 'resume' },
  { t: 'leave' },
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
    const r = parseC2S(JSON.parse('{"t":"move","x":7,"y":7,"extra":1,"__proto__":{"t":"leave"}}'));
    expect(r).toEqual({ t: 'move', x: 7, y: 7 });
    expect(Object.keys(r)).toEqual(['t', 'x', 'y']);
  });

  it('顶层不是对象、类型未知或缺少类型时不通过', () => {
    for (const raw of [undefined, null, 7, 'ping', [], [{ t: 'ping' }], {}, { t: 7 }, { t: 'shout' }, { t: 'toString' }, { t: '__proto__' }]) {
      expect(kind(raw), JSON.stringify(raw)).toBe('format');
    }
  });

  it('数值为字符串、小数、负零、NaN、Infinity 或超出范围时不通过，严禁改成默认值', () => {
    for (const x of ['7', 1.5, -0, NaN, Infinity, -1, 19, null, true]) {
      expect(kind({ t: 'move', x, y: 0 }), String(x)).toBe('format');
      expect(kind({ t: 'mark', x: 0, y: x }), String(x)).toBe('format');
    }
  });

  it('枚举与布尔字段取值不在规定范围内时不通过（API-012）', () => {
    const bad: unknown[] = [
      { t: 'queue', mode: 'casual', type: 0, size: 15 },
      { t: 'queue', mode: 'match', type: 2, size: 15 },
      { t: 'queue', mode: 'match', type: 0, size: 14 },
      { t: 'queue', mode: 'match', type: 0 },
      { t: 'create', type: 0, size: 15, hostColor: 3, renju: true, moveTime: 0 },
      { t: 'create', type: 0, size: 15, hostColor: 0, renju: 1, moveTime: 0 },
      { t: 'create', type: 0, size: 15, hostColor: 0, renju: true, moveTime: 45 },
      { t: 'confirm', ok: 'yes' },
      { t: 'reply', kind: 'resign', ok: true },
      { t: 'reply', kind: 'undo' },
    ];
    for (const m of bad) expect(kind(m), JSON.stringify(m)).toBe('format');
  });

  it('房号、uid、令牌不合格式，或昵称原文过长时不通过（API-013）', () => {
    const hello = { t: 'hello', v: PROTO_VERSION, name: '甲', uid: UID };
    const bad: unknown[] = [
      { t: 'join', code: '12a4' },
      { t: 'join', code: '123' },
      { t: 'join', code: '12345' },
      { t: 'join', code: 1234 },
      { ...hello, uid: '' },
      { ...hello, uid: 'short' },
      { ...hello, uid: 'x'.repeat(65) },
      { ...hello, uid: 'has space in it!!' },
      { ...hello, token: '' },
      { ...hello, token: TOKEN.toUpperCase() },
      { ...hello, token: TOKEN + '0' },
      { ...hello, name: 7 },
      { ...hello, name: '名'.repeat(257) },
      { t: 'name', name: null },
      { ...hello, v: 0 },
      { ...hello, v: 100 },
      { ...hello, v: '3' },
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
  { t: 'welcome', id: 7, token: TOKEN, ratings: { gomoku: RATING, go: RATING } },
  { t: 'welcome', id: 8, token: TOKEN, ratings: { gomoku: RATING, go: RATING }, latest: '2.0.5', url: 'http://47.108.181.240:8443/' },
  { t: 'resumeFailed' },
  { t: 'pong' },
  { t: 'queued', mode: 'ranked', type: 1, size: 19 },
  { t: 'found', opp: { name: '乙', points: 1200 }, secs: 15 },
  { t: 'found', opp: { name: '乙' }, secs: 15 },
  { t: 'accepted' },
  { t: 'unmatched', requeued: true, reason: '对方没有及时确认' },
  { t: 'unmatched', requeued: false, reason: '' },
  { t: 'created', code: '0427' },
  { t: 'joinNo', reason: '房号不存在，或房间已经开始' },
  { t: 'start', kind: 'friend', color: 2, type: 1, size: 9, renju: false, moveTime: 120, black: { name: '甲' }, white: { name: '乙' } },
  { t: 'moved', x: 18, y: 0 },
  { t: 'passed' },
  { t: 'turn', color: 1, secs: 30 },
  { t: 'turn', color: 2, secs: -1 },
  { t: 'ask', kind: 'undo' },
  { t: 'answer', kind: 'draw', ok: false },
  { t: 'undone', n: 2 },
  { t: 'marked', x: 3, y: 15 },
  { t: 'agreed', color: 1 },
  { t: 'resumed' },
  { t: 'over', winner: 3, reason: 'draw' },
  { t: 'rated', type: 0, rating: RATING, delta: -16 },
  { t: 'peer', online: false, wait: 60 },
  { t: 'peer', online: true },
  { t: 'left' },
  { t: 'sync', acts: [{ k: 'M', x: 3, y: 3 }, { k: 'P' }, { k: 'U', n: 1 }, { k: 'K', x: 3, y: 3 }, { k: 'R' }] },
  { t: 'info', text: '还没轮到你' },
  { t: 'error', text: '服务器繁忙，请稍后再试' },
];

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
        '{"t":"welcome","id":1,"token":"' +
          TOKEN +
          '","ratings":{"gomoku":{"points":1,"win":0,"loss":0,"draw":0,"x":1},"go":{"points":2,"win":0,"loss":0,"draw":0,"__proto__":{"points":9}}}}',
      ),
    );
    expect(r).toEqual({
      t: 'welcome',
      id: 1,
      token: TOKEN,
      ratings: { gomoku: { points: 1, win: 0, loss: 0, draw: 0 }, go: { points: 2, win: 0, loss: 0, draw: 0 } },
    });
    const go = isInvalid(r) || r.t !== 'welcome' ? undefined : r.ratings.go;
    expect(Object.keys(go ?? {})).toEqual(['points', 'win', 'loss', 'draw']);
    expect(Object.getPrototypeOf(go)).toBe(Object.prototype);
    const sync = parseS2C(JSON.parse('{"t":"sync","acts":[{"k":"M","x":1,"y":2,"extra":true}]}'));
    expect(sync).toEqual({ t: 'sync', acts: [{ k: 'M', x: 1, y: 2 }] });
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
      expect(kindS2C({ t: 'undone', n }), String(n)).toBe('format');
      expect(kindS2C({ t: 'sync', acts: [{ k: 'U', n }] }), String(n)).toBe('format');
    }
  });

  it('路数与坐标超出棋盘时不通过，棋盘数组不会越界（A-05）', () => {
    const start = LEGAL_S2C.find(m => m.t === 'start');
    for (const size of [0, 8, 14, 20, 25, 99, -19]) expect(kindS2C({ ...start, size }), String(size)).toBe('format');
    for (const t of ['moved', 'marked']) {
      for (const x of [19, -1, 1e9, 2.5, -0]) {
        expect(kindS2C({ t, x, y: 0 }), `${t} ${x}`).toBe('format');
        expect(kindS2C({ t, x: 0, y: x }), `${t} ${x}`).toBe('format');
      }
    }
    expect(kindS2C({ t: 'sync', acts: [{ k: 'M', x: 19, y: 0 }] })).toBe('format');
    expect(kindS2C({ t: 'sync', acts: [{ k: 'K', x: 0, y: -1 }] })).toBe('format');
  });

  it('回放的动作超过上限、类型未知或不是数组时不通过（A-05）', () => {
    const passes = (n: number): Act[] => Array.from({ length: n }, () => ({ k: 'P' }));
    expect(kindS2C({ t: 'sync', acts: passes(ACTS_MAX) })).toBe('ok');
    expect(kindS2C({ t: 'sync', acts: passes(ACTS_MAX + 1) })).toBe('format');
    for (const acts of [{ length: 1, 0: { k: 'P' } }, 'P', null, [{ k: 'X' }], [{ k: 'toString' }], [null], [[{ k: 'P' }]]]) {
      expect(kindS2C({ t: 'sync', acts }), JSON.stringify(acts)).toBe('format');
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
      { t: 'over', winner: 0, reason: 'five' },
      { t: 'over', winner: 4, reason: 'five' },
      { t: 'over', winner: 1, reason: 'boom' },
      { t: 'over', winner: 1, reason: 'toString' },
      { t: 'ask', kind: 'resign' },
      { t: 'agreed', color: 3 },
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

  it('提示文字、昵称、版本号与下载地址过长或格式不对时不通过：下载地址只接受 http(s)', () => {
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
    ];
    for (const m of bad) expect(kindS2C(m), JSON.stringify(m).slice(0, 80)).toBe('format');
    expect(kindS2C({ ...welcome, url: 'https://yi.lightking.com.cn/' })).toBe('ok');
  });
});

describe('昵称清洗', () => {
  it('删除双向控制符、零宽字符与控制字符，合并空白（API-014）', () => {
    expect(cleanName('abc‮gpj.exe', '棋手')).toBe('abcgpj.exe');
    expect(cleanName('甲​乙‍丙﻿', '棋手')).toBe('甲乙丙');
    expect(cleanName('\n\t张 　  三 ', '棋手')).toBe('张 三');
    expect(cleanName('私用\uD800', '棋手')).toBe('私用');
  });

  it('先做 NFC 规范化：组合写法与预组写法得到同一个昵称', () => {
    expect(cleanName('Amélie', '棋手')).toBe('Amélie');
    expect(cleanName('Amélie', '棋手')).toBe(cleanName('Amélie', '棋手'));
  });

  it('按字素截到 16 个：带肤色的表情、国旗与组合字符不被拆开（I18N-030）', () => {
    const thumb = '👍🏽',
      flag = '🇨🇳',
      e = 'é̂'; // e 加两个组合附加符号：一个字素
    expect(cleanName((thumb + flag + e).repeat(10), '棋手')).toBe((thumb + flag + e.normalize('NFC')).repeat(5) + thumb);
    expect(cleanName('一二三四五六七八九十一二三四五六七八', '棋手')).toBe('一二三四五六七八九十一二三四五六');
  });

  it('零宽连接符按 API-014 删除：以它连成的组合表情拆为各自的表情，再按字素计数', () => {
    expect(cleanName('👨‍👩‍👧', '棋手')).toBe('👨👩👧');
    expect(cleanName('👨‍👩‍👧'.repeat(6), '棋手')).toBe('👨👩👧'.repeat(5) + '👨');
  });

  it('不是字符串，或清洗后为空时使用默认昵称', () => {
    for (const s of [undefined, null, 7, {}, '', '   ', '​‮\n']) expect(cleanName(s, '棋手')).toBe('棋手');
  });

  it('输入框按字素截断时保留空白，便于继续输入', () => {
    expect(clipName('张 ')).toBe('张 ');
    expect(clipName('🇨🇳'.repeat(20))).toBe('🇨🇳'.repeat(NAME_MAX));
  });
});

/** 联机协议：入站消息的集中校验 parseC2S（API-010 至 API-015）、昵称清洗 cleanName 与按字素截断 clipName（API-014、I18N-030） */
import { describe, expect, it } from 'vitest';
import { isInvalid, parseC2S } from '../src/shared/parse';
import { NAME_MAX, PROTO_VERSION, clipName, cleanName, type C2S } from '../src/shared/protocol';

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

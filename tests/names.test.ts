/** 昵称清洗 cleanName 与按字素截断 clipName（API-014、I18N-030；自 protocol.test.ts 移出） */
import { describe, expect, it } from 'vitest';
import { NAME_MAX, clipName, cleanName } from '../src/shared/protocol';

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

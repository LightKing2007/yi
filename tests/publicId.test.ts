/** 公开 UID 的固定答案、录入错误与随机源边界；不依赖时钟和执行速度。 */
import { expect, it } from 'vitest';
import { checkedPublicId, displayPublicId, parsePublicId, PUBLIC_ID_ALPHABET } from '../src/shared/publicId';
import { newPublicId } from '../server/publicId';

it('校验位符合独立答案并接受大小写及分组显示', () => {
  // 独立 Python 累加校验得到末位 2；完整示例的全部 248 种单字符替换均被拒绝。
  expect(checkedPublicId('7KM4P9D')).toBe('7KM4P9D2');
  expect(checkedPublicId('0000000')).toBe('00000000');
  expect(parsePublicId('7km4-p9d2')).toBe('7KM4P9D2');
  expect(parsePublicId('7KM4P9D2')).toBe('7KM4P9D2');
  expect(displayPublicId('7km4p9d2')).toBe('7KM4-P9D2');
});

it('拒绝错误长度、混淆字符、校验码和任意非规范分隔符', () => {
  for (const input of [
    null,
    12345678,
    '',
    '7KM4P9D',
    '7KM4P9D22',
    '7KM4P9D3',
    '7KM4 P9D2',
    '7KM4--P9D2',
    '7KM4P9D2\n',
    '7KM4P9DO',
    '7KM4P9DI',
    '7KM4P9DL',
    '7ＫＭ4P9D2',
  ]) {
    expect(parsePublicId(input)).toBeNull();
  }
  expect(displayPublicId('7KM4P9D3')).toBeNull();
  expect(() => checkedPublicId('7km4p9d')).toThrow('public-id-data-invalid');
  expect(() => checkedPublicId('7KM4P9D2')).toThrow('public-id-data-invalid');
});

it('固定 UID 的每一种单字符替换都无法通过校验', () => {
  const valid = '7KM4P9D2';
  let rejected = 0;
  for (let i = 0; i < valid.length; i++) {
    for (const character of PUBLIC_ID_ALPHABET) {
      if (character === valid[i]) continue;
      expect(parsePublicId(valid.slice(0, i) + character + valid.slice(i + 1))).toBeNull();
      rejected++;
    }
  }
  expect(rejected).toBe(248);
});

it('服务端按随机字节生成七位数据并添加校验位，错误随机长度拒绝', () => {
  expect(newPublicId(() => Uint8Array.from([7, 19, 20, 4, 22, 9, 13]))).toBe('7KM4P9D2');
  expect(newPublicId(() => Uint8Array.from([39, 51, 52, 36, 54, 41, 45]))).toBe('7KM4P9D2');
  expect(() => newPublicId(() => new Uint8Array(6))).toThrow('public-id-random-invalid');
  expect(() => newPublicId(() => new Uint8Array(8))).toThrow('public-id-random-invalid');
  expect(parsePublicId(newPublicId())).not.toBeNull();
});

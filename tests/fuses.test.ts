/** Electron Fuses 的核对（scripts/check-fuses.mjs，SEC-033）：从二进制读出开关序列、与配置比对；package.json 的配置满足 SEC-033 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FUSE_INDEX, compareFuses, fuseBinary, readFuses } from '../scripts/check-fuses.mjs';

const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX';
/** 构造含开关序列的二进制：前后各有无关的字节；states 为 '0'、'1'、'r' 组成的串 */
const binary = (states: string) =>
  Buffer.concat([Buffer.from('padding\0\x01'), Buffer.from(SENTINEL), Buffer.from([1, states.length]), Buffer.from(states), Buffer.from('\0tail')]);

describe('读出开关序列', () => {
  it('标记串之后依次为版本号、个数与各开关', () => {
    expect(readFuses(binary('01r1'))).toEqual([48, 49, 114, 49]);
  });
  it('没有标记串时抛出', () => {
    expect(() => readFuses(Buffer.from('no fuses here'))).toThrow('没有 Fuses 的标记串');
  });
});

describe('与配置比对', () => {
  it('逐项比对开与关；已移除或不存在的开关判为不符；表外的配置项忽略', () => {
    const fuses = readFuses(binary('0001r'));
    expect(compareFuses({ runAsNode: false, enableNodeCliInspectArguments: true, onlyLoadAppFromAsar: true, resetAdHocDarwinSignature: true }, fuses)).toEqual([
      ['runAsNode', '关', '关', true],
      ['enableNodeCliInspectArguments', '开', '开', true],
      ['onlyLoadAppFromAsar', '开', '无', false],
    ]);
    expect(compareFuses({ enableEmbeddedAsarIntegrityValidation: true }, fuses)).toEqual([['enableEmbeddedAsarIntegrityValidation', '开', '已移除', false]]);
  });
  it('位置与 @electron/fuses 的 FuseV1Options 一致', () => {
    expect(FUSE_INDEX).toEqual({
      runAsNode: 0,
      enableCookieEncryption: 1,
      enableNodeOptionsEnvironmentVariable: 2,
      enableNodeCliInspectArguments: 3,
      enableEmbeddedAsarIntegrityValidation: 4,
      onlyLoadAppFromAsar: 5,
      loadBrowserProcessSpecificV8Snapshot: 6,
      grantFileProtocolExtraPrivileges: 7,
    });
  });
});

describe('含开关序列的二进制', () => {
  it('macOS 为 .app 中的 Electron Framework，其他平台为可执行文件本身', () => {
    expect(fuseBinary('/x/弈.app')).toBe(path.join('/x/弈.app', 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework'));
    expect(fuseBinary('/x/弈.exe')).toBe('/x/弈.exe');
  });
});

describe('package.json 的配置（SEC-033）', () => {
  it('关闭 RunAsNode、NODE_OPTIONS 与 --inspect，开启 asar 完整性校验与只从 asar 加载', () => {
    const config = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8')).build.electronFuses;
    expect(config).toMatchObject({
      runAsNode: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
    });
  });
});

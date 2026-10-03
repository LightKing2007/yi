/**
 * 服务端告知的新版本在本地的记录（src/online/client.ts 的 yi.update；DAT-080）：带版本号、逐字段校验，旧格式迁移。
 * 记录在客户端模块加载时读取，所以每个测试先放好本地存储，再重新加载客户端（替身见 fakeNet.ts）
 */
import { describe, expect, it, vi } from 'vitest';
import { loadClient, logs, storage, warns } from './fakeNet';

/** 放好本地存储中的记录后重新加载客户端，返回读出的新版本 */
async function updateAfterLoad(raw: string) {
  logs.length = 0;
  storage.set('yi.update', raw);
  vi.resetModules();
  const { net } = await loadClient();
  return net.st.update;
}

describe('新版本提示的本地记录', () => {
  it('当前格式的记录：比本机新时提示，不比本机新时不提示', async () => {
    expect(await updateAfterLoad('{"v":1,"version":"99.0.0","url":"https://example.com/yi"}')).toEqual({ version: '99.0.0', url: 'https://example.com/yi' });
    expect(await updateAfterLoad('{"v":1,"version":"0.0.1","url":""}')).toBeNull();
    expect(warns()).toEqual([]);
  });

  it('旧格式（没有版本号）迁移后写回；旧版本存的 null 表示没有新版本', async () => {
    expect(await updateAfterLoad('{"version":"99.0.0","url":""}')).toEqual({ version: '99.0.0', url: '' });
    expect(JSON.parse(storage.get('yi.update') ?? 'null')).toEqual({ v: 1, version: '99.0.0', url: '' });
    expect(warns()).toEqual([]); // 空的下载地址是合格的
    expect(await updateAfterLoad('null')).toBeNull();
  });

  it('被篡改的记录：下载地址不是 http(s) 时不给链接，版本号格式不对时不提示', async () => {
    expect(await updateAfterLoad('{"v":1,"version":"99.0.0","url":"javascript:alert(1)"}')).toEqual({ version: '99.0.0', url: '' });
    expect(await updateAfterLoad('{"v":1,"version":"99.0.0<b>","url":"https://example.com/yi"}')).toBeNull();
    expect(await updateAfterLoad('{"v":1,"version":99,"url":7}')).toBeNull();
  });
});

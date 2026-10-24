/** 经 WebSocket 接入时，加入房间的失败次数按真实 IP 合计（server/host.ts 把 clientIp 交给服务端；API-044，原问题 A6） */
import { describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { startHost } from '../server/host';
import { PROTO_VERSION } from '../src/shared/protocol';
import { newUid } from './serverWorld';

describe('按 IP 的加入失败次数（API-044，原问题 A6）', () => {
  it('经代理来的连接按 X-Forwarded-For 中的真实地址合计，重新连接不清零', async () => {
    const host = await startHost(0, { host: '127.0.0.1' });
    /** 以 ip 经“代理”连上并握手，发 n 次错误的房号，返回最后一次的回应 */
    const tryJoin = async (ip: string, n: number) => {
      const ws = new WebSocket(`ws://127.0.0.1:${host.port}`, { headers: { 'x-forwarded-for': ip } });
      const replies: { t: string; reason?: string }[] = [];
      let wake = () => {};
      ws.on('message', data => {
        replies.push(JSON.parse(String(data)));
        wake();
      });
      const next = async (type: string) => {
        for (;;) {
          const i = replies.findIndex(reply => reply.t === type);
          if (i >= 0) return replies.splice(0, i + 1).at(-1);
          await new Promise<void>(res => (wake = res));
        }
      };
      await new Promise(res => ws.on('open', res));
      ws.send(JSON.stringify({ t: 'hello', v: PROTO_VERSION, name: '试', uid: newUid() }));
      await next('welcome');
      let last;
      for (let i = 0; i < n; i++) {
        ws.send(JSON.stringify({ t: 'join', code: '0001' }));
        last = await next('joinNo');
      }
      ws.close();
      return last?.reason;
    };
    for (let n = 0; n < 5; n++) expect(await tryJoin('203.0.113.7', 4)).toBe('房号不存在，或房间已经开始');
    expect(await tryJoin('203.0.113.7', 1)).toBe('尝试次数太多，请稍后再试');
    expect(await tryJoin('198.51.100.1', 1)).toBe('房号不存在，或房间已经开始');
    expect(host.gauges().joinFailIps).toBe(2); // 监控指标 yi_join_fail_ips
    await host.close();
  });
});

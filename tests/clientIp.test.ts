/** 客户端的真实地址（server/clientIp.ts）：只信任本机反向代理加上的 X-Forwarded-For */
import type http from 'node:http';
import { describe, expect, it } from 'vitest';
import { clientIp, fromThisHost } from '../server/clientIp';

/** 只有对端地址与请求头的请求 */
const req = (remoteAddress: string, headers: http.IncomingHttpHeaders = {}) => ({ socket: { remoteAddress }, headers }) as unknown as http.IncomingMessage;

describe('客户端的真实地址', () => {
  it('直连的客户端自带的 X-Forwarded-For 不可信：取连接的对端地址', () => {
    expect(clientIp(req('203.0.113.7', { 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.7');
    expect(clientIp(req('::ffff:10.0.0.2', { 'x-forwarded-for': '198.51.100.1' }))).toBe('::ffff:10.0.0.2');
  });

  it('经本机的反向代理：取 X-Forwarded-For 的最后一项，客户端自己填在前面的各项不算', () => {
    expect(clientIp(req('127.0.0.1', { 'x-forwarded-for': '198.51.100.1' }))).toBe('198.51.100.1');
    expect(clientIp(req('::1', { 'x-forwarded-for': '1.1.1.1, 2.2.2.2 ,  198.51.100.1 ' }))).toBe('198.51.100.1');
    expect(clientIp(req('::ffff:127.0.0.1', { 'x-forwarded-for': '2001:db8::7' }))).toBe('2001:db8::7');
    const twice = { 'x-forwarded-for': ['1.1.1.1', '198.51.100.9'] } as unknown as http.IncomingHttpHeaders;
    expect(clientIp(req('127.0.0.1', twice))).toBe('198.51.100.9');
  });

  it('本机来的请求不带 X-Forwarded-For，或最后一项不是合法的 IP：取连接的对端地址', () => {
    expect(clientIp(req('127.0.0.1'))).toBe('127.0.0.1');
    for (const bad of ['', 'unknown', '198.51.100.1, <script>', '999.1.1.1'])
      expect(clientIp(req('127.0.0.1', { 'x-forwarded-for': bad })), bad).toBe('127.0.0.1');
  });

  it('只有本机直接发出、不带 X-Forwarded-For 的请求算作来自本机', () => {
    expect([fromThisHost(req('127.0.0.1')), fromThisHost(req('::1')), fromThisHost(req('::ffff:127.0.0.1'))]).toEqual([true, true, true]);
    expect(fromThisHost(req('127.0.0.1', { 'x-forwarded-for': '198.51.100.1' }))).toBe(false);
    expect(fromThisHost(req('127.0.0.1', { 'x-forwarded-for': '127.0.0.1' }))).toBe(false);
    expect(fromThisHost(req('203.0.113.7'))).toBe(false);
  });
});

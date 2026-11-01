/** 联机地址与 CSP（SEC-010、SEC-013）：生产只放行 wss 与 https 的 yi.lightking.com.cn，开发模式另加本机地址，客户端的服务器与接口地址与之一致 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_EXTRA, PROD_CONNECT, devCsp } from '../scripts/dev-csp.mjs';
import { apiBase } from '../src/online/accountApi';
import { ONLINE_SERVER } from '../src/online/config';

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
/** CSP 中某一指令的取值 */
const directive = (page: string, name: string) => new RegExp(`${name} ([^;"]*)`).exec(page)?.[1];

describe('联机地址与 CSP', () => {
  it('index.html 的 connect-src 只放行生产服务器的确切地址，不用通配的 ws:、wss:、https:', () => {
    expect(directive(html, 'connect-src')).toBe("'self' wss://yi.lightking.com.cn https://yi.lightking.com.cn");
    expect(html).toContain(`${PROD_CONNECT};`);
  });

  it('开发模式在 connect-src 后加上本机地址，其余指令不变；找不到生产的 connect-src 时抛出', () => {
    const dev = devCsp(html);
    expect(directive(dev, 'connect-src')).toBe(`'self' wss://yi.lightking.com.cn https://yi.lightking.com.cn ${DEV_EXTRA}`);
    expect(dev.replace(` ${DEV_EXTRA}`, '')).toBe(html);
    expect(() => devCsp(html.replace(PROD_CONNECT, "connect-src 'self' ws: wss:"))).toThrow('index.html 中没有');
  });

  it('客户端连接 wss://yi.lightking.com.cn/ws：默认地址与 .env.production 相同，且在 CSP 放行的源之内', () => {
    expect(ONLINE_SERVER).toBe('wss://yi.lightking.com.cn/ws');
    const env = fs.readFileSync(path.join(root, '.env.production'), 'utf8');
    expect(/^VITE_YI_SERVER=(.*)$/m.exec(env)?.[1]).toBe(ONLINE_SERVER);
    expect(directive(html, 'connect-src')?.split(' ')).toContain(new URL(ONLINE_SERVER).origin);
  });

  it('账号接口的地址由联机地址推出，且在 CSP 放行的源之内；本机调试的接口地址在开发模式中放行', () => {
    expect(directive(html, 'connect-src')?.split(' ')).toContain(new URL(apiBase(ONLINE_SERVER) ?? '').origin);
    expect(DEV_EXTRA.split(' ')).toContain(`${new URL(apiBase('ws://127.0.0.1:8443') ?? '').protocol}//127.0.0.1:*`);
  });
});

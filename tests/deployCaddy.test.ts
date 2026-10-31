/** 安装 Caddy 中弈的站点配置（scripts/server/deploy-remote.sh 的 caddy，路线图第 6 章）；模拟的服务器见 tests/fakeServer.ts */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SCRIPT, at, calls, deployLog, read, run, setupServer, teardownServer, write } from './fakeServer';

const REPO_SITE = path.resolve(__dirname, '../scripts/server/yi.caddy');
const OLD = 'yi.lightking.com.cn {\n  reverse_proxy 127.0.0.1:7700\n}\n';
const SITE = () => at('caddy/sites/yi.caddy');

/** 传到服务器的文件：deploy-remote.sh 与 yi.caddy（内容为 site），返回脚本的路径 */
function upload(site = read(REPO_SITE)) {
  write(at('incoming/yi.caddy'), site);
  fs.copyFileSync(SCRIPT, at('incoming/deploy-remote.sh'));
  return at('incoming/deploy-remote.sh');
}
/** 对 Caddy 的调用：校验与重载 */
const caddyCalls = () => calls().filter(line => line.startsWith('caddy') || line === 'systemctl reload caddy');

beforeEach(() => {
  setupServer();
  write(at('caddy/Caddyfile'), `{\n  email admin@example.com\n}\nimport ${at('caddy/sites')}/*.caddy\n`);
});
afterEach(teardownServer);

describe('安装 yi.caddy', () => {
  it('首次安装：整套配置校验通过后平滑重载，经 HTTPS 访问下载页面成功、/healthz 已屏蔽即完成，记入部署日志', () => {
    const result = run(['caddy'], upload());
    expect(result).toMatchObject({ code: 0 });
    expect(result.out).toContain('https://yi.lightking.com.cn/ 可以访问，/healthz 已屏蔽');
    expect(read(SITE())).toBe(read(REPO_SITE));
    expect(caddyCalls()).toEqual(['caddy validate', 'systemctl reload caddy']);
    expect(calls().some(line => line.startsWith('systemctl restart'))).toBe(false); // 不重启服务端
    expect(fs.existsSync(SITE() + '.prev')).toBe(false);
    expect(deployLog()).toEqual(['tester config stage-4 install-caddy ok']);
  });

  it('校验不通过：换回原来的文件，不重载', () => {
    write(SITE(), OLD);
    write(at('sim/caddy-invalid'), '');
    const result = run(['caddy'], upload());
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('Caddy 的配置校验不通过，未安装');
    expect([read(SITE()), caddyCalls()]).toEqual([OLD, ['caddy validate']]);
  });

  it('重载后在限定时间内（默认 60 秒）经 HTTPS 访问不通：换回原来的文件并再次重载，记为 restored；首次安装时删除新文件', () => {
    write(SITE(), OLD);
    write(at('sim/site-down'), '');
    let result = run(['caddy'], upload());
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('3 秒内 https://yi.lightking.com.cn/ 检查没有通过'); // 测试中限定为 3 次
    expect(read(SITE())).toBe(OLD);
    expect(caddyCalls()).toEqual(['caddy validate', 'systemctl reload caddy', 'systemctl reload caddy']);
    expect(calls().filter(line => line === 'sleep 1')).toHaveLength(3);
    expect(deployLog()).toEqual(['tester config stage-4 install-caddy restored']);
    fs.rmSync(SITE());
    result = run(['caddy'], upload());
    expect(result.code).not.toBe(0);
    expect(fs.existsSync(SITE())).toBe(false);
  });

  it('/healthz 经 HTTPS 可以访问（没有屏蔽）时同样视为不通过', () => {
    write(at('sim/healthz-code'), '200');
    expect(run(['caddy'], upload()).code).not.toBe(0);
    expect(fs.existsSync(SITE())).toBe(false);
  });

  it('重载失败：换回原来的文件并再次重载', () => {
    write(SITE(), OLD);
    write(at('sim/reload-fails'), '');
    const result = run(['caddy'], upload());
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('Caddy 重载失败');
    expect(read(SITE())).toBe(OLD);
    expect(deployLog()).toEqual(['tester config stage-4 install-caddy fail']);
  });

  it('没有装 Caddy，或主配置没有引入站点目录时，不做任何改动', () => {
    write(at('caddy/Caddyfile'), 'example.com {\n  respond "hi"\n}\n');
    let result = run(['caddy'], upload());
    expect(result.out).toContain('中没有 import');
    fs.rmSync(at('bin/caddy'));
    result = run(['caddy'], upload());
    expect(result.out).toContain('服务器上没有 Caddy');
    expect([fs.existsSync(SITE()), caddyCalls()]).toEqual([false, []]);
  });
});

describe('安装后的检查时限', () => {
  it('默认每秒检查一次、至多 60 次：首次安装时要先申请证书', () => {
    expect(read(SCRIPT)).toContain('SITE_POLLS=${YI_SITE_POLLS:-60}');
  });
});

describe('仓库中的 yi.caddy', () => {
  /** 去掉注释与空行后的各行 */
  const lines = read(REPO_SITE)
    .split('\n')
    .map(line => line.replace(/#.*/, '').trim())
    .filter(Boolean);

  it('同域名先屏蔽内部接口，再将 WebSocket 与 API 转给游戏，其余转给独立官网，且不开访问日志', () => {
    expect(lines[0]).toBe('yi.lightking.com.cn {');
    expect(lines).toContain('@internal path /healthz /metrics /admin /admin/*');
    expect(lines).toContain('header Connection *Upgrade*');
    expect(lines).toContain('header Upgrade websocket');
    const route = lines.slice(lines.indexOf('route {') + 1);
    expect(route[0]).toBe('respond @internal 404');
    expect(route).toContain('reverse_proxy @websocket 127.0.0.1:8443 {');
    expect(route).toContain('reverse_proxy /api/* 127.0.0.1:8443');
    expect(route.at(-3)).toBe('reverse_proxy 127.0.0.1:8444');
    expect(lines.some(line => line.startsWith('log'))).toBe(false);
  });
});

describe('本机脚本（scripts/deploy.sh）', () => {
  it('install-caddy 把仓库中的 yi.caddy 传到服务器端安装', () => {
    expect(run(['install-caddy'], path.resolve(__dirname, '../scripts/deploy.sh'))).toMatchObject({ code: 0 });
    expect(read(SITE())).toBe(read(REPO_SITE));
    expect(deployLog()).toEqual(['tester config stage-4 install-caddy ok']);
  });
});

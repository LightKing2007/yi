/** 独立官网 HTTP 进程：复用网页与下载处理，不创建联机房间、WebSocket 或数据库。 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Log } from './log';
import { fromThisHost } from './clientIp';
import { fileServer } from './files';
import { hardenHttp, withHttpLimit } from './http';
import { HttpGate } from './ratelimit';

const HTTP_OK = 200;
const PRUNE_MS = 10_000;

/** 生产定时器不阻止进程退出，关闭监听时取消；测试可注入手动调度器。 */
function repeat(task: () => void, ms: number) {
  const timer = setInterval(task, ms);
  timer.unref();
  return () => clearInterval(timer);
}

/** 官网运行依赖；时间单位为秒，仅供请求限流，测试可替换。 */
export interface WebsiteOptions {
  port: number;
  files: string;
  commit: string;
  now: () => number;
  log?: Log;
  every?: (task: () => void, ms: number) => () => void;
}

/** 只在本机监听；本机直连的健康检查用于独立部署与回滚。 */
export async function startWebsite(opt: WebsiteOptions) {
  const files = fileServer(opt.files);
  const gate = new HttpGate();
  const web = withHttpLimit(files, gate, opt.now, opt.log);
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz' && req.method === 'GET' && fromThisHost(req)) {
      res.writeHead(HTTP_OK, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify({ service: 'yi-web', commit: opt.commit }));
    } else web(req, res);
  });
  hardenHttp(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opt.port, '127.0.0.1', resolve);
  });
  const stop = (opt.every ?? repeat)(() => gate.prune(opt.now()), PRUNE_MS);
  return {
    port: (server.address() as AddressInfo).port,
    trackedIps: () => gate.size,
    close: () => {
      stop();
      return new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())));
    },
  };
}

/**
 * 弈 · 联机服务端：node server.cjs [端口]（默认 8443）。
 * 环境变量：PORT 端口；HOST 监听地址（默认所有网卡，放在反向代理后面时设为 127.0.0.1）；
 * YI_DATA 段位存档（默认当前目录下的 yi-ratings.json）。
 */
import path from 'node:path';
import { PROTO_PORT, PROTO_VERSION } from '../src/shared/protocol';
import { startHost } from './host';
import { FileStore } from './store';

const port = Number(process.argv[2] ?? process.env.PORT ?? PROTO_PORT);
const host = process.env.HOST || undefined;

const log = (text: string) => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  console.log(`[${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}] ${text}`);
};

const dataFile = path.resolve(process.env.YI_DATA ?? 'yi-ratings.json');
const store = new FileStore(dataFile);

startHost(port, { log, store, host }).then(h => {
  log(`弈 联机服务端已启动，${host ? `地址 ${host}，` : ''}端口 ${h.port}（协议版本 ${PROTO_VERSION}），段位存档 ${dataFile}`);
  const stop = () => { log('正在关闭…'); store.flush(); h.close().then(() => process.exit(0)); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}).catch((e: Error) => {
  console.error(`无法在端口 ${port} 启动：${e.message}`);
  process.exit(1);
});

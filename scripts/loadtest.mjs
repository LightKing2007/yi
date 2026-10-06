/**
 * 服务端压测（TST-045，整改项 P2-07）：启动打包好的服务端，以真实的 WebSocket 连接施加负载，按 /metrics（OPS-071）与进程统计检查：
 * 单条消息处理耗时 p99 ≤ 5 毫秒、CPU ≤ 50%、常驻内存 ≤ 256 MB、事件循环延迟 p99 ≤ 50 毫秒。
 *   node scripts/loadtest.mjs [--connections 500] [--rate 2] [--seconds 60] [--warmup 10] [--json 文件]
 * 先运行 npm run build:node。连接两两开好友房间下五子棋，每条连接每秒发 rate 条消息：轮到自己时落子，否则发心跳；终局后再来一局。
 * 另记客户端看到的落子往返耗时（发出落子到收到服务端广播），含 WebSocket 收发与 JSON 解析，只作参考。
 * 服务端限制同一 IP 至多 8 条连接（API-040），连接分别以 127.0.0.2 起的本机地址发起：Linux 上 127.0.0.0/8 均为本机地址，
 * macOS 默认只有 127.0.0.1，只能测 8 条以内。环境变量 LOADTEST_SERVER_PREFIX 为启动服务端的前缀命令，如 "taskset -c 0,1"（限定 2 个核）。
 * 任一项不达标时退出码为 1，参数或环境不对时为 2。
 */
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const PER_IP = 8; // 与 server/host.ts 的 MAX_PER_IP 一致
const SIZE = 15;
const MB = 1024 * 1024;
const MS_PER_SEC = 1000;
/** 采样常驻内存的间隔（秒） */
const RSS_EVERY_SECS = 5;
/** TST-045 的上限 */
const LIMITS = { handleP99Ms: 5, cpuPercent: 50, rssMb: 256, lagP99Ms: 50 };

/** 命令行参数 */
function options(argv) {
  const get = (name, fallback) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  return {
    connections: Number(get('connections', 500)),
    rate: Number(get('rate', 2)),
    seconds: Number(get('seconds', 60)),
    warmup: Number(get('warmup', 10)),
    json: get('json', ''),
  };
}

/** 第 i 条连接的本机源地址：Linux 上每 PER_IP 条换一个地址；其他系统只有 127.0.0.1 */
const sourceAddress = i => (os.platform() === 'linux' ? `127.0.0.${2 + Math.floor(i / PER_IP)}` : '127.0.0.1');
const sleep = ms => new Promise(res => setTimeout(res, ms));
/** 一组数的 p99 */
const p99 = values => [...values].sort((left, right) => left - right)[Math.max(0, Math.ceil(values.length * 0.99) - 1)] ?? 0;

/** 读 /metrics，返回各样本（名称含标签 → 值） */
async function metrics(port) {
  const text = await (await fetch(`http://127.0.0.1:${port}/metrics`)).text();
  const out = {};
  for (const line of text.split('\n'))
    if (line && !line.startsWith('#')) out[line.slice(0, line.lastIndexOf(' '))] = Number(line.slice(line.lastIndexOf(' ') + 1));
  return out;
}

/** 进程累计的 CPU 时间（秒）：Linux 读 /proc（单位为 1/100 秒的时钟周期），其他系统读 ps 的“分:秒.百分秒” */
function cpuSeconds(pid) {
  if (fs.existsSync(`/proc/${pid}/stat`)) {
    const fields = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ');
    return (Number(fields[11]) + Number(fields[12])) / 100; // utime、stime
  }
  const text = execFileSync('ps', ['-p', String(pid), '-o', 'time='], { encoding: 'utf8' }).trim();
  return text.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
}

/** 处理耗时的直方图在两次读数之间的 p99 上界（毫秒）：取累计占比首次 ≥ 99% 的桶 */
function handleP99(before, after) {
  const total = after.yi_message_handle_seconds_count - before.yi_message_handle_seconds_count;
  for (const key of Object.keys(after).filter(name => name.startsWith('yi_message_handle_seconds_bucket'))) {
    const le = key.match(/le="([^"]+)"/)[1];
    if ((after[key] - before[key]) / total >= 0.99) return le === '+Inf' ? Infinity : Number(le) * MS_PER_SEC;
  }
  return Infinity;
}

/** 一条施压的连接：两两成对，偶数号开房间，奇数号加入。返回连接与每次轮到发消息时调用的 step */
function client(i, port, stats, rooms) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { localAddress: sourceAddress(i), perMessageDeflate: false });
  const state = { color: 0, toMove: 0, board: new Set(), sentAt: 0, open: false };
  const send = msg => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));
  const host = i % 2 === 0;
  const rejected = msg => stats.errors.push(msg.text ?? msg.reason);
  /** 各类服务端消息的处理 */
  const on = {
    welcome: () => host && send({ t: 'create', type: 0, size: SIZE, hostColor: 0, renju: false, moveTime: 0 }),
    created: msg => rooms.set(i + 1, msg.code),
    start: msg => {
      state.color = msg.color;
      state.board.clear();
    },
    turn: msg => (state.toMove = msg.color),
    moved: msg => {
      state.board.add(msg.y * SIZE + msg.x);
      if (state.sentAt) stats.rtt.push(performance.now() - state.sentAt); // 自己发出的落子由服务端广播回来
      state.sentAt = 0;
    },
    over: () => host && send({ t: 'rematch' }),
    ask: msg => msg.kind === 'rematch' && send({ t: 'reply', kind: 'rematch', ok: true }),
    error: rejected,
    info: rejected,
    joinNo: rejected,
  };
  ws.on('open', () => {
    state.open = true;
    send({ t: 'hello', v: 3, name: `压测${i}`, uid: `loadtest-${String(i).padStart(12, '0')}` });
  });
  ws.on('message', data => {
    const msg = JSON.parse(String(data));
    on[msg.t]?.(msg);
  });
  ws.on('close', code => state.open && stats.closed.push(code));
  ws.on('error', err => stats.errors.push(err.message));
  const step = () => {
    stats.sent++;
    if (rooms.has(i)) {
      send({ t: 'join', code: rooms.get(i) });
      rooms.delete(i);
    } else if (state.color && state.toMove === state.color && state.board.size < SIZE * SIZE) {
      let cell;
      do cell = Math.floor(Math.random() * SIZE * SIZE);
      while (state.board.has(cell));
      state.sentAt = performance.now();
      send({ t: 'move', x: cell % SIZE, y: Math.floor(cell / SIZE) });
    } else send({ t: 'ping' });
  };
  return { ws, step };
}

/** 启动服务端（可带 LOADTEST_SERVER_PREFIX 前缀命令），等健康检查可用；返回子进程、端口与其日志 */
async function startServer(tmp) {
  const server = path.join(root, 'dist-server/server.cjs');
  if (!fs.existsSync(server)) throw new Error('先运行 npm run build:node');
  const port = 20000 + Math.floor(Math.random() * 20000);
  const prefix = (process.env.LOADTEST_SERVER_PREFIX ?? '').split(' ').filter(Boolean);
  const [cmd, ...args] = [...prefix, process.execPath, server, String(port)];
  const child = spawn(cmd, args, {
    env: { ...process.env, YI_DATA: path.join(tmp, 'ratings.json'), YI_LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const log = { text: '' };
  child.stdout.on('data', data => (log.text += data));
  for (
    let i = 0;
    i < 100 &&
    !(await fetch(`http://127.0.0.1:${port}/healthz`).then(
      res => res.ok,
      () => false,
    ));
    i++
  )
    await sleep(100);
  return { child, port, log, prefix: prefix.join(' ') || '无' };
}

/** 施压：建立连接，每条连接每秒 rate 条消息（起始时刻错开），预热后测量 seconds 秒；返回测量结果 */
async function measure(opt, server) {
  const stats = { sent: 0, rtt: [], errors: [], closed: [] };
  const rooms = new Map();
  const clients = Array.from({ length: opt.connections }, (_, i) => client(i, server.port, stats, rooms));
  const interval = MS_PER_SEC / opt.rate;
  const timers = clients.map((item, i) => setTimeout(() => timers.push(setInterval(item.step, interval)), (interval * i) / opt.connections));
  await sleep(opt.warmup * MS_PER_SEC);
  const before = await metrics(server.port);
  const cpuBefore = cpuSeconds(server.child.pid);
  const sentBefore = stats.sent;
  stats.rtt = [];
  let rssMax = 0;
  for (let elapsed = 0; elapsed < opt.seconds; elapsed += RSS_EVERY_SECS) {
    await sleep(RSS_EVERY_SECS * MS_PER_SEC);
    rssMax = Math.max(rssMax, (await metrics(server.port)).process_resident_memory_bytes);
  }
  const after = await metrics(server.port);
  const cpuAfter = cpuSeconds(server.child.pid);
  for (const timer of timers) clearInterval(timer);
  for (const item of clients) item.ws.terminate();
  return {
    connections: opt.connections,
    online: after.yi_players_online,
    messagesPerSec: Math.round((stats.sent - sentBefore) / opt.seconds),
    handledPerSec: Math.round((after.yi_message_handle_seconds_count - before.yi_message_handle_seconds_count) / opt.seconds),
    handleP99Ms: handleP99(before, after),
    cpuPercent: Math.round(((cpuAfter - cpuBefore) / opt.seconds) * 1000) / 10,
    rssMb: Math.round(rssMax / MB),
    lagP99Ms: Math.round(after.yi_event_loop_lag_seconds * MS_PER_SEC * 10) / 10,
    moveRttP99Ms: Math.round(p99(stats.rtt) * 100) / 100,
    moveSamples: stats.rtt.length,
    clientErrors: stats.errors.length,
    errorSamples: stats.errors.slice(0, 5),
    closedByServer: stats.closed.length,
    machine: `${os.cpus()[0]?.model ?? '未知'}，${os.cpus().length} 核，${os.platform()} ${os.release()}，Node ${process.version}`,
    serverPrefix: server.prefix,
  };
}

/** 各项检查：[是否达标, 说明] */
function checks(result, serverLog) {
  const errorLines = serverLog.split('\n').filter(line => line.includes('"level":"error"'));
  return [
    [result.online === result.connections, `全部 ${result.connections} 条连接在线（实际 ${result.online}）`],
    [result.clientErrors === 0 && result.closedByServer === 0, `没有被拒的请求与被断开的连接（拒绝 ${result.clientErrors}，断开 ${result.closedByServer}）`],
    [result.handleP99Ms <= LIMITS.handleP99Ms, `消息处理耗时 p99 ≤ ${LIMITS.handleP99Ms} 毫秒（${result.handleP99Ms}）`],
    [result.cpuPercent <= LIMITS.cpuPercent, `CPU ≤ ${LIMITS.cpuPercent}%（${result.cpuPercent}，按单核计）`],
    [result.rssMb <= LIMITS.rssMb, `常驻内存 ≤ ${LIMITS.rssMb} MB（${result.rssMb}）`],
    [result.lagP99Ms <= LIMITS.lagP99Ms, `事件循环延迟 p99 ≤ ${LIMITS.lagP99Ms} 毫秒（${result.lagP99Ms}）`],
    [errorLines.length === 0, `服务端没有 error 级别的日志${errorLines.length ? '：' + errorLines[0] : ''}`],
  ];
}

async function main(argv) {
  const opt = options(argv);
  if (os.platform() !== 'linux' && opt.connections > PER_IP) throw new Error(`只有 Linux 上 127.0.0.0/8 均为本机地址；本系统至多 --connections ${PER_IP}`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-loadtest-'));
  const server = await startServer(tmp);
  try {
    const result = await measure(opt, server);
    server.child.kill('SIGTERM');
    await new Promise(res => server.child.on('exit', res));
    const list = checks(result, server.log.text);
    console.log(JSON.stringify(result, null, 2));
    for (const [ok, text] of list) console.log(`${ok ? '✓' : '✗'} ${text}`);
    if (opt.json) fs.writeFileSync(opt.json, JSON.stringify({ ...result, checks: list.map(([ok, text]) => ({ ok, text })) }, null, 2) + '\n');
    if (list.some(([ok]) => !ok)) process.exitCode = 1;
  } finally {
    if (server.child.exitCode === null) server.child.kill('SIGTERM');
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

await main(process.argv.slice(2)).catch(err => {
  console.error(`✗ ${err.message}`);
  process.exitCode = 2;
});

/**
 * 性能基准的测量部分（TST-041、TST-045，整改项 P2-07）：电脑思考耗时、围棋搜索速度、点目估死子、
 * 服务端处理消息的耗时与内存、下载页面的响应。由 scripts/bench.mjs 打包后运行，结果记入 docs/audits/perf-版本号.md（TST-046）。
 * 所有对局都用固定种子生成，同一台机器上重复运行可得到可比的数字；耗时本身随机器负载波动，比较时以 p95 为准。
 */
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Game } from '../src/core/game';
import { estimateDead, goThink } from '../src/core/goAI';
import { gomokuMove } from '../src/core/gomokuAI';
import { goSnap, gomokuSnap } from '../src/core/snap';
import { GameType, MAXN, Rng } from '../src/core/types';
import { fileServer } from '../server/files';
import { RoomServer, type Conn } from '../server/rooms';
import { PROTO_VERSION, type S2C } from '../src/shared/protocol';

/** 一组耗时（毫秒）的统计 */
export interface Stats {
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/** 基准的规模参数 */
export interface BenchOptions {
  /** 五子棋每个难度自我对弈的盘数 */
  gomokuGames: number;
  /** 围棋每种路数、每个难度按时间思考的手数 */
  goMoves: number;
  /** 服务端的连接数（两两一桌） */
  connections: number;
  /** 服务端每条连接发送消息的轮数 */
  rounds: number;
  /** 下载页面请求的次数 */
  httpRequests: number;
}

const GOMOKU_N = 15;
const GOMOKU_MAX_MOVES = 60;
const OPENING_SPREAD = 3; // 开局前两手在天元附近随机，使每盘局面不同
/** 围棋各路数，以及测量前先用简单难度走几手（得到中盘局面） */
const GO_WARMUP_MOVES: Record<string, number> = { '9': 12, '13': 24, '19': 40 };
const GO_THROUGHPUT_ITERATIONS = 2000;
const DEAD_ESTIMATE_MOVES = 150;
const MS_PER_SEC = 1000;
const BYTES_PER_MB = 1048576;
const PERCENT = 100;
const FAKE_INSTALLERS = ['Yi-2.0.4-win-x64-setup.exe', 'Yi-2.0.4-mac-arm64.dmg', 'Yi-2.0.4-mac-x64.dmg', 'Yi-2.0.4-linux-x86_64.AppImage'];
const FAKE_INSTALLER_BYTES = 65536;
const CHECKSUM_WAIT_MS = 20;
const CHECKSUM_WAIT_TRIES = 100;
const HTTP_OK = 200;
/** 统计的百分位 */
const P50 = 50,
  P95 = 95,
  P99 = 99;
/** 估死子：局面的种子与重复次数 */
const DEAD_SEED = 7,
  DEAD_RUNS = 3;
/** 服务端基准挑落点用的种子 */
const SERVER_SEED = 42;
/** 模拟设备编号的位数（uid 须为 16 位以上，API-013） */
const UID_DIGITS = 8;

/** 第 p 百分位（p 为 0 至 100），按最近秩法取值 */
function percentile(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  const rank = Math.min(sorted.length - 1, Math.ceil((p / PERCENT) * sorted.length) - 1);
  return sorted[Math.max(0, rank)];
}

/** 汇总一组耗时 */
export function stats(times: number[]): Stats {
  const sorted = [...times].sort((one, two) => one - two);
  const round = (value: number) => Math.round(value * PERCENT) / PERCENT;
  return {
    count: sorted.length,
    p50: round(percentile(sorted, P50)),
    p95: round(percentile(sorted, P95)),
    p99: round(percentile(sorted, P99)),
    max: round(sorted.at(-1) ?? 0),
  };
}

/** 计时执行 fn，返回 [结果, 毫秒] */
function timed<T>(fn: () => T): [T, number] {
  const start = performance.now();
  const value = fn();
  return [value, performance.now() - start];
}

/** 五子棋某个难度的自我对弈：返回每一手的思考耗时（TST-041） */
function benchGomoku(level: number, games: number) {
  const times: number[] = [];
  for (let game = 0; game < games; game++) {
    const rng = new Rng(game + 1);
    const board = new Game();
    board.newGame(GameType.Gomoku, GOMOKU_N, { renju: true });
    const center = GOMOKU_N >> 1;
    board.play(center, center);
    board.play(center + rng.int(-OPENING_SPREAD, OPENING_SPREAD), center + rng.int(1, OPENING_SPREAD)); // 白棋第一手：天元下方附近
    while (!board.over && board.cur.moves < GOMOKU_MAX_MOVES) {
      const [move, ms] = timed(() => gomokuMove(gomokuSnap(board), level, () => rng.next()));
      times.push(ms);
      if (!move || !board.play(move.x, move.y)) break;
    }
  }
  return stats(times);
}

/** 用简单难度走若干手，得到一盘中盘局面 */
function goPosition(size: number, moves: number, seed: number) {
  const board = new Game();
  board.newGame(GameType.Go, size);
  for (let i = 0; i < moves && !board.scoring; i++) {
    const move = goThink(goSnap(board), 0, { seed: seed + i });
    if (move.x < 0 || !board.play(move.x, move.y)) board.pass();
  }
  return board;
}

/** 围棋：按时间思考的耗时（TST-041），以及固定模拟次数下的搜索速度（每秒模拟次数） */
function benchGo(size: number, level: number, moves: number) {
  const times: number[] = [];
  for (let i = 0; i < moves; i++) {
    const board = goPosition(size, GO_WARMUP_MOVES[size], i * MS_PER_SEC);
    times.push(timed(() => goThink(goSnap(board), level))[1]);
  }
  const board = goPosition(size, GO_WARMUP_MOVES[size], 1);
  const [, ms] = timed(() => goThink(goSnap(board), level, { iterations: GO_THROUGHPUT_ITERATIONS, seed: 1 }));
  return { think: stats(times), simsPerSec: Math.round((GO_THROUGHPUT_ITERATIONS / ms) * MS_PER_SEC) };
}

/** 点目估死子（19 路，走满 150 手后）：耗时 */
function benchDead() {
  const board = goPosition(MAXN, DEAD_ESTIMATE_MOVES, DEAD_SEED);
  const times: number[] = [];
  for (let i = 0; i < DEAD_RUNS; i++) times.push(timed(() => estimateDead(board.cur.b, board.N, board.komi))[1]);
  return stats(times);
}

/** 一名模拟玩家：收到的消息、自己的颜色与对局镜像（用来挑合法的落点） */
interface FakePlayer {
  inbox: S2C[];
  conn: Conn;
  sess: ReturnType<RoomServer['connect']>;
  color: number;
  mirror: Game;
}

/** 让 sess 发一条消息并计时 */
function send(srv: RoomServer, player: FakePlayer, msg: unknown, times: number[]) {
  const current = player.sess;
  if (!current) throw new Error(`连接数超出服务端上限，无法建立第 ${times.length + 1} 条连接`);
  const [sess, ms] = timed(() => srv.message(current, msg, player.conn));
  player.sess = sess;
  times.push(ms);
}

/** 镜像对局同步服务端确认的落子 */
function syncMirror(player: FakePlayer) {
  for (const msg of player.inbox) {
    if (msg.t === 'start') {
      player.color = msg.color;
      player.mirror.newGame(msg.type ? GameType.Go : GameType.Gomoku, msg.size, { renju: msg.renju });
    } else if (msg.t === 'moved') player.mirror.play(msg.x, msg.y);
  }
  player.inbox.length = 0;
}

/** 在镜像对局中挑一个合法落点；没有时返回 null */
function pickMove(player: FakePlayer, rng: Rng) {
  const board = player.mirror;
  for (let tries = 0; tries < board.N * board.N; tries++) {
    const x = rng.int(0, board.N - 1),
      y = rng.int(0, board.N - 1);
    if (board.b(x, y) === 0 && !board.forbiddenAt(x, y)) return { x, y };
  }
  return null;
}

/** 服务端：connections 条连接两两开好友房间，交替落子与心跳，测每条消息的处理耗时、tick 耗时与内存（TST-045） */
function benchServer(connections: number, rounds: number) {
  const srv = new RoomServer();
  const rng = new Rng(SERVER_SEED);
  const players: FakePlayer[] = [];
  const times: number[] = [];
  for (let i = 0; i < connections; i++) {
    const inbox: S2C[] = [];
    const conn: Conn = { send: msg => void inbox.push(msg), close: () => {} };
    const player: FakePlayer = { inbox, conn, sess: srv.connect(conn), color: 0, mirror: new Game() };
    players.push(player);
    send(srv, player, { t: 'hello', v: PROTO_VERSION, name: `棋手${i}`, uid: `bench-device-${String(i).padStart(UID_DIGITS, '0')}` }, times);
  }
  for (let i = 0; i + 1 < connections; i += 2) {
    const [host, guest] = [players[i], players[i + 1]];
    send(srv, host, { t: 'create', type: (i / 2) % 2, size: (i / 2) % 2 ? MAXN : GOMOKU_N, hostColor: 0, renju: true, moveTime: 0 }, times);
    const created = host.inbox.find(msg => msg.t === 'created');
    if (created && created.t === 'created') send(srv, guest, { t: 'join', code: created.code }, times);
  }
  for (const player of players) syncMirror(player);
  const handled: number[] = [];
  const tickTimes: number[] = [];
  const start = performance.now();
  for (let round = 0; round < rounds; round++) {
    for (const player of players) {
      const turn = player.mirror.cur.toMove === player.color && !player.mirror.over;
      const move = turn ? pickMove(player, rng) : null;
      send(srv, player, move ? { t: 'move', x: move.x, y: move.y } : { t: 'ping' }, handled);
      syncMirror(player);
    }
    tickTimes.push(timed(() => srv.tick())[1]);
  }
  const busyMs = performance.now() - start;
  const after = process.memoryUsage();
  return {
    message: stats(handled),
    tick: stats(tickTimes),
    messagesPerSec: Math.round((handled.length / busyMs) * MS_PER_SEC),
    heapMb: Math.round((after.heapUsed / BYTES_PER_MB) * PERCENT) / PERCENT, // 进程的堆占用（含前面各项基准的残留）
    rssMb: Math.round((after.rss / BYTES_PER_MB) * PERCENT) / PERCENT,
  };
}

/** 依次请求 count 次，返回每次的耗时 */
async function requestTimes(base: string, pathName: string, count: number) {
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const start = performance.now();
    const res = await fetch(base + pathName);
    await res.arrayBuffer();
    times.push(performance.now() - start);
  }
  return times;
}

/** 下载页面与校验值的响应耗时（四个模拟安装程序）；HTTP 请求没有频率限制，这里量出单个请求占用服务端的时间 */
async function benchHttp(count: number) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-bench-'));
  const server = http.createServer();
  try {
    for (const name of FAKE_INSTALLERS) fs.writeFileSync(path.join(dir, name), Buffer.alloc(FAKE_INSTALLER_BYTES));
    server.on('request', fileServer(dir));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    for (let i = 0; i < CHECKSUM_WAIT_TRIES && (await fetch(base + '/SHA256SUMS')).status !== HTTP_OK; i++)
      await new Promise(r => setTimeout(r, CHECKSUM_WAIT_MS));
    const page = await requestTimes(base, '/', count);
    const sums = await requestTimes(base, '/SHA256SUMS', count);
    const total = page.reduce((sum, ms) => sum + ms, 0);
    return { page: stats(page), sums: stats(sums), pagesPerSec: Math.round((count / total) * MS_PER_SEC) };
  } finally {
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 运行全部基准 */
export async function runBench(opt: BenchOptions) {
  const gomoku = Object.fromEntries([0, 1, 2].map(level => [level, benchGomoku(level, opt.gomokuGames)]));
  const go: Record<string, ReturnType<typeof benchGo>> = {};
  for (const size of Object.keys(GO_WARMUP_MOVES).map(Number)) for (const level of [1, 2]) go[`${size}-${level}`] = benchGo(size, level, opt.goMoves);
  return { gomoku, go, dead: benchDead(), server: benchServer(opt.connections, opt.rounds), http: await benchHttp(opt.httpRequests) };
}

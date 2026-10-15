/**
 * 服务端配置：环境变量与命令行参数集中在此解析并校验（实现 ARC-042，整改项 P2-04）。其他模块严禁直接读取 `process.env`、`process.argv`，由 ESLint 检查。
 * 校验失败的每一项以 `{ variable, expected }` 返回，由入口写 `server.config-invalid` 日志后以退出码 78 退出。
 */
import net from 'node:net';
import path from 'node:path';
import { PROTO_PORT } from '../src/shared/protocol';
import { parseLogLevel, type LogLevel } from './log';

/** 退出码：配置不合法（sysexits.h 的 EX_CONFIG，ARC-042） */
export const EXIT_CONFIG = 78;
/** 端口号的上限 */
const PORT_MAX = 65535;
/** 版本号的格式：主版本.次版本.修订号（VER-001） */
const VERSION = /^\d+\.\d+\.\d+$/;
/** 主机名的格式（RFC 1123 的字母、数字、连字符与点）；IP 地址另由 net.isIP 判断 */
const HOSTNAME = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

/** 解析后的服务端配置 */
export interface ServerConfig {
  /** 只打出版本号与提交号后退出（`--version`） */
  version: boolean;
  /** 主端口：命令行第一个参数，其次 `PORT`，默认 8443 */
  port: number;
  /** 另外同时监听的端口（`EXTRA_PORTS`，逗号分隔），已去掉与主端口相同的 */
  extraPorts: number[];
  /** 监听地址（`HOST`），不设时监听所有网卡 */
  host?: string;
  /** 段位存档的绝对路径（`YI_DATA`，默认为工作目录下的 yi-ratings.json） */
  dataFile: string;
  /** 最新的客户端版本号（`YI_LATEST`） */
  latest?: string;
  /** 新版本的下载地址（`YI_DOWNLOAD`，http 或 https） */
  download?: string;
  /** 安装程序所在目录的绝对路径（`YI_FILES`），设了才提供下载页面 */
  files?: string;
  /** 日志级别（`YI_LOG_LEVEL`，OPS-062），不合法时为 info 并记为一项错误 */
  logLevel: LogLevel;
  /** 是否在 systemd 之下运行（有 `JOURNAL_STREAM`），是则日志加级别前缀（OPS-060） */
  journal: boolean;
}

/** 校验失败的一项：变量名与期望的格式 */
export interface ConfigError {
  variable: string;
  expected: string;
}

/** 解析结果：`errors` 不为空时调用方必须拒绝启动；`config` 中不合法的项已取默认值，只供写日志 */
export interface ConfigResult {
  config: ServerConfig;
  errors: ConfigError[];
}

type Env = Record<string, string | undefined>;

/** 端口号：1 至 65535 的整数 */
function parsePort(text: string): number | null {
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= PORT_MAX && /^\d+$/.test(text) ? n : null;
}

/** 空串与未设置一样视为未设置 */
const given = (value: string | undefined) => (value ? value : undefined);

/** 记下一项校验失败 */
type Fail = (variable: string, expected: string) => void;

/** 主端口与另外监听的端口 */
function parsePorts(argv: string[], env: Env, fail: Fail) {
  const portText = argv[0] ?? given(env.PORT);
  const port = portText === undefined ? PROTO_PORT : parsePort(portText);
  if (port === null) fail(argv[0] === undefined ? 'PORT' : '命令行参数（端口）', '1 至 65535 的整数');
  const extraPorts: number[] = [];
  for (const item of (env.EXTRA_PORTS ?? '')
    .split(',')
    .map(text => text.trim())
    .filter(Boolean)) {
    const n = parsePort(item);
    if (n === null) fail('EXTRA_PORTS', '以逗号分隔的端口号，每个为 1 至 65535 的整数');
    else if (n !== port && !extraPorts.includes(n)) extraPorts.push(n);
  }
  return { port: port ?? PROTO_PORT, extraPorts };
}

/** 监听地址、最新版本号与下载地址：未设置时为 undefined */
function parseTexts(env: Env, fail: Fail) {
  const host = given(env.HOST);
  if (host !== undefined && net.isIP(host) === 0 && !HOSTNAME.test(host)) fail('HOST', 'IP 地址或主机名');
  const latest = given(env.YI_LATEST);
  if (latest !== undefined && !VERSION.test(latest)) fail('YI_LATEST', '版本号，格式为“主版本.次版本.修订号”，如 2.0.8');
  const download = given(env.YI_DOWNLOAD);
  if (download !== undefined && !isWebUrl(download)) fail('YI_DOWNLOAD', '以 http:// 或 https:// 开头的网址');
  return { host, latest, download };
}

/** 解析各项，不合法的记入 errors 并取默认值 */
function collect(argv: string[], env: Env, cwd: string, errors: ConfigError[]) {
  const fail: Fail = (variable, expected) => errors.push({ variable, expected });
  const ports = parsePorts(argv, env, fail),
    texts = parseTexts(env, fail);
  const logLevel = parseLogLevel(env.YI_LOG_LEVEL);
  if (logLevel === null) fail('YI_LOG_LEVEL', 'error、warn、info、debug 之一');
  const files = given(env.YI_FILES);
  return {
    ...ports,
    ...texts,
    dataFile: path.resolve(cwd, given(env.YI_DATA) ?? 'yi-ratings.json'),
    files: files === undefined ? undefined : path.resolve(cwd, files),
    logLevel: logLevel ?? 'info',
    journal: Boolean(env.JOURNAL_STREAM),
  };
}

/** 是否为 http 或 https 网址 */
function isWebUrl(text: string) {
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false; // 不是合法的网址，由调用方记为一项错误
  }
}

/**
 * 解析配置（纯函数，便于测试）。argv 为 `process.argv.slice(2)`：`--version` 只打出版本号；其余第一个参数为端口。
 * 相对路径以 cwd 为基准解析为绝对路径
 */
export function parseConfig(argv: string[], env: Env, cwd: string): ConfigResult {
  const version = argv.includes('--version');
  const args = argv.filter(arg => arg !== '--version');
  const errors: ConfigError[] = [];
  const config = { version, ...collect(args, env, cwd, errors) };
  return { config, errors: version ? [] : errors };
}

/** 读取本进程的命令行参数与环境变量并解析：服务端只在此处读取二者 */
export function loadConfig(): ConfigResult {
  return parseConfig(process.argv.slice(2), process.env, process.cwd());
}

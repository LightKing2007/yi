/**
 * 服务端配置：环境变量与命令行参数集中在此解析并校验（实现 ARC-042，整改项 P2-04）。其他模块严禁直接读取 `process.env`、`process.argv`，由 ESLint 检查。
 * 校验失败的每一项以 `{ variable, expected }` 返回，由入口写 `server.config-invalid` 日志后以退出码 78 退出。
 */
import net from 'node:net';
import path from 'node:path';
import { PROTO_PORT, PROTO_VERSION } from '../src/shared/protocol';
import { parseAccountConfig, type AccountConfig } from './accountConfig';
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
  /**
   * 要执行的命令：serve 运行服务端（默认）；backup 备份数据库后退出（命令行第一个参数为 `backup`）；
   * account-keys 打出一份新生成的账号密钥后退出（供 root 写入凭据文件，见 accountSecrets.ts）
   */
  command: 'serve' | 'backup' | 'account-keys';
  /** 主端口：命令行第一个参数，其次 `PORT`，默认 8443 */
  port: number;
  /** 监听地址（`HOST`），不设时监听所有网卡 */
  host?: string;
  /** 数据库的绝对路径（`YI_DB`，默认为工作目录下的 yi.db） */
  dbFile: string;
  /** 备份目录的绝对路径（`YI_BACKUP_DIR`，默认为数据库所在目录下的 backup/） */
  backupDir: string;
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
  /** 账号功能（`YI_ACCOUNTS=1` 时），关闭时为 undefined，账号接口一律 404 */
  accounts?: AccountConfig;
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

/** 监听的端口：命令行第一个参数，其次 `PORT`，默认 8443 */
function parsePorts(argv: string[], env: Env, fail: Fail) {
  const portText = argv[0] ?? given(env.PORT);
  const port = portText === undefined ? PROTO_PORT : parsePort(portText);
  if (port === null) fail(argv[0] === undefined ? 'PORT' : '命令行参数（端口）', '1 至 65535 的整数');
  return { port: port ?? PROTO_PORT };
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

/** 解析各项，不合法的记入 errors 并取默认值；backup 命令不监听端口，不解析端口 */
function collect({ argv, env, cwd, command }: { argv: string[]; env: Env; cwd: string; command: ServerConfig['command'] }, errors: ConfigError[]) {
  const fail: Fail = (variable, expected) => errors.push({ variable, expected });
  const ports = command === 'serve' ? parsePorts(argv, env, fail) : { port: PROTO_PORT },
    texts = parseTexts(env, fail);
  const logLevel = parseLogLevel(env.YI_LOG_LEVEL);
  if (logLevel === null) fail('YI_LOG_LEVEL', 'error、warn、info、debug 之一');
  const files = given(env.YI_FILES);
  const dbFile = path.resolve(cwd, given(env.YI_DB) ?? 'yi.db');
  const backupDir = given(env.YI_BACKUP_DIR);
  return {
    ...ports,
    ...texts,
    dbFile,
    backupDir: backupDir === undefined ? path.join(path.dirname(dbFile), 'backup') : path.resolve(cwd, backupDir),
    files: files === undefined ? undefined : path.resolve(cwd, files),
    logLevel: logLevel ?? 'info',
    journal: Boolean(env.JOURNAL_STREAM),
    accounts: command === 'serve' ? parseAccountConfig(env, fail) : undefined,
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
 * 解析配置（纯函数，便于测试）。argv 为 `process.argv.slice(2)`：`--version` 只打出版本号；第一个参数为 `backup` 时备份数据库；
 * 否则第一个参数为端口。
 * 相对路径以 cwd 为基准解析为绝对路径
 */
export function parseConfig(argv: string[], env: Env, cwd: string): ConfigResult {
  const version = argv.includes('--version');
  const args = argv.filter(arg => arg !== '--version');
  const command = args[0] === 'backup' || args[0] === 'account-keys' ? args[0] : 'serve';
  const errors: ConfigError[] = [];
  if (command !== 'serve' && args.length > 1) errors.push({ variable: '命令行参数', expected: `${command} 之后不带其他参数` });
  const config = { version, command, ...collect({ argv: args, env, cwd, command }, errors) } as const;
  return { config, errors: version ? [] : errors };
}

/** 读取本进程的命令行参数与环境变量并解析：服务端只在此处读取二者 */
export function loadConfig(): ConfigResult {
  return parseConfig(process.argv.slice(2), process.env, process.cwd());
}

/** 服务启动日志（`server.start`）的内容：说明文字、实际监听的端口、支持的协议版本范围与数据库文件 */
export function startEntry(config: ServerConfig, ports: number[]) {
  const where = config.host ? `，地址 ${config.host}` : '';
  const latest = config.latest ? `，最新客户端 ${config.latest}` : '';
  return { msg: `弈 联机服务端已启动${where}${latest}`, ports, protoRange: [PROTO_VERSION, PROTO_VERSION], dbFile: config.dbFile };
}

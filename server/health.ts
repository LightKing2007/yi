/**
 * 健康检查 GET /healthz 与指标 GET /metrics（API-061）：只回应由本机直接发出的请求，经反向代理转来的外部请求不算（clientIp.ts）。/healthz 供上线脚本在重启前读取活跃对局数、
 * 重启后核对版本（OPS-045、OPS-046）；/metrics 为 Prometheus 文本格式的监控指标（OPS-071）。
 * 其他来源、其他方法与其他路径一律交给下一个处理者（下载页对白名单以外的路径返回 404）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PROTO_VERSION } from '../src/shared/protocol';
import { fromThisHost } from './clientIp';
import type { Health } from './rooms';

/** 同一端口上的普通网页请求的处理者 */
export type Web = (req: IncomingMessage, res: ServerResponse) => void;

/** 服务端的版本号与提交号（OPS-046 据此核对重启后的版本） */
export interface Build {
  version: string;
  commit: string;
}

/** 健康检查的路径 */
export const HEALTH_PATH = '/healthz';
/** 指标的路径 */
export const METRICS_PATH = '/metrics';
const HTTP_OK = 200;

/** 请求的路径；无法解析时为空串 */
function pathOf(url: string | undefined) {
  try {
    return new URL(url ?? '/', 'http://localhost').pathname;
  } catch {
    return '';
  }
}

/** 在 next 之前接上 /healthz 与（给出 metrics 时）/metrics；两者都在每次请求时读取 */
export function withHealth(build: Build, health: () => Health, next: Web, metrics?: () => string): Web {
  /** 本机请求的路径对应的回应：[内容类型, 内容]；不由这里回应时为 null */
  const local = (path: string): [string, string] | null => {
    if (path === HEALTH_PATH)
      return ['application/json; charset=utf-8', JSON.stringify({ version: build.version, commit: build.commit, proto: PROTO_VERSION, ...health() })];
    if (path === METRICS_PATH && metrics) return ['text/plain; version=0.0.4; charset=utf-8', metrics()];
    return null;
  };
  return (req, res) => {
    const reply = req.method === 'GET' && fromThisHost(req) ? local(pathOf(req.url)) : null;
    if (!reply) {
      next(req, res);
      return;
    }
    const [type, body] = reply;
    res.writeHead(HTTP_OK, {
      'Content-Type': type,
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  };
}

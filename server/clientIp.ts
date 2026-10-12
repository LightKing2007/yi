/**
 * 客户端的真实地址：服务端位于反向代理（Caddy，路线图第 6 章）之后时，经代理来的连接在服务端看来都来自本机，
 * 真实地址在代理加上的 X-Forwarded-For 中。只信任来自本机的这个头：直连的客户端可以随意伪造它。
 * 按 IP 的限制（API-040、API-041、下载并发）据 clientIp 计数；只回应本机的路径（API-061）据 fromThisHost 判断。
 */
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';

/** 本机地址；双栈监听时 IPv4 的本机请求以 IPv4 映射地址出现 */
const LOOPBACK: ReadonlySet<string> = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** 取地址所需的请求部分 */
type Source = Pick<IncomingMessage, 'socket' | 'headers'>;

/**
 * 请求的客户端地址：来自本机且带 X-Forwarded-For 时，取其中最后一项，即代理所见的对端地址
 * （更前面的各项由客户端自己填写，不可信）；最后一项不是合法的 IP 时，仍取连接的对端地址
 */
export function clientIp(req: Source): string {
  const peer = req.socket.remoteAddress ?? '';
  const raw = req.headers['x-forwarded-for'];
  if (!LOOPBACK.has(peer) || raw === undefined) return peer;
  const forwarded = Array.isArray(raw) ? raw.join(',') : raw;
  const last = forwarded.slice(forwarded.lastIndexOf(',') + 1).trim();
  return isIP(last) ? last : peer;
}

/** 请求是否由本机直接发出：对端是本机，且不带 X-Forwarded-For（带这个头的是经代理转来的外部请求） */
export function fromThisHost(req: Source): boolean {
  return LOOPBACK.has(req.socket.remoteAddress ?? '') && req.headers['x-forwarded-for'] === undefined;
}

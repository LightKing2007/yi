/** 账号接口测试夹具：真实 SQLite 与本机随机端口上的真实 HTTP，发信由测试显式触发；不连接外网。 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { withAccountApi, type AccountApiOptions } from '../server/accountApi';
import type { LogEntry } from '../server/log';
import { AuthenticationWorld } from './authenticationWorld';

/** 一次 HTTP 往返的结果 */
export interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  text: string;
  json: Record<string, unknown>;
}

/** 请求选项：body 为对象时按 JSON 发送，为字符串或 Buffer 时原样发送 */
export interface Ask {
  body?: unknown;
  headers?: Record<string, string>;
  token?: string;
}

/** 在认证夹具上接一个只含账号接口的 HTTP 服务器 */
export class AccountApiWorld extends AuthenticationWorld {
  readonly queued: string[] = [];
  readonly languages: string[] = [];
  readonly logs: { level: string; event: string; entry?: LogEntry }[] = [];
  readonly sourceKey = Buffer.alloc(32, 7);
  private server?: http.Server;
  private port = 0;

  /** 开始监听；options 覆盖默认装配 */
  async start(options: Partial<AccountApiOptions> = {}) {
    const web = withAccountApi((_req, res) => res.writeHead(418).end('next'), {
      auth: this.auth,
      codes: this.codes,
      required: { privacy: 'v1', terms: 'v1' },
      origins: ['app://yi'],
      sourceKey: this.sourceKey,
      queued: (id, language) => {
        this.queued.push(id);
        this.languages.push(language);
      },
      log: (level, event, entry) => this.logs.push({ level, event, entry }),
      ...options,
    });
    const server = http.createServer(web);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    this.server = server;
    this.port = (server.address() as AddressInfo).port;
    return this;
  }

  /** 发出一次请求并读完响应 */
  ask(method: string, path: string, opt: Ask = {}): Promise<Answer> {
    const raw = opt.body === undefined ? undefined : typeof opt.body === 'string' || Buffer.isBuffer(opt.body) ? opt.body : JSON.stringify(opt.body);
    const headers: Record<string, string> = { ...(raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opt.headers };
    if (raw !== undefined) headers['Content-Length'] = String(Buffer.byteLength(raw));
    if (opt.token) headers.Authorization = `Bearer ${opt.token}`;
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: this.port, method, path, headers }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: Record<string, unknown>;
          try {
            json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
          } catch {
            json = {};
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      });
      req.on('error', reject);
      req.end(raw);
    });
  }

  /** 申请并发出一封注册或重置验证码，返回表单所需的编号与验证码 */
  async mailed(email: string, purpose: 'register' | 'reset' = 'register') {
    const answer = await this.ask('POST', '/api/v1/email-codes', { body: { purpose, email } });
    const challengeId = String(answer.json.challengeId);
    await this.codes.deliver(challengeId);
    return { challengeId, code: '001234' };
  }

  /** 释放服务器与数据库 */
  async stop() {
    const server = this.server;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    this.close();
  }
}

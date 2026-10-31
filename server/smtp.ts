/**
 * 发验证码邮件的精简 SMTP 客户端（RFC 5321、RFC 4954）：经 465 端口的隐式 TLS 连接阿里云邮件推送，EHLO、认证、MAIL、RCPT、DATA、QUIT。
 * 只发一封纯文本邮件；不支持 STARTTLS、管线化与附件。服务器的回应原文不带出本模块，口令只出现在 AUTH 命令中，不写日志。
 */
import tls from 'node:tls';
import type { Duplex } from 'node:stream';
import { randomUUID } from 'node:crypto';
import type { CodeMail } from './emailCodes';
import { composeCodeMail, type Sender } from './codeMail';

/** 单条回应的字节上限；超过即视为异常的服务器 */
const REPLY_MAX_BYTES = 8192;
/** 投递成功后等服务器断开的最长时间 */
const QUIT_GRACE_MS = 5000;
/** 回应码的字符数 */
const CODE_DIGITS = 3;
/** 用到的回应码（RFC 5321 第 4.2 节、RFC 4954） */
const REPLY = { ready: 220, authenticated: 235, ok: 250, forwarded: 251, challenge: 334, sendData: 354 } as const;

/** 连接与认证所需的配置；口令由 root 写入服务器配置，不进入仓库 */
export interface SmtpOptions {
  host: string;
  port: number;
  username: string;
  password: string;
  from: Sender;
  /** 内嵌在邮件中的墨色“弈”字图（PNG） */
  image: Buffer;
  /** EHLO 中报出的本机名 */
  heloName: string;
  /** 建立连接；默认以隐式 TLS 连接并校验证书，测试中替换为明文的本机连接 */
  connect?: (opt: SmtpOptions) => Duplex;
  now?: () => Date;
  messageId?: () => string;
}

/** 发送失败；只带阶段与回应码，不带服务器原文 */
export class SmtpError extends Error {
  constructor(
    readonly stage: string,
    readonly code: number,
  ) {
    super(`smtp-${stage}-${code}`);
  }
}

/** 默认连接：TLS 1.2 及以上，校验证书与主机名 */
function connectTls(opt: SmtpOptions): Duplex {
  return tls.connect({ host: opt.host, port: opt.port, servername: opt.host, minVersion: 'TLSv1.2', rejectUnauthorized: true });
}

/** 按行读取回应：多行回应以“码-”续行、以“码 ”结束（RFC 5321 第 4.2.1 条） */
class Replies {
  private buffer = '';
  private waiting?: { resolve: (lines: string[]) => void; reject: (error: Error) => void };
  private failure?: Error;

  constructor(socket: Duplex) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > REPLY_MAX_BYTES) this.fail(new SmtpError('reply', 0));
      else this.flush();
    });
    socket.on('error', () => this.fail(new SmtpError('connection', 0)));
    socket.on('close', () => this.fail(new SmtpError('closed', 0)));
  }

  /** 等待下一条完整回应 */
  next(): Promise<string[]> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
      this.flush();
    });
  }

  /** 连接出错或中止：等待者以此失败 */
  fail(error: Error) {
    this.failure ??= error;
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting?.reject(this.failure);
  }

  private flush() {
    if (!this.waiting) return;
    const lines = this.buffer.split('\r\n');
    const end = lines.findIndex(line => /^\d{3}( |$)/.test(line));
    if (end < 0 || end === lines.length - 1) return;
    this.buffer = lines.slice(end + 1).join('\r\n');
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting.resolve(lines.slice(0, end + 1));
  }
}

/** 一次会话：发出命令并要求回应码属于 expected */
class Session {
  constructor(
    private readonly socket: Duplex,
    private readonly replies: Replies,
  ) {}

  async expect(stage: string, expected: readonly number[], command?: string): Promise<string[]> {
    if (command !== undefined) this.socket.write(`${command}\r\n`);
    const lines = await this.replies.next();
    const code = Number(lines[lines.length - 1]?.slice(0, CODE_DIGITS));
    if (!expected.includes(code)) throw new SmtpError(stage, code);
    return lines;
  }
}

/** EHLO 回应中宣告的认证方式 */
function mechanisms(lines: string[]): string[] {
  const auth = lines
    .map(line =>
      line
        .slice(CODE_DIGITS + 1)
        .trim()
        .toUpperCase(),
    )
    .find(line => line.startsWith('AUTH '));
  return auth ? auth.split(/\s+/).slice(1) : [];
}

/** 认证：优先 PLAIN，其次 LOGIN；都不支持时失败 */
async function authenticate(session: Session, offered: string[], opt: SmtpOptions) {
  const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64');
  if (offered.includes('PLAIN')) {
    await session.expect('auth', [REPLY.authenticated], `AUTH PLAIN ${b64(`\0${opt.username}\0${opt.password}`)}`);
    return;
  }
  if (!offered.includes('LOGIN')) throw new SmtpError('auth', 0);
  await session.expect('auth', [REPLY.challenge], 'AUTH LOGIN');
  await session.expect('auth', [REPLY.challenge], b64(opt.username));
  await session.expect('auth', [REPLY.authenticated], b64(opt.password));
}

/** 完整的一次投递 */
async function deliver(session: Session, mail: CodeMail, opt: SmtpOptions) {
  const message = composeCodeMail({
    to: mail.email,
    code: mail.code,
    purpose: mail.purpose,
    language: mail.language,
    image: opt.image,
    from: opt.from,
    date: (opt.now ?? (() => new Date()))(),
    messageId: (opt.messageId ?? (() => `<${randomUUID()}@${opt.from.address.split('@')[1]}>`))(),
  });
  await session.expect('greeting', [REPLY.ready]);
  const ehlo = await session.expect('ehlo', [REPLY.ok], `EHLO ${opt.heloName}`);
  await authenticate(session, mechanisms(ehlo), opt);
  await session.expect('mail', [REPLY.ok], `MAIL FROM:<${opt.from.address}>`);
  await session.expect('rcpt', [REPLY.ok, REPLY.forwarded], `RCPT TO:<${mail.email}>`);
  await session.expect('data', [REPLY.sendData], 'DATA');
  // 正文为 base64、头部不以点开头，无须点填充；结束标记单独一行
  await session.expect('message', [REPLY.ok], `${message}\r\n.`);
}

/**
 * 投递已确认后礼貌地结束会话：发出 QUIT 并半关闭，不等待回应，结果已定，不能因服务器迟迟不答而拖到发送时限
 * 被记为“结果不明”；服务器一直不断开时，QUIT_GRACE_MS 后强制断开，计时器不阻止进程退出
 */
function farewell(socket: Duplex) {
  socket.end('QUIT\r\n');
  const timer = setTimeout(() => socket.destroy(), QUIT_GRACE_MS);
  timer.unref();
  socket.once('close', () => clearTimeout(timer));
}

/** 验证码的发送适配器（EmailCodes 的 sender）：signal 中止时立即断开连接 */
export function smtpSender(opt: SmtpOptions): (mail: CodeMail, signal: AbortSignal) => Promise<void> {
  return async (mail, signal) => {
    if (signal.aborted) throw new SmtpError('aborted', 0);
    const socket = (opt.connect ?? connectTls)(opt);
    const replies = new Replies(socket);
    const abort = () => {
      replies.fail(new SmtpError('aborted', 0));
      socket.destroy();
    };
    signal.addEventListener('abort', abort, { once: true });
    try {
      await deliver(new Session(socket, replies), mail, opt);
    } catch (error) {
      socket.destroy();
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
    }
    farewell(socket);
  };
}

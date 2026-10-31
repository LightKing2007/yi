/** SMTP 客户端与验证码邮件：本机随机端口上按脚本回应的假 SMTP 服务器，逐条核对命令；不连接外网。 */
import net from 'node:net';
import { PassThrough } from 'node:stream';
import tls from 'node:tls';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { composeCodeMail } from '../server/codeMail';
import { codeHtml } from '../server/codeMailHtml';
import { mailText } from '../server/codeMailText';
import type { CodeMail } from '../server/emailCodes';
import { SmtpError, smtpSender, type SmtpOptions } from '../server/smtp';

/** 假服务器的一步：收到以 match 开头的命令后回应 reply；reply 为 null 时直接断开 */
type Step = [match: string, reply: string | null];
/** 墨色“弈”字图 */
const IMAGE = readFileSync(path.resolve(__dirname, '../server/assets/mail-yi.png'));

/** multipart/related 的各部分：头部与解码后的内容 */
function parts(message: string): { head: string; body: Buffer }[] {
  const boundary = /boundary="([^"]+)"/.exec(message)?.[1] ?? '';
  return message
    .split(`--${boundary}`)
    .slice(1, -1)
    .map(part => {
      const [head = '', body = ''] = part.replace(/^\r\n/, '').split('\r\n\r\n');
      return { head, body: Buffer.from(body, 'base64') };
    });
}

const servers: net.Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve));
});

/** 按脚本回应的假服务器；commands 记下收到的每条命令（DATA 之后的邮件整体记为一条） */
async function fake(greeting: string, steps: Step[], chunked = false) {
  const commands: string[] = [];
  const closed = { value: false };
  const waits: { count: number; resolve: () => void }[] = [];
  let ended = () => {};
  const gone = new Promise<void>(resolve => (ended = resolve));
  /** 收到第 count 条命令时完成 */
  const received = (count: number) => new Promise<void>(resolve => (commands.length >= count ? resolve() : waits.push({ count, resolve })));
  const server = net.createServer(socket => {
    const send = (text: string) => {
      if (!chunked) socket.write(text);
      else for (const char of text) socket.write(char);
    };
    send(greeting);
    let buffer = '';
    let inData = false;
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const end = inData ? buffer.indexOf('\r\n.\r\n') : buffer.indexOf('\r\n');
        if (end < 0) return;
        const command = buffer.slice(0, end);
        buffer = buffer.slice(end + (inData ? 5 : 2));
        commands.push(command);
        for (const wait of waits.filter(item => item.count <= commands.length)) wait.resolve();
        const step = steps.shift();
        if (!step || step[1] === null) {
          socket.destroy();
          return;
        }
        expect(command.startsWith(step[0])).toBe(true);
        inData = step[0] === 'DATA';
        send(step[1]);
      }
    });
    socket.on('close', () => {
      closed.value = true;
      ended();
    });
  });
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return { commands, closed, gone, received, port };
}

const options = (port: number, extra: Partial<SmtpOptions> = {}): SmtpOptions => ({
  host: 'smtpdm.example.com',
  port: 465,
  username: 'noreply@mail.example.com',
  password: 'fixture-pass',
  from: { address: 'noreply@mail.example.com', name: '弈' },
  heloName: 'yi.example.com',
  image: IMAGE,
  connect: () => net.connect(port, '127.0.0.1'),
  now: () => new Date(Date.UTC(2026, 10, 1, 8, 0, 0)),
  messageId: () => '<fixed@yi.example.com>',
  ...extra,
});
const mail: CodeMail = { email: 'player@example.com', code: '012345', purpose: 'register', challengeId: '0'.repeat(32), language: 'en-GB' };
const signal = () => new AbortController().signal;
const plain: Step[] = [
  ['EHLO yi.example.com', '250-smtpdm.example.com\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n'],
  ['AUTH PLAIN ', '235 ok\r\n'],
  ['MAIL FROM:<noreply@mail.example.com>', '250 ok\r\n'],
  ['RCPT TO:<player@example.com>', '250 ok\r\n'],
  ['DATA', '354 go\r\n'],
  ['From:', '250 queued\r\n'],
  ['QUIT', '221 bye\r\n'],
];

it('PLAIN 认证后投递一封邮件：命令顺序、口令编码与邮件内容逐项正确', async () => {
  const server = await fake('220 smtpdm ready\r\n', [...plain]);
  await smtpSender(options(server.port))(mail, signal());
  await server.received(7);
  expect(server.commands.map(line => line.split(' ')[0])).toEqual(['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'From:', 'QUIT']);
  expect(Buffer.from(String(server.commands[1]?.split(' ')[2]), 'base64').toString()).toBe('\0noreply@mail.example.com\0fixture-pass');
  const message = String(server.commands[5]);
  expect(message).toBe(
    composeCodeMail({
      to: 'player@example.com',
      code: '012345',
      purpose: 'register',
      language: 'en-GB',
      image: IMAGE,
      from: options(0).from,
      date: new Date(Date.UTC(2026, 10, 1, 8)),
      messageId: '<fixed@yi.example.com>',
    }),
  );
  const [html, image] = parts(message);
  expect(html?.body.toString('utf8')).toBe(codeHtml(mailText('en-GB', 'register'), '012345', 'cid:yi-glyph@yi.lightking.com.cn'));
  expect(image?.body.equals(IMAGE)).toBe(true);
});

it('服务器只提供 LOGIN 时分两步发送用户名与口令；回应可被任意拆分', async () => {
  const server = await fake(
    '220 ready\r\n',
    [
      ['EHLO', '250-hello\r\n250 AUTH LOGIN\r\n'],
      ['AUTH LOGIN', '334 VXNlcm5hbWU6\r\n'],
      [Buffer.from('noreply@mail.example.com').toString('base64'), '334 UGFzc3dvcmQ6\r\n'],
      [Buffer.from('fixture-pass').toString('base64'), '235 ok\r\n'],
      ...plain.slice(2),
    ],
    true,
  );
  await smtpSender(options(server.port))(mail, signal());
  const b64 = (text: string) => Buffer.from(text).toString('base64');
  expect(server.commands.slice(0, 4).map(line => line.split(' ')[0])).toEqual(['EHLO', 'AUTH', b64('noreply@mail.example.com'), b64('fixture-pass')]);
});

it('拒绝回应以阶段与回应码失败，错误中不含服务器原文与口令', async () => {
  const cases: [Step[], string, number][] = [
    [[plain[0] as Step, ['AUTH PLAIN', '535 secret-detail\r\n']], 'auth', 535],
    [[...plain.slice(0, 3), ['RCPT', '550 no such user\r\n']], 'rcpt', 550],
    [[...plain.slice(0, 5), ['From:', '554 rejected\r\n']], 'message', 554],
    [[['EHLO', '250-hi\r\n250 SIZE 100\r\n']], 'auth', 0],
  ];
  for (const [steps, stage, code] of cases) {
    const server = await fake('220 ready\r\n', steps);
    const error = await smtpSender(options(server.port))(mail, signal()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SmtpError);
    expect(error).toMatchObject({ stage, code });
    expect(String((error as Error).message)).not.toMatch(/secret|fixture-pass|no such/);
  }
  const unready = await fake('554 go away\r\n', []);
  await expect(smtpSender(options(unready.port))(mail, signal())).rejects.toMatchObject({ stage: 'greeting', code: 554 });
});

it('服务器中途断开、回应过长都失败；投递成功后 QUIT 无回应不影响结果', async () => {
  const dropped = await fake('220 ready\r\n', [plain[0] as Step, ['AUTH', null]]);
  await expect(smtpSender(options(dropped.port))(mail, signal())).rejects.toMatchObject({ stage: 'closed' });
  const flood = await fake(`220-${'x'.repeat(9000)}\r\n220 ready\r\n`, []);
  await expect(smtpSender(options(flood.port))(mail, signal())).rejects.toMatchObject({ stage: 'reply' });
  const dropped2 = await fake('220 ready\r\n', [...plain.slice(0, 6), ['QUIT', null]]);
  await expect(smtpSender(options(dropped2.port))(mail, signal())).resolves.toBeUndefined();
  // 服务器收下 QUIT 后既不回应也不断开：投递已确认，发送立即完成，不等到发送时限
  const silent = await fake('220 ready\r\n', [...plain.slice(0, 6), ['QUIT', '']]);
  await expect(smtpSender(options(silent.port))(mail, signal())).resolves.toBeUndefined();
  await silent.received(7);
  expect(silent.commands[6]).toBe('QUIT');
});

it('中止时立即断开连接并失败；已中止的信号不建立连接', async () => {
  const server = await fake('220 ready\r\n', [plain[0] as Step, ['AUTH', '']]);
  const controller = new AbortController();
  const sending = smtpSender(options(server.port))(mail, controller.signal);
  await server.received(2);
  controller.abort();
  await expect(sending).rejects.toMatchObject({ stage: 'aborted' });
  await server.gone;
  expect(server.closed.value).toBe(true);
  const connect = vi.fn(() => new PassThrough());
  const aborted = new AbortController();
  aborted.abort();
  await expect(smtpSender(options(0, { connect }))(mail, aborted.signal)).rejects.toMatchObject({ stage: 'aborted' });
  expect(connect).not.toHaveBeenCalled();
});

it('默认连接为隐式 TLS 1.2 以上并校验证书与主机名', async () => {
  const socket = new PassThrough();
  const connect = vi.spyOn(tls, 'connect').mockReturnValue(socket as unknown as tls.TLSSocket);
  const sending = smtpSender({ ...options(0), connect: undefined })(mail, signal());
  socket.end();
  await expect(sending).rejects.toBeInstanceOf(SmtpError);
  expect(connect).toHaveBeenCalledWith({
    host: 'smtpdm.example.com',
    port: 465,
    servername: 'smtpdm.example.com',
    minVersion: 'TLSv1.2',
    rejectUnauthorized: true,
  });
});

it('邮件为 HTML 与内嵌图片组成的 multipart/related：头部固定、各行不超过 76 字符，地址与编号经校验', () => {
  const letter = {
    to: 'player@example.com',
    code: '012345',
    purpose: 'reset' as const,
    language: 'zh-Hans' as const,
    image: IMAGE,
    from: { address: 'a@b.cn', name: '弈' },
    date: new Date(0),
    messageId: '<x@y>',
  };
  const message = composeCodeMail(letter);
  expect(message.split('\r\n\r\n')[0]?.split('\r\n')).toEqual([
    'From: =?UTF-8?B?5byI?= <a@b.cn>',
    'To: <player@example.com>',
    `Subject: =?UTF-8?B?${Buffer.from('弈 · 验证你的邮箱地址').toString('base64')}?=`,
    'Date: Thu, 01 Jan 1970 00:00:00 +0000',
    'Message-ID: <x@y>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; type="text/html"; boundary="yi-mail-part-boundary"',
  ]);
  expect(message.split('\r\n').every(line => line.length <= 120)).toBe(true);
  const [html, image] = parts(message);
  expect(html?.head).toBe('Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64');
  expect(image?.head).toBe(
    'Content-Type: image/png\r\nContent-Transfer-Encoding: base64\r\n' +
      'Content-ID: <yi-glyph@yi.lightking.com.cn>\r\nContent-Disposition: inline; filename="yi.png"',
  );
  const encoded = message.split('\r\n').filter(line => /^[A-Za-z0-9+/=]+$/.test(line));
  expect(encoded.length).toBeGreaterThan(10);
  expect(encoded.every(line => line.length <= 76)).toBe(true);
  expect(html?.body.toString()).toContain('请立即更改账号密码');
  expect(html?.body.toString()).toContain('src="cid:yi-glyph@yi.lightking.com.cn"');
  for (const to of ['a@b.cn\r\nBcc: x@y.cn', 'a b@c.cn', 'no-at']) expect(() => composeCodeMail({ ...letter, to })).toThrow('mail-address-invalid');
  expect(() => composeCodeMail({ ...letter, from: { address: 'a@b.cn>\r\nX: 1', name: '弈' } })).toThrow('mail-address-invalid');
  expect(() => composeCodeMail({ ...letter, code: '12345\r\n' })).toThrow('mail-code-invalid');
  expect(() => composeCodeMail({ ...letter, messageId: '<x@y>\r\nX: 1' })).toThrow('mail-id-invalid');
});

it('文案按语言与用途选取：注册可放心忽略，重置与更换邮箱提醒更改密码；有效期与验证码的实际期限一致', () => {
  expect(mailText('zh-Hans', 'register').warn).toContain('可以放心忽略');
  for (const purpose of ['reset', 'change'] as const) {
    expect(mailText('zh-Hans', purpose).warn).toContain('请立即更改账号密码');
    expect(mailText('lzh', purpose).warn).toContain('请速改密语');
    expect(mailText('en-GB', purpose).warn).toContain('change your account password immediately');
  }
  expect(mailText('zh-Hans', 'register').ttl).toContain('10 分钟内有效');
  expect(mailText('lzh', 'register').ttl).toContain('十分钟内有效');
  expect(mailText('en-GB', 'reset')).toMatchObject({ lang: 'en-GB', supportUrl: 'https://yi.lightking.com.cn/support' });
  expect(new Set(['register', 'reset', 'change'].map(purpose => mailText('lzh', purpose as 'register').lead)).size).toBe(3);
});

it('版式：顶部与正文只用固定文案，验证码在线条胶囊中居中，提醒与求助同一段并以逗号相接', () => {
  const html = codeHtml(mailText('zh-Hans', 'register'), '012345', 'cid:x');
  expect(html).toContain('<html lang="zh-Hans">');
  expect(codeHtml(mailText('lzh', 'register'), '012345', 'cid:x')).toContain('<html lang="zh-Hans">');
  expect(codeHtml(mailText('en-GB', 'register'), '012345', 'cid:x')).toContain('<html lang="en-GB">');
  expect(html).toMatch(
    /<table role="presentation" align="center"[^>]*><tr>\n<td style="border:1px solid rgba\(20,18,16,0.35\);border-radius:999px;[^"]*">012345<\/td>/,
  );
  expect(html).toContain('不会有任何账号因此被创建或更改，如果频繁收到类似邮件，请前往<a href="https://yi.lightking.com.cn/support"');
  expect(codeHtml(mailText('en-GB', 'register'), '012345', 'cid:x')).toContain('no account will be created or changed. If you keep receiving');
  expect(html).toContain('Copyright © 2026 LightKing。保留所有权利。你收到此邮件');
  expect(html.match(/src="cid:x"/g)).toHaveLength(1);
  expect(html).not.toMatch(/src="https?:/);
});

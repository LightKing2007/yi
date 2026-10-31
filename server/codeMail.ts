/**
 * 验证码邮件的组装（RFC 5322、RFC 2045、RFC 2047、RFC 2387）：主题、HTML 正文与内嵌的“弈”字图组成 multipart/related，
 * 只发 HTML、只用一种语言（项目所有者 2026-11-01 的决定；文案见 codeMailText.ts，版式见 codeMailHtml.ts）。
 * 各部分以 base64 传输，头部只含校验过的地址与固定文字。不含发送；协议在 smtp.ts。
 */
import type { CodePurpose } from './codeCredentials';
import { codeHtml } from './codeMailHtml';
import { mailText, type MailLanguage } from './codeMailText';

/** 正文 base64 每行的字符数（RFC 2045 第 6.8 节：不超过 76） */
const BASE64_LINE = 76;
/** 地址只接受规范化后的 ASCII 形式，杜绝头部注入 */
const ADDRESS = /^[\x21-\x7e]+@[\x21-\x7e]+$/;
const CODE = /^[0-9]{6}$/;
const MESSAGE_ID = /^<[\x21-\x3b\x3d\x3f-\x7e]+@[\x21-\x3b\x3d\x3f-\x7e]+>$/;
/** 分隔各部分的边界：含“-”，不会出现在 base64 内容中 */
const BOUNDARY = 'yi-mail-part-boundary';
/** 内嵌图片的 Content-ID */
const IMAGE_CID = 'yi-glyph@yi.lightking.com.cn';

/** 发件身份：地址为阿里云邮件推送中配置的发信地址 */
export interface Sender {
  address: string;
  name: string;
}

/** 生成一封邮件所需的内容；messageId 与 date 由调用者给出，便于测试固定；image 为墨色“弈”字图的 PNG */
export interface CodeLetter {
  to: string;
  code: string;
  purpose: CodePurpose;
  language: MailLanguage;
  from: Sender;
  date: Date;
  messageId: string;
  image: Buffer;
}

/** RFC 2047 的 base64 编码字（UTF-8） */
const encodedWord = (text: string) => `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;

/** 按 76 字符折行的 base64 */
function wrapped(data: Buffer): string {
  const raw = data.toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < raw.length; i += BASE64_LINE) lines.push(raw.slice(i, i + BASE64_LINE));
  return lines.join('\r\n');
}

/** 完整的邮件（头部与正文，以 CRLF 分行，不含 SMTP 的结束标记）；地址、验证码或编号不合格时抛出 */
export function composeCodeMail(letter: CodeLetter): string {
  for (const address of [letter.to, letter.from.address]) if (!ADDRESS.test(address)) throw new Error('mail-address-invalid');
  if (!CODE.test(letter.code)) throw new Error('mail-code-invalid');
  if (!MESSAGE_ID.test(letter.messageId)) throw new Error('mail-id-invalid');
  const text = mailText(letter.language, letter.purpose);
  const html = codeHtml(text, letter.code, `cid:${IMAGE_CID}`);
  return [
    `From: ${encodedWord(letter.from.name)} <${letter.from.address}>`,
    `To: <${letter.to}>`,
    `Subject: ${encodedWord(text.subject)}`,
    `Date: ${letter.date.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${letter.messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; type="text/html"; boundary="${BOUNDARY}"`,
    '',
    `--${BOUNDARY}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapped(Buffer.from(html, 'utf8')),
    `--${BOUNDARY}`,
    'Content-Type: image/png',
    'Content-Transfer-Encoding: base64',
    `Content-ID: <${IMAGE_CID}>`,
    'Content-Disposition: inline; filename="yi.png"',
    '',
    wrapped(letter.image),
    `--${BOUNDARY}--`,
  ].join('\r\n');
}

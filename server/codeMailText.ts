/**
 * 验证码邮件的文案（数据文件）：按玩家在游戏中选择的界面语言只用一种语言（项目所有者 2026-11-01 的要求），
 * 语言标记按 I18N-001（BCP 47）。中文与文言的标点、数字写法按 09-text-and-i18n.md，由 tests/text.test.ts 检查。
 */
import { CODE_TTL_MS, MINUTE_MS } from './authPolicy';
import type { CodePurpose } from './codeCredentials';

/** 邮件可用的语言，与游戏的三种界面语言一一对应 */
export const MAIL_LANGUAGES = ['zh-Hans', 'lzh', 'en-GB'] as const;
/** 邮件的语言 */
export type MailLanguage = (typeof MAIL_LANGUAGES)[number];
/** 未指明语言时使用中文 */
export const DEFAULT_MAIL_LANGUAGE: MailLanguage = 'zh-Hans';

/** 有效期的分钟数，与验证码的实际期限一致 */
const TTL_MINUTES = CODE_TTL_MS / MINUTE_MS;
/** 文言的数字以汉字书写（I18N-077）；有效期改动时须同步 */
const TTL_HAN = '十';
/** 版权年份，与官网页脚一致 */
const COPYRIGHT_YEAR = 2026;
const SITE = 'https://yi.lightking.com.cn';
/** 官网页脚中的源代码仓库 */
const GITHUB = 'https://github.com/LightKing2007/yi';

/** 版式所需的全部文字；support 为含链接的一句：[链接前, 链接文字, 链接后] */
export interface CodeMailText {
  lang: MailLanguage;
  subject: string;
  title: string;
  lead: string;
  ttl: string;
  warn: string;
  support: readonly [string, string, string];
  supportUrl: string;
  links: readonly (readonly [string, string])[];
  copyright: string;
  notice: string;
}

/** 某种语言下与用途无关的文字，以及各用途的说明 */
interface LanguageText extends Omit<CodeMailText, 'lang' | 'lead' | 'warn' | 'supportUrl'> {
  lead: Record<CodePurpose, string>;
  /** 注册时可以放心忽略；重置密码与更换邮箱涉及已有账号，提醒立即更改密码（项目所有者 2026-11-01 的要求） */
  warn: Record<CodePurpose, string>;
}

/** 各语言共用的链接地址，名称随语言 */
const linksOf = (home: string, download: string, legal: string) =>
  [
    [home, `${SITE}/`],
    [download, `${SITE}/download/`],
    [legal, `${SITE}/agreement`],
    ['GitHub', GITHUB],
  ] as const;

/** 英文说明的后一句，三种用途相同 */
const CONFIRM = ' Enter the code below on the original page to confirm that this address is yours.';

const TEXT: Record<MailLanguage, LanguageText> = {
  'zh-Hans': {
    subject: '弈 · 验证你的邮箱地址',
    title: '验证你的邮箱地址',
    lead: {
      register: '我们收到了一个使用此邮箱注册“弈”账号的请求。请在原页面输入下方的验证码，以确认这是你的邮箱。',
      reset: '我们收到了一个重置“弈”账号密码的请求，该账号使用此邮箱。请在原页面输入下方的验证码，以确认这是你的邮箱。',
      change: '我们收到了一个将“弈”账号的邮箱更换为此邮箱的请求。请在原页面输入下方的验证码，以确认这是你的邮箱。',
    },
    ttl: `此验证码 ${TTL_MINUTES} 分钟内有效，请勿转发或透露给他人。`,
    warn: {
      register: '如果这不是你本人的操作，可以放心忽略这封邮件，不会有任何账号因此被创建或更改。',
      reset: '如果这不是你本人的操作，请立即更改账号密码，以防他人未经允许登录你的账号。',
      change: '如果这不是你本人的操作，请立即更改账号密码，以防他人未经允许登录你的账号。',
    },
    support: ['如果频繁收到类似邮件，请前往', '支持页面', '获取帮助。'],
    links: linksOf('主页', '下载', '隐私政策与服务条款'),
    copyright: `Copyright © ${COPYRIGHT_YEAR} LightKing。保留所有权利。`,
    notice: '你收到此邮件，是因为该邮箱被用于“弈”的账号验证。这是一封自动发送的邮件，请勿直接回复。',
  },
  lzh: {
    subject: '弈 · 验君邮址',
    title: '验君邮址',
    lead: {
      register: '有人以此邮址请立“弈”之籍。请于原页输入下列验符，以证此邮址为君所有。',
      reset: '有人请重设“弈”籍之密语，其籍以此邮址立之。请于原页输入下列验符，以证此邮址为君所有。',
      change: '有人请以此邮址易“弈”籍之旧址。请于原页输入下列验符，以证此邮址为君所有。',
    },
    ttl: `此验符${TTL_HAN}分钟内有效，慎勿转示他人。`,
    warn: {
      register: '若非君所为，置之可也，无籍因此而立或改。',
      reset: '若非君所为，请速改密语，以防他人擅入君籍。',
      change: '若非君所为，请速改密语，以防他人擅入君籍。',
    },
    support: ['若屡得此类之函，请往', '相助之页', '求助。'],
    links: linksOf('主页', '下载', '隐私政策与服务条款'),
    copyright: `Copyright © ${COPYRIGHT_YEAR} LightKing。保留所有权利。`,
    notice: '君得此函，因此邮址用于“弈”籍之验。此函由枢纽自发，请勿复书。',
  },
  'en-GB': {
    subject: 'Yi · Verify your email address',
    title: 'Verify your email address',
    lead: {
      register: `We received a request to create a Yi account with this email address.${CONFIRM}`,
      reset: `We received a request to reset the password of the Yi account that uses this email address.${CONFIRM}`,
      change: `We received a request to change the email address of a Yi account to this one.${CONFIRM}`,
    },
    ttl: `This code is valid for ${TTL_MINUTES} minutes. Please do not forward it or share it with anyone.`,
    warn: {
      register: 'If you did not make this request, you can safely ignore this email; no account will be created or changed.',
      reset: 'If you did not make this request, please change your account password immediately to prevent anyone from signing in without your permission.',
      change: 'If you did not make this request, please change your account password immediately to prevent anyone from signing in without your permission.',
    },
    support: ['If you keep receiving emails like this, please visit the ', 'support page', ' for help.'],
    links: linksOf('Home', 'Download', 'Privacy Policy and Terms of Service'),
    copyright: `Copyright © ${COPYRIGHT_YEAR} LightKing. All rights reserved.`,
    notice: 'You are receiving this email because this address was used to verify a Yi account. This email was sent automatically; please do not reply to it.',
  },
};

/** 某种语言、某个用途的全部文字 */
export function mailText(language: MailLanguage, purpose: CodePurpose): CodeMailText {
  const text = TEXT[language];
  return { ...text, lang: language, lead: text.lead[purpose], warn: text.warn[purpose], supportUrl: `${SITE}/support` };
}

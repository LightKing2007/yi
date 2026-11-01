/**
 * 账号的界面状态（next-development.md 第 5 章批次 E）：把联机层的登录包装为信号，并给出界面所需的换算——邮件语言、错误提示、输入检查。
 * 协议第 4 版接通前入口默认关闭（批次 E 的验收项：未接通流程不提前开放入口），开发时以地址参数 ?accounts 打开。
 */
import { signal } from '@preact/signals';
import { AccountSession, type LoginState, type LoginStore } from '../online/account';
import { AccountApi, apiBase, type AccountProblem, type Fetcher, type MailLanguage } from '../online/accountApi';
import { ERRORS } from '../shared/errors';
import type { YiNative } from './native';
import { Lang } from './settings';

/** 当前登录；账号功能未开启时始终为未登录 */
export const account = signal<LoginState>({ saved: false });

/** 账号接口与登录；未开启时为 undefined */
let wired: { api: AccountApi; session: AccountSession } | undefined;

/** 是否打开账号入口：只在开发模式下、地址带 ?accounts 时打开 */
export function accountsWanted(search: string, dev: boolean): boolean {
  return dev && new URLSearchParams(search).has('accounts');
}

/** 开启账号功能：由联机地址推出接口地址，并恢复保存的登录；地址不合格时不开启，返回 false */
export function startAccounts(deps: { server: string; fetcher: Fetcher; store?: LoginStore }): boolean {
  const base = apiBase(deps.server);
  if (!base) return false;
  const api = new AccountApi(base, deps.fetcher);
  const session = new AccountSession(api, deps.store);
  session.onChange(state => {
    account.value = state;
  });
  wired = { api, session };
  // 恢复的结果经 onChange 反映到界面；接口调用不抛出异常（失败时返回错误码），读取保存的登录出错按未登录处理
  void session.restore();
  return true;
}

/** 账号接口与登录；未开启时为 undefined */
export const accounts = () => wired;

/** 桌面版的加密存储；浏览器中没有，登录只在本次运行中有效 */
export function loginStoreOf(yi: YiNative | undefined): LoginStore | undefined {
  if (!yi) return undefined;
  return { load: () => yi.loadLogin(), save: (token, expiresAt) => yi.saveLogin(token, expiresAt), clear: () => yi.clearLogin() };
}

/** 界面语言对应的邮件语言（I18N-001 的语言标记） */
export function mailLanguage(lang: Lang): MailLanguage {
  return lang === Lang.WY ? 'lzh' : lang === Lang.EN ? 'en-GB' : 'zh-Hans';
}

/** 请求格式错误时，服务端指明的字段对应的提示原文 */
const FIELD_TEXT: Record<string, string> = {
  email: '邮箱地址的格式不正确',
  password: '密码至少 8 位',
  name: '雅号不能为空，至多 16 个字',
  code: '验证码为 6 位数字',
};

/** 错误的提示原文（经 T() 显示）：字段格式错误按字段，错误码表中有的取表中原文，其余按服务器出现问题 */
export function problemText(problem: AccountProblem): string {
  const fieldText = problem.code === 'request.invalid' && problem.field ? FIELD_TEXT[problem.field] : undefined;
  if (fieldText) return fieldText;
  const known: Record<string, { text: string }> = ERRORS;
  return known[problem.code]?.text ?? ERRORS['server.internal'].text;
}

/** 密码的最短长度（Unicode 码点，与服务端一致） */
export const PASSWORD_MIN = 8;
/** 邮箱的最大长度（UTF-8 字节，与服务端一致） */
const EMAIL_MAX_BYTES = 254;
/** 验证码：6 位数字 */
export const CODE_LENGTH = 6;

/** 邮箱的粗略检查：只拦下明显写错的，规范化与最终判断以服务端为准 */
export function emailLooksValid(email: string): boolean {
  const trimmed = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && new TextEncoder().encode(trimmed).length <= EMAIL_MAX_BYTES;
}

/** 密码是否够长（按码点计数，原文不修剪） */
export const passwordLongEnough = (password: string) => [...password].length >= PASSWORD_MIN;

/** 验证码是否填满 */
export const codeComplete = (code: string) => new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);

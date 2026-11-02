/**
 * 账号的界面状态（next-development.md 第 5 章批次 E）：把联机层的登录包装为信号，并给出界面所需的换算——邮件语言、错误提示、输入检查。
 * 协议第 4 版起联机须登录，启动时即开启（protocol-v4.md 第 11 章 F4）。
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
/** 登录变化的通知（联机层据此断开以先前登录握手的连接；联机层不用界面状态库，经此登记） */
const loginListeners: (() => void)[] = [];

/** 登记登录变化的通知：开启账号功能后，登录、退出、令牌失效时调用 */
export function onLoginChange(listener: () => void) {
  loginListeners.push(listener);
}

/** 开启账号功能：由联机地址推出接口地址，并恢复保存的登录；地址不合格时不开启，返回 false。再次开启时（检查脚本换用替身）先前的登录不再影响界面 */
export function startAccounts(deps: { server: string; fetcher: Fetcher; store?: LoginStore }): boolean {
  const base = apiBase(deps.server);
  if (!base) return false;
  const api = new AccountApi(base, deps.fetcher);
  const session = new AccountSession(api, deps.store);
  session.onChange(state => {
    if (wired?.session !== session) return;
    account.value = state;
    for (const listener of loginListeners) listener();
  });
  wired = { api, session };
  // 恢复的结果经 onChange 反映到界面；接口调用不抛出异常（失败时返回错误码），读取保存的登录出错按未登录处理
  void session.restore();
  return true;
}

/** 启动时开启账号功能（协议第 4 版起联机须登录）：以全局的 fetch 访问账号接口，桌面版的登录存进加密存储（yi 为 yiNative） */
export function bootAccounts(server: string, yi: YiNative | undefined): boolean {
  const fetcher: Fetcher = (url, init) => fetch(url, init);
  return startAccounts({ server, fetcher, store: loginStoreOf(yi) });
}

/** 账号接口与登录；未开启时为 undefined */
export const accounts = () => wired;

/** 联机握手用的登录令牌；账号功能未开启或未登录时为 undefined */
export const loginToken = () => wired?.session.loginToken;

/** 联机被服务端以“登录已失效”断开：向账号接口重新取资料，令牌确已失效时随之回到未登录（界面显示登录门槛） */
export function loginRejected() {
  // 结果经 onChange 反映到界面；接口调用不抛出异常
  if (wired) void wired.session.refresh();
}

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

/** 密码的最大长度（UTF-8 字节，与服务端一致） */
const PASSWORD_MAX_BYTES = 1024;
/**
 * 密码输入框的码元上限：比最大字节数多一，超长的内容不会被悄悄截成合格的长度，而是由 passwordTooLong 指出。
 * 一个码元至少占一个 UTF-8 字节，所以合格的密码不会被截断
 */
export const PASSWORD_INPUT_MAX = PASSWORD_MAX_BYTES + 1;

/** 密码是否超过服务端接受的长度 */
export const passwordTooLong = (password: string) => new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES;

/** 密码是否合格：至少 8 个码点、至多 1024 个 UTF-8 字节（原文不修剪） */
export const passwordValid = (password: string) => [...password].length >= PASSWORD_MIN && !passwordTooLong(password);

/** 设置新密码时的提示原文：过长、两次不一致；没有问题时为空串（过短时按钮不可按，不另提示） */
export function newPasswordProblem(password: string, again: string): string {
  if (passwordTooLong(password)) return '密码过长';
  return again.length > 0 && again !== password ? '两次输入的密码不一致' : '';
}

/** 验证码是否填满 */
export const codeComplete = (code: string) => new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code);

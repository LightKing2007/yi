/**
 * 账号功能的装配（`YI_ACCOUNTS=1` 时由 serve.ts 调用）：用凭据目录中的密钥建立邮箱保护、验证码、认证与发信，
 * 启动时把上次中断的发送记为结果不明，定时清理过期的验证码、登录会话与限流记录，并给出账号接口与其限流响应。
 * 关闭时停止定时清理；进行中的发送由其自身的时限结束。
 */
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AccountConfig } from './accountConfig';
import { apiLimited, withAccountApi } from './accountApi';
import type { AccountSecrets } from './accountSecrets';
import { MINUTE_MS } from './authPolicy';
import { Authentication } from './authentication';
import { CodeCredentials } from './codeCredentials';
import { authPruner } from './db/authPrune';
import { EmailCodes, type CodeMail } from './emailCodes';
import { EmailProtection } from './emailProtection';
import type { Web } from './health';
import { tooManyRequests, type Limited } from './http';
import type { Log } from './log';
import { smtpSender } from './smtp';

/** 定时清理的间隔（分钟） */
const PRUNE_MINUTES = 10;
/** 定时清理的间隔 */
export const ACCOUNT_PRUNE_MS = PRUNE_MINUTES * MINUTE_MS;
/** 生产环境的桌面页面来源（账号接口契约第 2.4.2 条） */
const APP_ORIGIN = 'app://yi';
/** EHLO 中报出的本机名 */
const HELO_NAME = 'yi.lightking.com.cn';

/** 装配所需的依赖；sender 只在测试中替换 */
export interface AccountServiceDeps {
  config: AccountConfig;
  secrets: AccountSecrets;
  db: DatabaseSync;
  now: () => number;
  every: (ms: number, fn: () => void) => () => void;
  log?: Log;
  sender?: (mail: CodeMail, signal: AbortSignal) => Promise<void>;
}

/** 已装配的账号功能 */
export interface AccountService {
  /** 在 next 之前接上账号接口 */
  api: (next: Web) => Web;
  /** 按 IP 限流时的回应：账号接口用其错误格式，其他路径不变 */
  limited: Limited;
  /** 停止定时清理 */
  close: () => void;
}

/** 随邮件内嵌的墨色“弈”字图（构建时嵌入，见 scripts/build-node.mjs） */
const mailImage = () => Buffer.from(__MAIL_IMAGE__, 'base64');

/** 过期数据的定时清理：验证码挑战、登录会话与限流记录 */
function pruner(db: DatabaseSync, codes: EmailCodes, now: () => number) {
  const auth = authPruner(db);
  return () => {
    const at = now();
    codes.repo.prune(at);
    auth(at);
  };
}

/** 建立账号功能；密钥不合格时由各模块的构造函数抛出，调用者据此拒绝启动 */
export function startAccounts(deps: AccountServiceDeps): AccountService {
  const { config, secrets, db, now, log } = deps;
  const vault = new EmailProtection(secrets.email);
  const sender = deps.sender ?? smtpSender({ ...secrets.smtp, heloName: HELO_NAME, image: mailImage() });
  const codes = new EmailCodes(db, vault, new CodeCredentials(secrets.code), { globalPerMinute: config.codeBudget, sender, now });
  const required = { privacy: config.privacyVersion, terms: config.termsVersion };
  // 撤销通知暂无联机连接可断（协议第 4 版接入前），只记一行，不含账号或会话编号
  const auth = new Authentication(db, vault, codes, { required, now, onRevoke: () => log?.('info', 'auth.revoked', { msg: '登录会话已撤销' }) });
  const recovered = codes.repo.recover();
  const prune = pruner(db, codes, now);
  prune();
  const stop = deps.every(ACCOUNT_PRUNE_MS, prune);
  log?.('info', 'account.enabled', { msg: '账号功能已启用', recovered, privacy: required.privacy, terms: required.terms });
  const queued = (challengeId: string, language: CodeMail['language']) => {
    codes.deliver(challengeId, language).catch((err: unknown) => {
      log?.('error', 'internal.error', { msg: '验证码发送异常', errorId: randomUUID(), err });
    });
  };
  const origins = [APP_ORIGIN, ...(config.devOrigin ? [config.devOrigin] : [])];
  return {
    api: next => withAccountApi(next, { auth, codes, required, origins, sourceKey: secrets.source, queued, log }),
    limited: apiLimited(origins, tooManyRequests),
    close: stop,
  };
}

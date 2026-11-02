/**
 * 检查与压测用的测试账号：在临时数据库中注册账号并登录，输出各自的登录令牌。协议第 4 版的联机须登录（protocol-v4.md 第 3 章），
 * 界面文字排版检查（fit-check.cjs）、服务端压测（loadtest.mjs）与联机程序的集成测试（tests/serve.test.ts）都须先有账号。
 * 用与联机服务端相同的凭据目录（同一套密钥），验证码由本脚本截获，不发邮件。fast 为真时以固定格式的虚构密码散列代替真实派生
 * （压测要注册几百个账号；这些账号只经联机握手，从不以密码登录）。
 * 由 test-accounts.mjs 以 esbuild 打包后在 Node 中运行：node seed-accounts.cjs [--fast] <数据库文件> <凭据目录> <协议版本> <雅号>...
 */
import { loadAccountSecrets } from '../server/accountSecrets';
import { Authentication, type PasswordStore } from '../server/authentication';
import { CodeCredentials } from '../server/codeCredentials';
import { openDatabase } from '../server/db';
import { EmailCodes } from '../server/emailCodes';
import { EmailProtection } from '../server/emailProtection';

/** 注册时的来源标识的长度（十六进制位数）：只用于限流计数 */
const SOURCE_HEX = 64;
/** 测试账号的密码：至少 8 个码点 */
const PASSWORD = 'seeded-test-password';
/** 发送验证码的全局预算（每分钟）上限：注册的账号多于它时分批推进时钟 */
const CODE_BUDGET = 1000;
/** 同一来源的发码与密码派生都有限额：每个账号换一个来源标识，互不占用 */
const HEX_RADIX = 16;
const sourceOf = (i: number) => i.toString(HEX_RADIX).padStart(SOURCE_HEX, 'f');
/** 快速模式的虚构密码散列：格式合格（scrypt 参数与长度同 DAT-070），不对应任何密码 */
const SALT_BYTES = 16;
const HASH_BYTES = 64;
const FAKE_HASH = `scrypt$131072$8$1$${'0a'.repeat(SALT_BYTES)}$${'0b'.repeat(HASH_BYTES)}`;
const FAST: PasswordStore = { hash: async () => FAKE_HASH, verify: async () => false };

/** 注册 names 中的每个雅号并登录，返回登录令牌（与 names 同序）；agreement 为同意的协议版本（隐私政策与服务条款相同） */
export async function seedAccounts(opt: { dbFile: string; credentialsDir: string; agreement: string; names: string[]; fast?: boolean }): Promise<string[]> {
  const secrets = loadAccountSecrets(opt.credentialsDir);
  const db = openDatabase(opt.dbFile, { now: Date.now, appVersion: 'seed' });
  const vault = new EmailProtection(secrets.email);
  const sent = new Map<string, string>();
  const codes = new EmailCodes(db, vault, new CodeCredentials(secrets.code), {
    globalPerMinute: CODE_BUDGET,
    now: Date.now,
    sender: async mail => {
      sent.set(mail.challengeId, mail.code);
    },
  });
  const required = { privacy: opt.agreement, terms: opt.agreement };
  const auth = new Authentication(db, vault, codes, { required, now: Date.now, ...(opt.fast ? { passwords: FAST } : {}) });
  const tokens: string[] = [];
  try {
    for (const [i, name] of opt.names.entries()) {
      const email = `seeded-${i}@example.com`;
      const admission = codes.request({ email, purpose: 'register', sourceHash: sourceOf(i) });
      if (!('challengeId' in admission)) throw new Error(`账号 ${name} 的验证码申请被拒绝`);
      await codes.deliver(admission.challengeId);
      const code = sent.get(admission.challengeId);
      if (!code) throw new Error(`账号 ${name} 没有收到验证码`);
      const consent = { accepted: true, ...required };
      const signed = await auth.register({ name, email, password: PASSWORD, challengeId: admission.challengeId, code, consent, sourceHash: sourceOf(i) });
      tokens.push(signed.token);
    }
  } finally {
    db.close();
  }
  return tokens;
}

const args = process.argv.slice(2);
const fast = args[0] === '--fast';
const [dbFile, credentialsDir, agreement, ...names] = fast ? args.slice(1) : args;
if (process.argv[1]?.endsWith('seed-accounts.cjs') && dbFile && credentialsDir && agreement && names.length) {
  seedAccounts({ dbFile, credentialsDir, agreement, names, fast }).then(
    tokens => process.stdout.write(JSON.stringify(tokens)),
    (err: unknown) => {
      console.error(err);
      process.exit(1);
    },
  );
}

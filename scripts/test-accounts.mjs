/**
 * 检查与压测用的账号功能（fit-check.cjs、loadtest.mjs 共用）：协议第 4 版的联机须登录（protocol-v4.md 第 3 章）。
 * 在临时目录写入只用于本次运行的随机密钥与格式合格的发信配置（不发信），以 esbuild 打包 seed-accounts.ts 并在 Node 中运行，
 * 在 dbFile 中注册账号；返回打开账号功能所需的环境变量与各账号的登录令牌。
 */
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { rawText } from './raw-text.mjs';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
/** 服务端要求、测试账号注册时同意的协议版本（隐私政策与服务条款相同） */
const AGREEMENT_VERSION = 'test-run';
/** 一把 32 字节的随机密钥（base64），格式同 server/accountSecrets.ts */
const randomKey = () => crypto.randomBytes(32).toString('base64');
/** 在 dir 下写入账号功能的凭据，返回凭据目录 */
function writeCredentials(dir) {
  const credentials = path.join(dir, 'credentials');
  fs.mkdirSync(credentials, { mode: 0o700 });
  const keys = {
    emailEncryption: { current: 'run', keys: { run: randomKey() } },
    emailLookup: randomKey(),
    codeMac: { current: 'run', keys: { run: randomKey() } },
    source: randomKey(),
  };
  const smtp = { host: 'smtp.invalid', port: 465, username: 'run@example.com', password: 'unused', fromAddress: 'run@example.com', fromName: 'test-run' };
  fs.writeFileSync(path.join(credentials, 'yi-account-keys'), JSON.stringify(keys), { mode: 0o600 });
  fs.writeFileSync(path.join(credentials, 'yi-smtp'), JSON.stringify(smtp), { mode: 0o600 });
  return credentials;
}

/**
 * 在 dbFile（尚未被服务端打开）中注册 names 中的账号；tmp 为放凭据与打包结果的临时目录，fast 为真时不做真实密码派生。
 * 返回 { env, tokens }：env 为启动服务端时加上的环境变量，tokens 与 names 同序
 */
export async function prepareAccounts({ tmp, dbFile, names, fast = false }) {
  const credentials = writeCredentials(tmp);
  const bundle = path.join(tmp, 'seed-accounts.cjs');
  await build({
    entryPoints: [path.join(ROOT, 'scripts/seed-accounts.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'error',
    plugins: [rawText],
  });
  const args = [bundle, ...(fast ? ['--fast'] : []), dbFile, credentials, AGREEMENT_VERSION, ...names];
  // 以 node 运行：fit-check.cjs 在 Electron 中，process.execPath 是 Electron 本身
  const tokens = JSON.parse(execFileSync('node', args, { encoding: 'utf8', maxBuffer: 1 << 24 }));
  const env = { YI_ACCOUNTS: '1', YI_PRIVACY_VERSION: AGREEMENT_VERSION, YI_TERMS_VERSION: AGREEMENT_VERSION, CREDENTIALS_DIRECTORY: credentials };
  return { env, tokens };
}

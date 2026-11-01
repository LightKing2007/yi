/** 账号功能的配置与凭据（accountConfig.ts、accountSecrets.ts）：开关默认关闭、必填项、凭据格式、错误不带出密钥内容。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { parseAccountConfig } from '../server/accountConfig';
import { AccountSecretsError, KEYS_CREDENTIAL, loadAccountSecrets, newAccountKeys, SMTP_CREDENTIAL } from '../server/accountSecrets';
import { parseConfig } from '../server/config';

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-creds-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true }));

/** 按名称写一份 JSON 凭据 */
const put = (name: string, value: unknown) => fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
/** 固定的虚构密钥：第 n 把为 32 个字节 n */
const key = (n: number) => Buffer.alloc(32, n).toString('base64');
const keys = () => ({
  emailEncryption: { current: 'k1', keys: { k1: key(1), k0: key(2) } },
  emailLookup: key(3),
  codeMac: { current: 'k1', keys: { k1: key(4) } },
  source: key(5),
});
const smtp = () => ({
  host: 'smtpdm.aliyun.com',
  port: 465,
  username: 'noreply@mail.example.com',
  password: 'fixture-smtp',
  fromAddress: 'noreply@mail.example.com',
  fromName: '弈',
});
const ON = { YI_ACCOUNTS: '1', YI_PRIVACY_VERSION: '2026-11-01', YI_TERMS_VERSION: '1.0', CREDENTIALS_DIRECTORY: '/run/credentials/yi.service' };
const failures = (env: Record<string, string>) => {
  const list: string[] = [];
  const config = parseAccountConfig(env, variable => list.push(variable));
  return { config, list };
};

it('开关默认关闭，其余各项不检查；只认 0 与 1', () => {
  expect(failures({})).toEqual({ config: undefined, list: [] });
  expect(failures({ YI_ACCOUNTS: '0', YI_CODE_BUDGET: 'x' })).toEqual({ config: undefined, list: [] });
  expect(failures({ YI_ACCOUNTS: 'yes' }).list).toEqual(['YI_ACCOUNTS']);
  expect(parseConfig([], {}, '/srv').config.accounts).toBeUndefined();
});

it('打开时须给出两份协议版本与凭据目录；预算与开发来源有默认值并校验格式', () => {
  expect(failures(ON)).toEqual({
    config: { privacyVersion: '2026-11-01', termsVersion: '1.0', credentialsDir: ON.CREDENTIALS_DIRECTORY, codeBudget: 30, devOrigin: undefined },
    list: [],
  });
  expect(failures({ YI_ACCOUNTS: '1' }).list).toEqual(['YI_PRIVACY_VERSION', 'YI_TERMS_VERSION', 'CREDENTIALS_DIRECTORY']);
  expect(failures({ ...ON, YI_TERMS_VERSION: 'v 1', CREDENTIALS_DIRECTORY: 'relative' }).list).toEqual(['YI_TERMS_VERSION', 'CREDENTIALS_DIRECTORY']);
  expect(failures({ ...ON, YI_CODE_BUDGET: '1000' }).config?.codeBudget).toBe(1000);
  for (const budget of ['0', '1001', '1.5', '-1', '']) expect(failures({ ...ON, YI_CODE_BUDGET: budget }).list).toEqual(['YI_CODE_BUDGET']);
  expect(failures({ ...ON, YI_DEV_ORIGIN: 'http://localhost:5173' }).config?.devOrigin).toBe('http://localhost:5173');
  for (const origin of ['https://localhost:5173', 'http://evil.example:5173', 'http://localhost', '*']) {
    expect(failures({ ...ON, YI_DEV_ORIGIN: origin }).list).toEqual(['YI_DEV_ORIGIN']);
  }
  expect(parseConfig([], { ...ON, YI_ACCOUNTS: '1', YI_PRIVACY_VERSION: '' }, '/srv').errors.map(item => item.variable)).toEqual(['YI_PRIVACY_VERSION']);
  expect(parseConfig(['backup'], { YI_ACCOUNTS: '1' }, '/srv').errors).toEqual([]);
});

it('account-keys 命令不监听端口、不解析账号配置，之后不带参数', () => {
  expect(parseConfig(['account-keys'], { YI_ACCOUNTS: '1' }, '/srv')).toMatchObject({ config: { command: 'account-keys', accounts: undefined }, errors: [] });
  expect(parseConfig(['account-keys', '9'], {}, '/srv').errors).toEqual([{ variable: '命令行参数', expected: 'account-keys 之后不带其他参数' }]);
});

it('合格的两份凭据装成密钥环与发信配置', () => {
  put(KEYS_CREDENTIAL, keys());
  put(SMTP_CREDENTIAL, smtp());
  const secrets = loadAccountSecrets(dir);
  expect(secrets.email.currentKeyId).toBe('k1');
  expect([...secrets.email.encryption.keys()]).toEqual(['k1', 'k0']);
  expect(secrets.email.lookup.equals(Buffer.alloc(32, 3))).toBe(true);
  expect([...secrets.code.keys.keys()]).toEqual(['k1']);
  expect(secrets.source.equals(Buffer.alloc(32, 5))).toBe(true);
  expect(secrets.smtp).toEqual({
    host: 'smtpdm.aliyun.com',
    port: 465,
    username: 'noreply@mail.example.com',
    password: 'fixture-smtp',
    from: { address: 'noreply@mail.example.com', name: '弈' },
  });
});

it('缺失、不是 JSON 或任一字段不合格时拒绝，错误只有凭据名与期望格式', () => {
  const problems = () => {
    try {
      loadAccountSecrets(dir);
    } catch (error) {
      if (error instanceof AccountSecretsError) return error.problems.map(item => item.credential);
      throw error;
    }
    return [];
  };
  expect(problems()).toEqual([KEYS_CREDENTIAL, SMTP_CREDENTIAL]);
  put(KEYS_CREDENTIAL, '{not json');
  put(SMTP_CREDENTIAL, smtp());
  expect(problems()).toEqual([KEYS_CREDENTIAL]);
  const badKeys = [
    { ...keys(), source: key(3) },
    { ...keys(), emailLookup: Buffer.alloc(16, 9).toString('base64') },
    { ...keys(), codeMac: { current: 'k2', keys: { k1: key(4) } } },
    { ...keys(), codeMac: { current: 'k1', keys: {} } },
    { ...keys(), emailEncryption: { current: 'k 1', keys: { 'k 1': key(1) } } },
    { ...keys(), source: undefined },
  ];
  for (const value of badKeys) {
    put(KEYS_CREDENTIAL, value);
    expect(problems()).toEqual([KEYS_CREDENTIAL]);
  }
  put(KEYS_CREDENTIAL, keys());
  const badSmtp = [
    { ...smtp(), port: 0 },
    { ...smtp(), port: '465' },
    { ...smtp(), host: 'smtp dm' },
    { ...smtp(), password: 'a\r\nRCPT TO:<x@y>' },
    { ...smtp(), password: '' },
    { ...smtp(), fromAddress: 'a@b>\r\nX: 1' },
    { ...smtp(), fromName: '弈\r\nBcc: x@y' },
    { ...smtp(), username: undefined },
  ];
  for (const value of badSmtp) {
    put(SMTP_CREDENTIAL, value);
    expect(problems()).toEqual([SMTP_CREDENTIAL]);
  }
  put(SMTP_CREDENTIAL, { ...smtp(), password: 'leak-me' });
  put(KEYS_CREDENTIAL, { ...keys(), source: key(3) });
  const error: unknown = (() => {
    try {
      loadAccountSecrets(dir);
    } catch (caught) {
      return caught;
    }
    return undefined;
  })();
  expect(error).toBeInstanceOf(AccountSecretsError);
  expect(JSON.stringify(error) + String(error)).not.toMatch(/leak-me|fixture-smtp|AwMD/);
});

it('新生成的密钥每次不同、各把互不相同，可直接作为凭据读入', () => {
  const first = newAccountKeys();
  expect(newAccountKeys()).not.toBe(first);
  put(KEYS_CREDENTIAL, first);
  put(SMTP_CREDENTIAL, smtp());
  const secrets = loadAccountSecrets(dir);
  const all = [...secrets.email.encryption.values(), secrets.email.lookup, ...secrets.code.keys.values(), secrets.source].map(item => item.toString('hex'));
  expect(new Set(all).size).toBe(4);
});

/** 异地加密备份（scripts/offsite.ts，DAT-061、DAT-063）：OSS V4 签名、对象名、备份的选取与核对、加密与上传 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkOutside, decrypt, keygen, latestBackup, objectKeys, ossError, putObject, readConfig, signV4, upload } from '../scripts/offsite';
import { must } from './must';

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-offsite-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const md5 = (data: Uint8Array) => createHash('md5').update(data);
/** 写一份备份及其 .sha256；sum 给定时写入该值（模拟不符） */
function backup(stamp: string, text: string, sum?: string) {
  const name = `yi-ratings-${stamp}.json`;
  fs.writeFileSync(path.join(dir, name), text);
  fs.writeFileSync(path.join(dir, name + '.sha256'), `${sum ?? createHash('sha256').update(text).digest('hex')}  ${name}\n`);
}
const CONFIG = { bucket: 'yi-backup-test', region: 'cn-hangzhou', accessKeyId: 'LTAItestkey0001', accessKeySecret: 'secretsecretsecret01' };

describe('OSS V4 签名', () => {
  it('与阿里云 OSS Go SDK v2 的测试向量一致（TestV4AuthHeader）', () => {
    const headers = signV4({
      method: 'PUT',
      bucket: 'bucket',
      key: '1234+-/123/1.txt',
      query: { param1: 'value1', '+param1': 'value3', '|param1': 'value4', '+param2': '', '|param2': '', param2: '' },
      headers: { 'x-oss-head1': 'value', abc: 'value', ZAbc: 'value', XYZ: 'value', 'content-type': 'text/plain' },
      config: { region: 'cn-hangzhou', accessKeyId: 'ak', accessKeySecret: 'sk' },
      time: new Date(1702743657 * 1000),
    });
    expect(headers.authorization).toBe(
      'OSS4-HMAC-SHA256 Credential=ak/20231216/cn-hangzhou/oss/aliyun_v4_request,Signature=e21d18daa82167720f9b1047ae7e7f1ce7cb77a31e8203a7d5f4624fa0284afe',
    );
    expect([headers['x-oss-date'], headers['x-oss-content-sha256']]).toEqual(['20231216T162057Z', 'UNSIGNED-PAYLOAD']);
  });
});

describe('OSS V4 签名覆盖的请求头', () => {
  const sign = (headers: Record<string, string>) =>
    signV4({ method: 'PUT', bucket: 'b', key: 'k', headers, config: { region: 'cn-hangzhou', accessKeyId: 'ak', accessKeySecret: 'sk' }, time: new Date(0) })
      .authorization;
  it('Content-MD5 计入签名：内容不同则签名不同', () => {
    expect(sign({ 'Content-MD5': 'AAAA' })).not.toBe(sign({ 'Content-MD5': 'BBBB' }));
  });
  it('请求头的值去掉首尾空格后再签名', () => {
    expect(sign({ 'Content-MD5': '  AAAA ' })).toBe(sign({ 'Content-MD5': 'AAAA' }));
  });
});

describe('备份的选取与对象名', () => {
  it('取最新的一份并核对 .sha256；对象名为日备与当月的月备', () => {
    backup('20261003T203000Z', '{"old":1}');
    backup('20261004T203000Z', '{"new":1}');
    const found = latestBackup(dir);
    expect([path.basename(found.file), String(found.data)]).toEqual(['yi-ratings-20261004T203000Z.json', '{"new":1}']);
    expect(objectKeys(found.file)).toEqual(['daily/yi-ratings-20261004T203000Z.json.age', 'monthly/yi-ratings-202610.json.age']);
  });

  it('最新的一份与 .sha256 不符、或没有备份时抛出', () => {
    expect(() => latestBackup(dir)).toThrow('中没有备份');
    backup('20261004T203000Z', '{"a":1}', '0'.repeat(64));
    expect(() => latestBackup(dir)).toThrow('与其 .sha256 不符');
  });
});

describe('配置', () => {
  const env = {
    YI_OSS_BUCKET: 'yi-backup-test',
    YI_OSS_REGION: 'cn-hangzhou',
    YI_OSS_ACCESS_KEY_ID: 'LTAItestkey0001',
    YI_OSS_ACCESS_KEY_SECRET: 'secretsecretsecret01',
    YI_AGE_RECIPIENT: 'age1' + 'q'.repeat(58),
  };
  it('逐项校验，指明哪一项不对', () => {
    expect(readConfig(env)).toMatchObject({ bucket: 'yi-backup-test', backupDir: '/var/lib/yi/backup' });
    expect(() => readConfig({ ...env, YI_OSS_BUCKET: 'Bad_Bucket' })).toThrow('YI_OSS_BUCKET');
    expect(() => readConfig({ ...env, YI_OSS_REGION: 'oss-cn-hangzhou.aliyuncs.com' })).toThrow('YI_OSS_REGION');
    expect(() => readConfig({ ...env, YI_AGE_RECIPIENT: 'AGE-SECRET-KEY-1XYZ' })).toThrow('YI_AGE_RECIPIENT');
    expect(() => readConfig({ ...env, YI_OSS_ACCESS_KEY_SECRET: undefined })).toThrow('YI_OSS_ACCESS_KEY_SECRET');
  });
});

type Sent = { url: string; headers: Record<string, string>; body: Uint8Array };
/** 假的 OSS：记下请求；etag 为 null 时按请求体的 MD5 回应 */
const fakeOss = (sent: Sent[], status = 200, etag: string | null = null) =>
  (async (url: string, init: { headers: Record<string, string>; body: Uint8Array }) => {
    sent.push({ url, headers: init.headers, body: init.body });
    return {
      status,
      text: async () => '<Error><Code>AccessDenied</Code><RequestId>R1</RequestId></Error>',
      headers: { get: () => `"${etag ?? md5(init.body).digest('hex').toUpperCase()}"` },
    };
  }) as Parameters<typeof putObject>[3]['fetch'];
const now = () => new Date('2026-10-04T20:31:00Z');

describe('上传', () => {
  it('加密最新的一份后上传日备与月备，带 Content-MD5 与签名；以私钥解密得到原文', async () => {
    backup('20261004T203000Z', '{"abc":{"gomoku":{"points":1200}}}');
    const identity = await generateIdentity();
    const sent: Sent[] = [];
    const env = {
      YI_OSS_BUCKET: CONFIG.bucket,
      YI_OSS_REGION: CONFIG.region,
      YI_OSS_ACCESS_KEY_ID: CONFIG.accessKeyId,
      YI_OSS_ACCESS_KEY_SECRET: CONFIG.accessKeySecret,
      YI_AGE_RECIPIENT: await identityToRecipient(identity),
      YI_BACKUP_DIR: dir,
    };
    const line = await upload(env, { fetch: fakeOss(sent), now });
    expect(line).toMatch(/^<6>异地备份已上传：yi-ratings-20261004T203000Z\.json/);
    expect(sent.map(req => req.url)).toEqual([
      'https://yi-backup-test.oss-cn-hangzhou.aliyuncs.com/daily/yi-ratings-20261004T203000Z.json.age',
      'https://yi-backup-test.oss-cn-hangzhou.aliyuncs.com/monthly/yi-ratings-202610.json.age',
    ]);
    for (const req of sent) {
      expect(req.headers['content-md5']).toBe(md5(req.body).digest('base64'));
      expect(req.headers.authorization).toMatch(
        /^OSS4-HMAC-SHA256 Credential=LTAItestkey0001\/20261004\/cn-hangzhou\/oss\/aliyun_v4_request,Signature=[0-9a-f]{64}$/,
      );
      expect(String(Buffer.from(req.body)).includes('gomoku')).toBe(false); // 上传的是密文
      expect(await decrypt(req.body, identity)).toBe('{"abc":{"gomoku":{"points":1200}}}');
    }
  });

  it('OSS 返回非 200 或 ETag 与内容不符时失败', async () => {
    const body = new Uint8Array([1, 2, 3]);
    await expect(putObject(CONFIG, 'daily/x.age', body, { fetch: fakeOss([], 403), now })).rejects.toThrow(/HTTP 403 Code=AccessDenied$/);
    await expect(putObject(CONFIG, 'daily/x.age', body, { fetch: fakeOss([], 200, 'ABCDEF'), now })).rejects.toThrow('ETag 不符');
    await expect(putObject(CONFIG, 'daily/x.age', body, { fetch: fakeOss([]), now })).resolves.toBeUndefined();
  });

  it('用别的私钥无法解密；解出的内容不是 JSON 时失败', async () => {
    backup('20261004T203000Z', 'not json');
    const [mine, other] = [await generateIdentity(), await generateIdentity()];
    const sent: Sent[] = [];
    const env = {
      YI_OSS_BUCKET: CONFIG.bucket,
      YI_OSS_REGION: CONFIG.region,
      YI_OSS_ACCESS_KEY_ID: CONFIG.accessKeyId,
      YI_OSS_ACCESS_KEY_SECRET: CONFIG.accessKeySecret,
      YI_AGE_RECIPIENT: await identityToRecipient(mine),
      YI_BACKUP_DIR: dir,
    };
    await upload(env, { fetch: fakeOss(sent), now });
    const body = must(sent[0], '上传的请求').body;
    await expect(decrypt(body, other)).rejects.toThrow();
    await expect(decrypt(body, mine)).rejects.toThrow(SyntaxError);
  });
});

describe('OSS 的错误回应', () => {
  it('取出错误码、说明与拒绝原因明细（子字段写成“名称=值”），不含 RequestId', () => {
    const body = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Error>',
      '  <Code>AccessDenied</Code>',
      '  <Message>You have no right to access this object because of bucket acl.</Message>',
      '  <RequestId>6AC399F429E31A3338EA1B23</RequestId>',
      '  <AccessDeniedDetail>',
      '    <AuthPrincipalType>SubUser</AuthPrincipalType>',
      '    <AuthAction>oss:PutObject</AuthAction>',
      '    <PolicyType>AccountLevelIdentityBasedPolicy</PolicyType>',
      '  </AccessDeniedDetail>',
      '</Error>',
    ].join('\n');
    expect(ossError(body)).toBe(
      'Code=AccessDenied；Message=You have no right to access this object because of bucket acl.；' +
        'AccessDeniedDetail=AuthPrincipalType=SubUser AuthAction=oss:PutObject PolicyType=AccountLevelIdentityBasedPolicy',
    );
  });

  it('不是错误文档时取原文的前 300 个字符', () => {
    expect(ossError('x'.repeat(400))).toBe('x'.repeat(300));
    expect(ossError('<Error><Code></Code></Error>')).toBe('<Error><Code></Code></Error>');
  });
});

describe('密钥', () => {
  it('keygen 把私钥写入文件（权限 600、不覆盖），返回对应的公钥', async () => {
    const file = path.join(dir, 'key.txt');
    const recipient = await keygen(file);
    const identity = fs.readFileSync(file, 'utf8').trim();
    expect(identity).toMatch(/^AGE-SECRET-KEY-1/);
    expect(await identityToRecipient(identity)).toBe(recipient);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    await expect(keygen(file)).rejects.toThrow('EEXIST');
  });
});

describe('本机写出的文件须在项目目录以外', () => {
  const root = path.join(dir || os.tmpdir(), 'project');
  it('项目目录内（含根目录本身与相对路径）一律拒绝，目录以外与名字相近的兄弟目录允许', () => {
    // 项目中名为 ..foo 的目录仍在项目内；项目的上一级目录本身在项目外
    for (const inside of [root, path.join(root, 'restored.json'), path.join(root, 'a', '..', 'key.txt'), path.join(root, '..foo', 'key.txt')])
      expect(() => checkOutside(inside, root)).toThrow('在项目目录内');
    for (const outside of [path.join(root, '..', 'restored.json'), path.dirname(root), path.join(root + '-other', 'key.txt'), '/tmp/key.txt'])
      expect(() => checkOutside(outside, root)).not.toThrow();
  });

  it('命令行的 keygen 与 decrypt 写到项目目录内时拒绝，不留下文件', () => {
    const script = path.resolve(__dirname, '../scripts/offsite.ts');
    const project = path.resolve(__dirname, '..');
    const name = `offsite-test-${process.pid}.txt`;
    for (const args of [
      ['keygen', name],
      ['decrypt', 'x.age', 'key.txt', name],
    ]) {
      const result = spawnSync(process.execPath, [script, ...args], { cwd: project, encoding: 'utf8' });
      const left = fs.existsSync(path.join(project, name));
      fs.rmSync(path.join(project, name), { force: true }); // 检查失效时也不在仓库中留下文件
      expect([result.status, result.stderr, left]).toEqual([1, expect.stringContaining('在项目目录内'), false]);
    }
  });

  it('相对路径按当前目录解析：在项目根目录执行时，写相对路径即被拒绝', () => {
    const cwd = process.cwd();
    expect(() => checkOutside('restored.json', cwd)).toThrow('在项目目录内');
    expect(() => checkOutside('../restored.json', cwd)).not.toThrow();
  });
});

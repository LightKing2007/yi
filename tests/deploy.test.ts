/**
 * 上线脚本按 SHA256SUMS 核对下载的文件（OPS-031）：scripts/deploy.sh 的 verify_sums，以 sh 实际执行；
 * 以及各 shell 脚本中变量的写法
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = path.resolve(__dirname, '../scripts/deploy.sh');
const FILES = { 'Yi-2.0.5-win-x64-setup.exe': 'windows', 'Yi-2.0.5-mac-arm64.dmg': 'mac', 'yi-server-2.0.5.cjs': 'server' };

let dir = '';

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** 在 dir 中写入文件；sums 为写进 SHA256SUMS 的行（文件名 → 内容） */
function prepare(files: Record<string, string>, sums: Record<string, string> | null) {
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  if (sums)
    fs.writeFileSync(
      path.join(dir, 'SHA256SUMS'),
      Object.entries(sums)
        .map(([name, text]) => `${sha256(text)}  ${name}\n`)
        .join(''),
    );
}
/** 载入上线脚本中的函数后执行 verify_sums，返回退出码与错误输出 */
function verify() {
  try {
    execFileSync('sh', ['-c', `. "${SCRIPT}" && verify_sums "$1"`, 'sh', dir], { env: { ...process.env, YI_DEPLOY_LIB: '1' }, stdio: 'pipe' });
    return { code: 0, stderr: '' };
  } catch (err) {
    const failed = err as { status: number; stderr: Buffer };
    return { code: failed.status, stderr: String(failed.stderr) };
  }
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-deploy-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('上线脚本核对 SHA256SUMS', () => {
  it('安装程序与服务端都与 SHA256SUMS 一致时通过；SHA256SUMS 中另有本次未下载的文件（软件物料清单）不影响', () => {
    prepare(FILES, { ...FILES, 'yi-sbom-2.0.5.cdx.json': 'sbom' });
    expect(verify()).toEqual({ code: 0, stderr: '' });
  });

  it('某个文件的内容与 SHA256SUMS 不符时失败，并指出是哪个文件', () => {
    prepare({ ...FILES, 'Yi-2.0.5-mac-arm64.dmg': 'tampered' }, FILES);
    const result = verify();
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain(`Yi-2.0.5-mac-arm64.dmg 的 SHA-256 不符：应为 ${sha256('mac')}，实为 ${sha256('tampered')}`);
  });

  it('下载的文件不在 SHA256SUMS 中时失败', () => {
    prepare(FILES, Object.fromEntries(Object.entries(FILES).filter(([name]) => name !== 'yi-server-2.0.5.cjs')));
    const result = verify();
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('SHA256SUMS 中没有 yi-server-2.0.5.cjs');
  });

  it('没有 SHA256SUMS 时失败', () => {
    prepare(FILES, null);
    const result = verify();
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('没有 SHA256SUMS');
  });
});

/** 以 $ 加变量名引用、且后面紧跟非 ASCII 字符的位置：文件名:行号 */
function bareBeforeNonAscii(file: string) {
  return fs
    .readFileSync(path.resolve(__dirname, '..', file), 'utf8')
    .split('\n')
    .flatMap((line, i) => (/\$[A-Za-z_]\w*\P{ASCII}/u.test(line) ? [`${file}:${i + 1}`] : []));
}

describe('shell 脚本中的变量', () => {
  // macOS 自带的 sh（bash 3.2）在 UTF-8 语言环境下把紧跟其后的多字节字符的首字节算进变量名，如“$V，”读作变量“V\xef”，
  // 在 set -u 下即以“unbound variable”退出。变量名统一为 ASCII，后面紧跟非 ASCII 字符时必须写成 ${变量}
  it('变量后面紧跟非 ASCII 字符时写成 ${变量}', () => {
    const files = execFileSync('git', ['ls-files', '*.sh'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    expect(files).toContain('scripts/deploy.sh');
    expect(files.flatMap(bareBeforeNonAscii)).toEqual([]);
  });
});

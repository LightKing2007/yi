/** 上线脚本按 SHA256SUMS 核对下载的文件（OPS-031）：scripts/deploy.sh 的 verify_sums，以 sh 实际执行 */
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
    expect(result.stderr).toContain('Yi-2.0.5-mac-arm64.dmg 的 SHA-256 不符');
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

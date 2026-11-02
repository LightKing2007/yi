/** 桌面更新的互斥、故障重试与安装授权顺序（EDGE-002、SEC-032、TST-020）。 */
import { beforeEach, expect, it } from 'vitest';
import { isUpdateAction, latestMacVersion, UpdateController, type UpdateDriver, type UpdateState } from '../electron/update';

class FakeDriver implements UpdateDriver {
  checks = 0;
  downloads = 0;
  installs = 0;
  error: 'check' | 'download' | 'install' | null = null;
  release: (() => void) | undefined;
  begin: () => void = () => {};
  started = new Promise<void>(resolve => {
    this.begin = resolve;
  });
  async check(): Promise<string | null> {
    this.checks++;
    if (this.error === 'check') throw new Error('offline');
    return '4.1.0';
  }
  async download(progress: (percent: number) => void) {
    this.downloads++;
    if (this.error === 'download') throw new Error('checksum mismatch');
    progress(Number.NaN);
    progress(-1);
    progress(37.8);
    await new Promise<void>(resolve => {
      this.release = resolve;
      this.begin();
    });
    progress(101);
  }
  install() {
    if (this.error === 'install') throw new Error('permission denied');
    this.installs++;
  }
}

let driver: FakeDriver;
let updates: UpdateState[];
let errors: unknown[];
let controller: UpdateController;
beforeEach(() => {
  driver = new FakeDriver();
  updates = [];
  errors = [];
  controller = new UpdateController(
    driver,
    state => updates.push(state),
    err => errors.push(err),
    true,
  );
});

it('未检查或未下载完成时不得安装，重复点击下载只创建一次任务，完成后明确重启才安装', async () => {
  await controller.run('install');
  await controller.run('download');
  expect(driver.installs + driver.downloads).toBe(0);
  expect((await controller.run('check')).phase).toBe('available');
  const pending = controller.run('download');
  expect(controller.run('download')).toBe(pending);
  expect(controller.run('install')).toBe(pending);
  expect((await controller.run('status')).phase).toBe('downloading');
  expect(controller.snapshot().percent).toBe(37);
  expect(updates.some(state => !Number.isFinite(state.percent) || state.percent < 0)).toBe(false);
  expect(driver.installs).toBe(0);
  driver.release?.();
  expect((await pending).phase).toBe('ready');
  expect(controller.snapshot().percent).toBe(100);
  await controller.run('check');
  expect(driver.checks).toBe(1);
  await controller.run('install');
  await controller.run('install');
  expect(driver.downloads).toBe(1);
  expect(driver.installs).toBe(1);
});

it('检查失败可重试且不会安装，当前版本无需更新时清除提示', async () => {
  driver.error = 'check';
  expect(await controller.run('check')).toMatchObject({ phase: 'error', failed: 'check' });
  expect(errors).toHaveLength(1);
  driver.error = null;
  expect((await controller.run('check')).phase).toBe('available');
  driver.check = async () => null;
  expect(await controller.run('check')).toMatchObject({ phase: 'idle', version: '' });
  expect(driver.installs).toBe(0);
});

it('下载校验失败后拒绝安装，重新下载成功后才允许安装', async () => {
  await controller.run('check');
  driver.error = 'download';
  expect(await controller.run('download')).toMatchObject({ phase: 'error', failed: 'download', version: '4.1.0' });
  await controller.run('install');
  expect(driver.installs).toBe(0);
  driver.error = null;
  const pending = controller.run('download');
  await driver.started;
  driver.release?.();
  await pending;
  expect(controller.snapshot().phase).toBe('ready');
  expect(driver.downloads).toBe(2);
});

it('安装权限失败后仍可重试安装，异步安装错误也保留可操作状态', async () => {
  await controller.run('check');
  const pending = controller.run('download');
  driver.release?.();
  await pending;
  driver.error = 'install';
  expect(await controller.run('install')).toMatchObject({ phase: 'error', failed: 'install' });
  driver.error = null;
  await controller.run('install');
  controller.fail('install', new Error('async install failure'));
  expect(controller.snapshot()).toMatchObject({ phase: 'error', failed: 'install' });
  await controller.run('install');
  expect(driver.installs).toBe(2);
});

it('macOS 手动模式允许检查但不能调用自动下载或安装，外部修改快照无效', async () => {
  controller = new UpdateController(
    driver,
    () => {},
    () => {},
    false,
  );
  await controller.run('check');
  await controller.run('download');
  const snapshot = controller.snapshot();
  snapshot.phase = 'ready';
  snapshot.automatic = true;
  await controller.run('install');
  expect(driver.downloads + driver.installs).toBe(0);
  expect(controller.snapshot()).toMatchObject({ phase: 'available', automatic: false });
});

it('macOS 启动检查只认对应架构的合法官方安装程序且按数值比较版本', () => {
  const hash = 'a'.repeat(64);
  const sums = [
    `${hash}  Yi-4.9.0-mac-arm64.dmg`,
    `${hash}  Yi-4.10.0-mac-arm64.dmg`,
    `${hash}  Yi-9.0.0-mac-x64.dmg`,
    `${hash}  ../Yi-9.0.0-mac-arm64.dmg`,
    `bad  Yi-99.0.0-mac-arm64.dmg`,
  ].join('\n');
  expect(latestMacVersion(sums, '4.0.0', 'arm64')).toBe('4.10.0');
  expect(latestMacVersion(sums, '4.10.0', 'arm64')).toBeNull();
  expect(latestMacVersion(sums, '10.0.0', 'arm64')).toBeNull();
  expect(['status', 'check', 'download', 'install'].every(isUpdateAction)).toBe(true);
  expect([null, {}, '../install', 'https://evil.example'].some(isUpdateAction)).toBe(false);
});

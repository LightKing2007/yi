/** 启动检查不依赖联机，IPC 输入校验与对局期间拒绝重启安装（SEC-032、EDGE-002）。 */
import './fakeNet';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { bootUpdater, canInstallUpdate, parseUpdateState, updateAction, updateState } from '../src/app/updater';
import { screen, Screen } from '../src/app/state';
import { Phase, st } from '../src/online/state';
import type { UpdateAction, UpdateState } from '../electron/update';

const READY: UpdateState = { phase: 'ready', version: '4.1.0', percent: 100, automatic: true };
let calls: UpdateAction[];
let listener: (state: unknown) => void;
let removed: boolean;
beforeEach(() => {
  calls = [];
  removed = false;
  updateState.value = null;
  screen.value = Screen.Menu;
  st.phase = Phase.Off;
  vi.stubGlobal('yiNative', {
    update: async (action: UpdateAction) => {
      calls.push(action);
      return READY;
    },
    onUpdate: (callback: (state: unknown) => void) => {
      listener = callback;
      return () => {
        removed = true;
      };
    },
    log: () => {},
  });
});
afterEach(() => vi.unstubAllGlobals());

it('菜单启动即请求检查，无须进入大厅；后续进度可推送且卸载时解除监听', async () => {
  const stop = bootUpdater();
  expect(calls).toEqual(['check']);
  expect(st.phase).toBe(Phase.Off);
  await updateAction('status');
  expect(updateState.value).toEqual(READY);
  listener({ ...READY, phase: 'downloading', percent: 35 });
  expect(updateState.value?.percent).toBe(35);
  stop();
  expect(removed).toBe(true);
});

it('匹配中、等好友、对局中以及单机页面均拒绝安装，空闲菜单才允许', async () => {
  for (const phase of [Phase.Queue, Phase.Found, Phase.Hosting, Phase.Playing]) {
    st.phase = phase;
    screen.value = Screen.Online;
    expect(canInstallUpdate()).toBe(false);
    await updateAction('install');
  }
  st.phase = Phase.Off;
  screen.value = Screen.Game;
  expect(canInstallUpdate()).toBe(false);
  await updateAction('install');
  expect(calls).toEqual([]);
  screen.value = Screen.Menu;
  await updateAction('install');
  expect(calls).toEqual(['install']);
});

it('IPC 状态拒绝恶意版本、未知阶段、非有限进度和伪造能力字段', () => {
  expect(parseUpdateState(READY)).toEqual(READY);
  for (const bad of [
    null,
    [],
    { ...READY, version: '<script>' },
    { ...READY, version: '1'.repeat(33) },
    { ...READY, phase: {} },
    { ...READY, percent: NaN },
    { ...READY, percent: Infinity },
    { ...READY, percent: -1 },
    { ...READY, percent: 101 },
    { ...READY, automatic: 'true' },
    { ...READY, failed: 'shell' },
  ]) {
    expect(parseUpdateState(bad)).toBeNull();
  }
  expect(parseUpdateState({ ...READY, phase: 'error', failed: 'download' })).toMatchObject({ failed: 'download' });
});

it('浏览器环境不调用原生更新；IPC 拒绝时显示可重试状态且不阻断单机', async () => {
  vi.stubGlobal('yiNative', undefined);
  bootUpdater();
  expect(calls).toEqual([]);
  vi.stubGlobal('yiNative', {
    update: async () => {
      throw new Error('ipc unavailable');
    },
    log: () => {},
  });
  await updateAction('check');
  expect(updateState.value).toMatchObject({ phase: 'error', failed: 'check' });
  expect(screen.value).toBe(Screen.Menu);
});

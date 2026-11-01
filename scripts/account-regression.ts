/** 账号界面的缺陷回归（TST-013）：真实 DOM 与组件，网络边界以手动完成的 Promise 控制，不依赖请求速度。由 text-fit 一并执行。 */
import { h, render, type ComponentChildren } from 'preact';
import { act } from 'preact/test-utils';
import { useState } from 'preact/hooks';
import { accounts, startAccounts } from '../src/app/account';
import { goScreen } from '../src/app/controller';
import { Lang, setSettings } from '../src/app/settings';
import { screen, Screen } from '../src/app/state';
import type { Fetcher, RequiredConsents } from '../src/online/accountApi';
import { AccountPanel } from '../src/ui/account';
import { ConsentCheck } from '../src/ui/accountConsent';
import { ResetForm } from '../src/ui/accountForms';
import { accountView, typedEmail } from '../src/ui/accountNav';
import { RegisterForm } from '../src/ui/accountRegister';
import { PasswordField } from '../src/ui/widgets';

const PANEL_HEIGHT = 760;
const MAX_PASSWORD_BYTES = 1024;
const TOKEN_REPEAT = 16;
const INFO_HEIGHT_PX = 80;
const HTTP = { ok: 200, created: 201, accepted: 202, noContent: 204, unavailable: 503 } as const;
const user = { publicId: '7KM4P9D2', name: '棋友', emailVerified: true, consentsCurrent: true, onlineAllowed: true };
const response = (status: number, body?: unknown) => {
  const text = body === undefined ? '' : JSON.stringify(body);
  // 网络边界的假回应直接完成读体，不让浏览器的流任务决定断言时刻。
  return Object.assign(new Response(body === undefined ? null : text, { status, headers: { 'Content-Type': 'application/json' } }), {
    text: async () => text,
  });
};
const challenge = () => response(HTTP.accepted, { challengeId: 'c0'.repeat(TOKEN_REPEAT), expiresAt: '2099-01-01T00:00:00.000Z', resendAfterMs: 60000 });

function assert(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`账号回归：${message}`);
}

function deferred() {
  let finish!: (value: Response) => void; // Promise 的 executor 同步赋值
  const promise = new Promise<Response>(resolve => {
    finish = resolve;
  });
  return { promise, finish };
}

/** 每例重新装配网络边界与账号状态 */
function wire(fetcher: Fetcher) {
  startAccounts({ server: 'ws://127.0.0.1:1', fetcher });
}

async function mount(root: HTMLElement, content: ComponentChildren) {
  await act(() => render(content, root));
  await flush();
}

/** 跨过一个消息任务，排空网络回应的 Promise 链，再由 act 刷新组件；不按机器速度等待。 */
async function flush() {
  await act(
    () =>
      new Promise<void>(resolve => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          channel.port1.close();
          channel.port2.close();
          resolve();
        };
        channel.port2.postMessage(null);
      }),
  );
}

async function press(root: HTMLElement, text: string) {
  const button = [...root.querySelectorAll('button')].find(el => el.textContent?.trim() === text);
  assert(button && !button.disabled, `按钮“${text}”须可用`);
  await act(() => button.click());
  await flush();
}

async function fill(root: HTMLElement, selector: string, text: string) {
  const input = root.querySelector<HTMLInputElement>(selector);
  assert(input, `须找到 ${selector}`);
  await act(() => {
    input.value = text;
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await flush();
}

async function longPassword(root: HTMLElement) {
  const Password = () => {
    const [value, setValue] = useState('');
    return h(PasswordField, { value, onInput: setValue, label: '密码', autoComplete: 'current-password' });
  };
  await mount(root, h(Password, {}));
  const input = root.querySelector('input');
  assert(input && input.maxLength > MAX_PASSWORD_BYTES, '密码框须完整接受服务端支持的密码，并保留超长错误');
  await fill(root, 'input', 'a'.repeat(MAX_PASSWORD_BYTES));
  assert(input.value.length === MAX_PASSWORD_BYTES, '1024 字节密码须原样保留');
}

async function logoutNavigation(root: HTMLElement) {
  const pending = deferred();
  wire(async (_url, init) =>
    init.method === 'DELETE' ? pending.promise : response(HTTP.created, { token: 'a1'.repeat(TOKEN_REPEAT), expiresAt: '2099-01-01T00:00:00.000Z', user }),
  );
  await accounts()?.session.login('player@example.com', 'password1');
  screen.value = Screen.Account;
  accountView.value = 'profile';
  await mount(root, h(AccountPanel, { h: PANEL_HEIGHT }));
  await press(root, '退出登录');
  assert(Number(screen.value) === Screen.Online, '退出须立即返回，不等待撤销请求');
  goScreen(Screen.Game);
  await act(() => pending.finish(response(HTTP.noContent)));
  await flush();
  assert(Number(screen.value) === Screen.Game, '迟到的退出回应不得离开新开的单机对局');
}

async function consentRetry(root: HTMLElement) {
  let calls = 0;
  wire(async () =>
    ++calls === 1
      ? response(HTTP.unavailable, { code: 'server.internal', level: 'E5' })
      : response(HTTP.ok, {
          privacy: '2026-10-31',
          terms: '2026-10-31',
          privacyUrl: 'https://yi.lightking.com.cn/privacy-policy',
          termsUrl: 'https://yi.lightking.com.cn/terms-of-service',
        }),
  );
  let error = '',
    ready = false;
  const Consent = () => {
    const [consents, setConsents] = useState<RequiredConsents | null>(null);
    ready = consents !== null;
    return h(ConsentCheck, {
      checked: false,
      onChange: () => undefined,
      consents,
      onConsents: setConsents,
      onError: text => {
        error = text;
      },
    });
  };
  await mount(root, h(Consent, {}));
  assert(error && !ready && calls === 1, '首次失败须显示错误且不自动反复请求');
  await press(root, '重试');
  assert(ready && error === '' && Number(calls) === 2, '重试须取得协议并清除原来的错误');
}

async function pendingEmail(root: HTMLElement, registering: boolean) {
  const pending = deferred();
  wire(async () => pending.promise);
  typedEmail.value = 'first@example.com';
  await mount(root, h(registering ? RegisterForm : ResetForm, { h: PANEL_HEIGHT }));
  await press(root, '发送验证码');
  await fill(root, 'input[type=email]', 'second@example.com');
  await act(() => pending.finish(challenge()));
  await flush();
  assert(root.querySelector('input[type=email]')?.getAttribute('aria-label') === '邮箱', '改邮箱后须保留邮箱输入');
  const send = [...root.querySelectorAll('button')].find(el => el.textContent?.trim() === '发送验证码');
  assert(send && !send.disabled, '旧邮箱的迟到验证码不得推进注册步骤或锁住新邮箱');
}

async function resetEmail(root: HTMLElement) {
  wire(async () => challenge());
  typedEmail.value = 'first@example.com';
  await mount(root, h(ResetForm, { h: PANEL_HEIGHT }));
  await press(root, '发送验证码');
  await fill(root, '.cell', '9');
  // 从任一格粘贴完整验证码，保证提交原本可用
  const cell = root.querySelector('.cell');
  assert(cell, '须有验证码输入格');
  const data = new DataTransfer();
  data.setData('text/plain', '962914');
  await act(() => {
    cell.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await fill(root, 'input[type=password]', 'password1');
  const reset = [...root.querySelectorAll('button')].find(el => el.textContent?.trim() === '重设密码');
  assert(reset && !reset.disabled, '原邮箱与验证码须可提交');
  await fill(root, 'input[type=email]', 'second@example.com');
  assert(reset.disabled, '换邮箱后不得使用旧邮箱的验证码提交');
}

async function infoStyles(root: HTMLElement) {
  await mount(
    root,
    h('div', { class: 'info' }, h('div', { class: 'kv' }, h('div', {}, '说明'), h('div', { style: { height: `${INFO_HEIGHT_PX}px` } }, '多行说明'))),
  );
  const row = root.querySelector<HTMLElement>('.kv');
  assert(row && row.getBoundingClientRect().height >= INFO_HEIGHT_PX, '更多页的多行说明不得被账号样式固定为 40 像素');
}

/** 在真实浏览器中执行，失败即使 text-fit 退出非零；每例卸载组件并清理定时器（TST-033） */
export async function runAccountRegressions() {
  setSettings({ lang: Lang.ZH });
  const root = document.createElement('div');
  root.style.cssText = 'position:fixed;left:0;top:0;width:360px;visibility:hidden';
  document.body.append(root);
  try {
    const cases = [
      longPassword,
      logoutNavigation,
      consentRetry,
      (el: HTMLElement) => pendingEmail(el, true),
      (el: HTMLElement) => pendingEmail(el, false),
      resetEmail,
      infoStyles,
    ];
    for (const test of cases) {
      await test(root);
      await mount(root, null);
    }
    console.log(`账号界面缺陷回归通过：${cases.length} 项`);
  } finally {
    await mount(root, null);
    root.remove();
    goScreen(Screen.Menu);
  }
}

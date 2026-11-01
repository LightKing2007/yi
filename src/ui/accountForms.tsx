/**
 * 账号页的表单（设计稿经项目所有者 2026-11-01 定稿）：登录、找回密码，以及各表单共用的版式、提交、错误提示、倒计时与验证码申请。
 * 注册较长，见 accountRegister.tsx。所有请求经 app/account.ts 的账号接口；提交中按钮不可再按，防止重复提交
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { accounts, codeComplete, emailLooksValid, mailLanguage, passwordLongEnough, problemText } from '../app/account';
import { settings } from '../app/settings';
import { T, TF } from '../i18n';
import type { AccountResult, CodePurpose } from '../online/accountApi';
import { accountBack, accountView, typedEmail } from './accountNav';
import { Button, CodeCells, Field, FieldLabel, Fit, PasswordField, showToast, Toast } from './widgets';

/** 账号接口未开启时的错误（入口关闭时不会走到这里） */
const UNAVAILABLE = '服务器出现问题，请稍后再试';
/** 主要按钮的高度（设计稿的统一尺寸） */
export const PRIMARY_H = 46;
/** 次要按钮（返回等）的高度 */
export const SECONDARY_H = 44;

/** 账号页一屏的版式：标题、内容、底部的提示条与返回 */
export function FormPanel({ h, title, onBack, children }: { h: number; title: string; onBack?: () => void; children: ComponentChildren }) {
  return (
    <div class="npanel col account" style={{ height: h + 'px' }}>
      <h1 class="title" style={{ height: '60px' }}>
        <Fit size={44}>{T(title)}</Fit>
      </h1>
      {children}
      <div style={{ flex: '1 1 0' }} />
      <Toast />
      <Button label={T('返回')} height={SECONDARY_H} style={{ width: '100%' }} onClick={onBack ?? accountBack} />
    </div>
  );
}

/** 表单的错误提示（原文经 T() 显示），至多两行 */
export function FormError({ text }: { text: string }) {
  return (
    <div class="form-error" role="alert">
      {text ? (
        <Fit size={13.5} lines={2}>
          {T(text)}
        </Fit>
      ) : null}
    </div>
  );
}

/** 表单下方的一行文字链接（文字已经 T() 换成当前语言）；disabled 的链接显示为浅色、不可点 */
export function FormLinks({ links }: { links: { label: string; onClick: () => void; disabled?: boolean }[] }) {
  return (
    <div class="form-links">
      {links.map(({ label, onClick, disabled = false }, i) => (
        <button key={i} type="button" class="text-link" disabled={disabled} onClick={onClick}>
          <Fit size={13.5}>{label}</Fit>
        </button>
      ))}
    </div>
  );
}

/** 提交：进行中不可重复提交；task 返回错误原文时显示，返回 undefined 表示成功 */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (task: () => Promise<string | undefined>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      setError((await task()) ?? '');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, submit: (task: () => Promise<string | undefined>) => void run(task) }; // 结果经状态反映到界面，任务本身不抛出
}

/** 每秒的毫秒数 */
const SECOND_MS = 1000;

/** 距 until（Date.now 的毫秒）还有几秒，每秒重绘一次；已过为 0 */
export function useSecondsLeft(until: number) {
  const [, tick] = useState(0);
  const left = Math.max(0, Math.ceil((until - Date.now()) / SECOND_MS));
  useEffect(() => {
    if (left <= 0) return;
    const id = setInterval(() => tick(count => count + 1), SECOND_MS);
    return () => clearInterval(id);
  }, [until, left > 0]);
  return left;
}

/** 已申请的验证码：挑战编号、何时可以重发、何时失效（Date.now 的毫秒） */
export interface Challenge {
  id: string;
  resendAt: number;
  expiresAt: number;
}

/** 申请验证码；失败时返回错误原文 */
export async function requestCode(purpose: CodePurpose, email: string): Promise<Challenge | string> {
  const api = accounts()?.api;
  if (!api) return UNAVAILABLE;
  const r = await api.requestCode(purpose, email.trim(), mailLanguage(settings.value.lang));
  if (!r.ok) return problemText(r.problem);
  const now = Date.now();
  return { id: r.value.challengeId, resendAt: now + r.value.resendAfterMs, expiresAt: Date.parse(r.value.expiresAt) };
}

/** 接口结果转为错误原文（成功为 undefined） */
export const failure = (r: AccountResult<unknown>) => (r.ok ? undefined : problemText(r.problem));

/** 邮箱的打码显示：首字符与域名，如 l***@example.com */
export function maskEmail(email: string) {
  const trimmed = email.trim(),
    at = trimmed.lastIndexOf('@');
  return at > 0 ? `${trimmed[0]}***${trimmed.slice(at)}` : trimmed;
}

/** 重发验证码的按钮文字：倒计时中为“52 秒” */
export const resendLabel = (left: number) => (left > 0 ? TF('%d 秒', left) : T('重新发送'));

// ---------------- 登录 ----------------

/** 登录：邮箱与密码；出错时保留邮箱、清空密码（契约第 6.3 条） */
export function LoginForm({ h }: { h: number }) {
  const [password, setPassword] = useState('');
  const email = typedEmail.value;
  const { busy, error, submit } = useSubmit();
  const ready = emailLooksValid(email) && password.length > 0 && !busy;
  const go = () => {
    if (!ready) return;
    submit(async () => {
      const session = accounts()?.session;
      if (!session) return UNAVAILABLE;
      const r = await session.login(email.trim(), password);
      if (r.ok) {
        accountBack();
        return undefined;
      }
      setPassword('');
      return problemText(r.problem);
    });
  };
  return (
    <FormPanel h={h} title="登录">
      <div style={{ height: '10px' }} />
      <FieldLabel text={T('邮箱')} />
      <Field value={email} onInput={text => (typedEmail.value = text)} type="email" autoComplete="email" label={T('邮箱')} maxLength={254} onEnter={go} />
      <div class="gap" />
      <FieldLabel text={T('密码')} />
      <PasswordField value={password} onInput={setPassword} label={T('密码')} autoComplete="current-password" onEnter={go} />
      <FormError text={error} />
      <Button label={T('登录')} primary height={PRIMARY_H} disabled={!ready} style={{ width: '100%' }} onClick={go} />
      <FormLinks
        links={[
          { label: T('忘记密码'), onClick: () => (accountView.value = 'reset') },
          { label: T('没有账号？注册'), onClick: () => (accountView.value = 'register') },
        ]}
      />
    </FormPanel>
  );
}

// ---------------- 找回密码 ----------------

/** 找回密码：同一屏填邮箱、申请验证码、填验证码与新密码；成功后回到登录 */
export function ResetForm({ h }: { h: number }) {
  const email = typedEmail.value;
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const sending = useSubmit(),
    resetting = useSubmit();
  const left = useSecondsLeft(challenge?.resendAt ?? 0);
  const send = () =>
    sending.submit(async () => {
      const got = await requestCode('reset', email);
      if (typeof got === 'string') return got;
      setChallenge(got);
      setCode('');
      return undefined;
    });
  const ready = challenge !== null && codeComplete(code) && passwordLongEnough(password) && !resetting.busy;
  const go = () => {
    if (!ready) return;
    resetting.submit(async () => {
      const api = accounts()?.api;
      if (!api) return UNAVAILABLE;
      const r = await api.resetPassword({ email: email.trim(), password, challengeId: challenge.id, code });
      if (!r.ok) return problemText(r.problem);
      accountView.value = 'login';
      showToast('密码已重设，请重新登录');
      return undefined;
    });
  };
  return (
    <FormPanel h={h} title="找回密码">
      <div class="form-note" style={{ marginTop: '-2px', marginBottom: '12px' }}>
        <Fit size={13} lines={2}>
          {T('输入注册时的邮箱，我们会发送验证码。')}
        </Fit>
      </div>
      <FieldLabel text={T('邮箱')} />
      <div class="field-row">
        <Field value={email} onInput={text => (typedEmail.value = text)} type="email" autoComplete="email" label={T('邮箱')} maxLength={254} onEnter={send} />
        <button type="button" class="btn inline" disabled={!emailLooksValid(email) || left > 0 || sending.busy} onClick={send}>
          <Fit size={13.5}>{challenge ? resendLabel(left) : T('发送验证码')}</Fit>
        </button>
      </div>
      <div class="gap" />
      <FieldLabel text={T('验证码')} />
      <CodeCells value={code} onChange={setCode} />
      <div class="gap" />
      <FieldLabel text={T('新密码')} />
      <PasswordField value={password} onInput={setPassword} placeholder={T('至少 8 位')} label={T('新密码')} autoComplete="new-password" onEnter={go} />
      <div class="form-note">
        <Fit size={12.5} lines={2}>
          {T('重设后，所有设备上的登录都会失效，需要重新登录。')}
        </Fit>
      </div>
      <FormError text={sending.error || resetting.error} />
      <Button label={T('重设密码')} primary height={PRIMARY_H} disabled={!ready} style={{ width: '100%' }} onClick={go} />
    </FormPanel>
  );
}

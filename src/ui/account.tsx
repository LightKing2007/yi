/**
 * 账号的界面（设计稿经项目所有者 2026-11-01 定稿）：账号页按当前一屏分派；账号资料、修改雅号、修改密码；
 * 多人游戏页的登录门槛（未登录、资料暂不可取、协议待补签）与大厅中的账号条。账号功能未开启时这些都不出现
 */
import { account, accounts, newPasswordProblem, passwordValid, problemText } from '../app/account';
import { goScreen } from '../app/controller';
import { Screen } from '../app/state';
import { T } from '../i18n';
import { displayPublicId } from '../shared/publicId';
import { clipName } from '../shared/protocol';
import { useState } from 'preact/hooks';
import { ConsentPanel } from './accountConsent';
import { FormError, FormPanel, LoginForm, PRIMARY_H, ResetForm, SECONDARY_H, useSubmit } from './accountForms';
import { accountView, openAccount, typedEmail } from './accountNav';
import { RegisterForm } from './accountRegister';
import { Button, Field, FieldLabel, Fit, PasswordField, showToast } from './widgets';

/** 账号页：已登录时只有资料、改雅号、改密码三屏，未登录时只有登录、注册、找回密码三屏 */
export function AccountPanel({ h }: { h: number }) {
  const signedIn = account.value.user !== undefined;
  const view = accountView.value;
  const content = signedIn ? (
    view === 'rename' ? (
      <RenameForm h={h} />
    ) : view === 'password' ? (
      <PasswordForm h={h} />
    ) : (
      <ProfileView h={h} />
    )
  ) : view === 'register' ? (
    <RegisterForm h={h} />
  ) : view === 'reset' ? (
    <ResetForm h={h} />
  ) : (
    <LoginForm h={h} />
  );
  return (
    <div key={(signedIn ? 'in-' : 'out-') + view} class="tab-body">
      {content}
    </div>
  );
}

// ---------------- 账号资料 ----------------

/** 复制图标：两张错叠的圆角纸，线条随文字颜色 */
const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
    <rect x="5.5" y="5.5" width="8" height="8" rx="2" />
    <path d="M10.5 3.5v-.5a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5v5A1.5 1.5 0 0 0 4 9.5h.5" />
  </svg>
);

/** 复制公开 UID（带连字符的显示形式），底部弹出提示条 */
function copyUid(uid: string) {
  navigator.clipboard.writeText(uid).then(
    () => showToast('已复制到剪贴板'),
    () => showToast('无法复制，请手动选择'),
  );
}

function ProfileView({ h }: { h: number }) {
  const { user, saved } = account.value;
  const { busy, submit } = useSubmit();
  if (!user) return null;
  const uid = displayPublicId(user.publicId) ?? user.publicId;
  const logout = () =>
    submit(async () => {
      // 本机的登录在调用时即已清除，随即回到多人游戏页（显示登录门槛），不等撤销请求：等待期间玩家可能已去了别处
      const revoking = accounts()?.session.logout();
      goScreen(Screen.Online);
      await revoking;
      return undefined;
    });
  return (
    <FormPanel h={h} title="账号">
      <div class="profile">
        <div class="profile-name">
          <Fit size={30}>{user.name}</Fit>
        </div>
        <div class="profile-uid">
          <span class="uid-text">UID {uid}</span>
          <button type="button" class="icon-btn" title={T('复制')} aria-label={T('复制 UID')} onClick={() => copyUid(uid)}>
            <CopyIcon />
          </button>
        </div>
      </div>
      <div class="kv">
        <Fit size={14} class="k">
          {T('邮箱')}
        </Fit>
        <Fit size={14}>{T(user.emailVerified ? '已验证' : '未验证')}</Fit>
      </div>
      <div class="kv">
        <Fit size={14} class="k">
          {T('本机')}
        </Fit>
        <Fit size={14}>{T(saved ? '已加密保存登录' : '只在本次运行中保持登录')}</Fit>
      </div>
      <div style={{ height: '24px' }} />
      <div class="stack">
        <Button label={T('修改雅号')} height={SECONDARY_H} onClick={() => (accountView.value = 'rename')} />
        <Button label={T('修改密码')} height={SECONDARY_H} onClick={() => (accountView.value = 'password')} />
        <Button label={T('退出登录')} height={SECONDARY_H} disabled={busy} onClick={logout} />
      </div>
    </FormPanel>
  );
}

/** 雅号输入框的码元上限：实际按字素截到 16 个（I18N-030） */
const NAME_INPUT_MAX = 64;

function RenameForm({ h }: { h: number }) {
  const [name, setName] = useState(account.value.user?.name ?? '');
  const { busy, error, submit } = useSubmit();
  const ready = name.trim().length > 0 && name.trim() !== account.value.user?.name && !busy;
  const go = () => {
    if (!ready) return;
    submit(async () => {
      const session = accounts()?.session;
      if (!session) return undefined;
      const r = await session.rename(name.trim());
      if (!r.ok) return problemText(r.problem);
      accountView.value = 'profile';
      showToast('雅号已修改');
      return undefined;
    });
  };
  return (
    <FormPanel h={h} title="修改雅号">
      <div style={{ height: '10px' }} />
      <FieldLabel text={T('雅号')} />
      <Field
        value={name}
        onInput={text => setName(clipName(text))}
        placeholder={T('至多 16 个字，可与他人重名')}
        label={T('雅号')}
        maxLength={NAME_INPUT_MAX}
        onEnter={go}
      />
      <div class="form-note">
        <Fit size={12.5} lines={2}>
          {T('已开始的对局仍显示原来的雅号，下一局起使用新雅号。')}
        </Fit>
      </div>
      <FormError text={error} />
      <Button label={T('保存')} primary height={PRIMARY_H} disabled={!ready} style={{ width: '100%' }} onClick={go} />
    </FormPanel>
  );
}

/** 修改密码：成功后服务端撤销全部登录，本机随之退出，回到登录 */
function PasswordForm({ h }: { h: number }) {
  const [old, setOld] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, submit } = useSubmit();
  const problem = newPasswordProblem(password, again);
  const ready = old.length > 0 && passwordValid(password) && again === password && !busy;
  const go = () => {
    if (!ready) return;
    submit(async () => {
      const session = accounts()?.session;
      if (!session) return undefined;
      const r = await session.changePassword(old, password);
      if (!r.ok) {
        setOld('');
        return problemText(r.problem);
      }
      accountView.value = 'login';
      showToast('密码已修改，请重新登录');
      return undefined;
    });
  };
  return (
    <FormPanel h={h} title="修改密码">
      <div style={{ height: '10px' }} />
      <FieldLabel text={T('当前密码')} />
      <PasswordField value={old} onInput={setOld} label={T('当前密码')} autoComplete="current-password" />
      <div class="gap" />
      <FieldLabel text={T('新密码')} />
      <PasswordField value={password} onInput={setPassword} placeholder={T('至少 8 位')} label={T('新密码')} autoComplete="new-password" />
      <div style={{ height: '10px' }} />
      <PasswordField value={again} onInput={setAgain} placeholder={T('再次输入密码')} label={T('再次输入密码')} autoComplete="new-password" onEnter={go} />
      <div class="form-note">
        <Fit size={12.5} lines={2}>
          {T('修改后，所有设备上的登录都会失效，需要重新登录。')}
        </Fit>
      </div>
      <FormError text={problem || error} />
      <Button label={T('确认修改')} primary height={PRIMARY_H} disabled={!ready} style={{ width: '100%' }} onClick={go} />
    </FormPanel>
  );
}

// ---------------- 多人游戏页 ----------------

/** 多人游戏页的“返回”：回到开始菜单 */
const backToMenu = () => goScreen(Screen.Menu);

/** 未登录时的多人游戏页：说明须登录，给出登录与注册 */
function SignInGate({ h }: { h: number }) {
  const go = (view: 'login' | 'register') => {
    typedEmail.value = typedEmail.value.trim();
    openAccount(view);
  };
  return (
    <FormPanel h={h} title="联机对战" onBack={backToMenu}>
      <div style={{ height: '30px' }} />
      <div class="gate-head">
        <Fit size={24}>{T('登录后即可联机')}</Fit>
      </div>
      <div class="form-note" style={{ marginTop: '12px' }}>
        <Fit size={13.5} lines={2}>
          {T('匹配、排位与好友房间均需登录账号并验证邮箱；单人游戏无需登录。')}
        </Fit>
      </div>
      <div style={{ height: '28px' }} />
      <div class="stack">
        <Button label={T('登录')} primary height={PRIMARY_H} onClick={() => go('login')} />
        <Button label={T('注册账号')} height={PRIMARY_H} onClick={() => go('register')} />
      </div>
    </FormPanel>
  );
}

/** 已登录但资料暂时取不到（网络中断）：可以重试 */
function ProfileUnavailable({ h }: { h: number }) {
  const { busy, error, submit } = useSubmit();
  const retry = () =>
    submit(async () => {
      const r = await accounts()?.session.refresh();
      return r && !r.ok ? problemText(r.problem) : undefined;
    });
  return (
    <FormPanel h={h} title="联机对战" onBack={backToMenu}>
      <div class="form-note" style={{ marginTop: '8px' }}>
        <Fit size={13.5} lines={2}>
          {T('暂时无法取得账号资料，请检查网络后重试。')}
        </Fit>
      </div>
      <FormError text={error} />
      <Button label={T('重试')} primary height={PRIMARY_H} disabled={busy} style={{ width: '100%' }} onClick={retry} />
    </FormPanel>
  );
}

/** 多人游戏页的登录门槛：账号功能开启且未满足联机条件时返回替代大厅的一屏，否则为 null */
export function accountGate(height: number) {
  const wired = accounts();
  if (!wired) return null;
  const { user } = account.value;
  if (!user) return wired.session.signedIn ? <ProfileUnavailable h={height} /> : <SignInGate h={height} />;
  if (!user.consentsCurrent) return <ConsentPanel h={height} />;
  return null;
}

/** 大厅中的账号条：雅号与“账号”按钮；账号功能未开启或未登录时为 null（大厅照旧显示昵称输入框） */
export function AccountBar() {
  const user = accounts() ? account.value.user : undefined;
  if (!user) return null;
  return (
    <div class="account-bar">
      <Fit size={16}>{user.name}</Fit>
      <button type="button" class="btn" onClick={() => openAccount('profile')}>
        <Fit size={14}>{T('账号')}</Fit>
      </button>
    </div>
  );
}

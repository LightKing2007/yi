/**
 * 注册（设计稿经项目所有者 2026-11-01 定稿）：分三步——验证邮箱、输入验证码、设置雅号与密码并同意协议。
 * 服务端在最后一步才核对验证码，验证码有误时退回第二步；邮箱已注册时提示直接登录或找回密码（契约第 3.5 条）
 */
import { useEffect, useState } from 'preact/hooks';
import { accounts, codeComplete, emailLooksValid, passwordLongEnough, problemText } from '../app/account';
import { T, TF } from '../i18n';
import type { RequiredConsents } from '../online/accountApi';
import { clipName } from '../shared/protocol';
import { accountBack, typedEmail } from './accountNav';
import { type Challenge, FormError, FormLinks, FormPanel, maskEmail, PRIMARY_H, requestCode, resendLabel, useSecondsLeft, useSubmit } from './accountForms';
import { ConsentCheck } from './accountConsent';
import { Button, CodeCells, Field, FieldLabel, Fit, PasswordField } from './widgets';

/** 查询验证码邮件发送状态的间隔与次数上限（约一分钟后不再查询，提示仍按已受理显示） */
const POLL_MS = 2000;
const POLL_MAX = 30;
/** 雅号输入框的码元上限：实际按字素截到 16 个（I18N-030） */
const NAME_INPUT_MAX = 64;
const MINUTE_MS = 60_000;

type Delivery = 'pending' | 'sent' | 'retry';

/** 第二步：验证码邮件的发送状态（受理后异步发信，契约第 3.4 条） */
function useDelivery(challenge: Challenge) {
  const [state, setState] = useState<Delivery>('pending');
  useEffect(() => {
    setState('pending');
    const api = accounts()?.api;
    if (!api) return;
    let n = 0,
      live = true;
    const id = setInterval(() => {
      if (++n > POLL_MAX) return clearInterval(id);
      void api.codeState(challenge.id).then(r => {
        // 查询失败时下一次再查；结果只经状态显示
        if (!live || !r.ok || r.value === 'pending') return;
        setState(r.value);
        clearInterval(id);
      });
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [challenge.id]);
  return state;
}

/** 第二步的说明：发送中、已发送（含有效分钟数）或发送失败 */
function deliveryText(state: Delivery, email: string, challenge: Challenge) {
  if (state === 'retry') return T('验证码邮件发送失败，请重新发送');
  if (state === 'pending') return T('正在发送验证码…');
  return TF('验证码已发送至 %s，%d 分钟内有效', maskEmail(email), Math.max(1, Math.round((challenge.expiresAt - Date.now()) / MINUTE_MS)));
}

/** 三步：验证邮箱、输入验证码、设置雅号与密码 */
const STEP = { email: 1, code: 2, profile: 3 } as const;
const STEPS = [STEP.email, STEP.code, STEP.profile];
const STEP_TEXT = {
  [STEP.email]: '第 1 步，共 3 步 · 验证邮箱',
  [STEP.code]: '第 2 步，共 3 步 · 输入验证码',
  [STEP.profile]: '第 3 步，共 3 步 · 设置雅号与密码',
};
type Step = (typeof STEPS)[number];

/** 三步的进度条 */
const Steps = ({ step }: { step: Step }) => (
  <div class="steps" aria-hidden="true">
    {STEPS.map(item => (
      <i key={item} class={item <= step ? 'on' : ''} />
    ))}
  </div>
);

/** 注册的三步；返回在第二、三步时退回上一步 */
export function RegisterForm({ h }: { h: number }) {
  const [step, setStep] = useState<Step>(STEP.email);
  const email = typedEmail.value;
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState('');
  const sending = useSubmit();
  const send = () =>
    sending.submit(async () => {
      const got = await requestCode('register', email);
      if (typeof got === 'string') return got;
      setChallenge(got);
      setCode('');
      setCodeError('');
      setStep(STEP.code);
      return undefined;
    });
  const back = () => (step === STEP.email ? accountBack() : setStep(step === STEP.profile ? STEP.code : STEP.email));
  const toCode = (error: string) => {
    setCode('');
    setCodeError(error);
    setStep(STEP.code);
  };
  return (
    <FormPanel h={h} title="注册账号" onBack={back}>
      <Steps step={step} />
      <div class="sub" style={{ height: '26px', marginTop: '-4px' }}>
        <Fit size={14}>{T(STEP_TEXT[step])}</Fit>
      </div>
      {step === STEP.email && <EmailStep email={email} challenge={challenge} sending={sending} onSend={send} />}
      {step === STEP.code && challenge && (
        <CodeStep
          email={email}
          challenge={challenge}
          code={code}
          error={codeError || sending.error}
          busy={sending.busy}
          onCode={setCode}
          onNext={() => setStep(STEP.profile)}
          onResend={send}
          onChangeEmail={() => setStep(STEP.email)}
        />
      )}
      {step === STEP.profile && challenge && <Profile email={email} challenge={challenge} code={code} onCodeError={toCode} />}
    </FormPanel>
  );
}

/** 第一步：填邮箱、发送验证码 */
function EmailStep({
  email,
  challenge,
  sending,
  onSend,
}: {
  email: string;
  challenge: Challenge | null;
  sending: { busy: boolean; error: string };
  onSend: () => void;
}) {
  const left = useSecondsLeft(challenge?.resendAt ?? 0);
  return (
    <>
      <div style={{ height: '14px' }} />
      <FieldLabel text={T('邮箱')} />
      <Field value={email} onInput={text => (typedEmail.value = text)} type="email" autoComplete="email" label={T('邮箱')} maxLength={254} onEnter={onSend} />
      <div class="form-note">
        <Fit size={12.5} lines={2}>
          {T('验证码邮件可能被归入垃圾邮件，收不到时请检查垃圾邮件箱，或改用其他邮箱。')}
        </Fit>
      </div>
      <FormError text={sending.error} />
      <Button
        label={T('发送验证码')}
        primary
        height={PRIMARY_H}
        disabled={!emailLooksValid(email) || sending.busy || left > 0}
        style={{ width: '100%' }}
        onClick={onSend}
      />
    </>
  );
}

/** 第二步：发送状态、六格验证码、重发与更换邮箱；填满六位即进入下一步 */
function CodeStep(props: {
  email: string;
  challenge: Challenge;
  code: string;
  error: string;
  busy: boolean;
  onCode: (code: string) => void;
  onNext: () => void;
  onResend: () => void;
  onChangeEmail: () => void;
}) {
  const left = useSecondsLeft(props.challenge.resendAt);
  const delivery = useDelivery(props.challenge);
  return (
    <>
      <div class="form-note" style={{ margin: '10px 0 14px' }}>
        <Fit size={13} lines={2}>
          {deliveryText(delivery, props.email, props.challenge)}
        </Fit>
      </div>
      <CodeCells value={props.code} onChange={props.onCode} onComplete={props.onNext} />
      <FormError text={props.error} />
      <Button label={T('下一步')} primary height={PRIMARY_H} disabled={!codeComplete(props.code)} style={{ width: '100%' }} onClick={props.onNext} />
      <FormLinks
        links={[
          { label: resendLabel(left), onClick: props.onResend, disabled: left > 0 || props.busy },
          { label: T('更换邮箱'), onClick: props.onChangeEmail },
        ]}
      />
    </>
  );
}

/** 第三步：雅号、密码（输入两次）与协议；提交即注册并登录 */
function Profile({ email, challenge, code, onCodeError }: { email: string; challenge: Challenge; code: string; onCodeError: (error: string) => void }) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [consents, setConsents] = useState<RequiredConsents | null>(null);
  const [agreed, setAgreed] = useState(false);
  const { busy, error, setError, submit } = useSubmit();
  const mismatch = again.length > 0 && again !== password;
  const ready = name.trim().length > 0 && passwordLongEnough(password) && again === password && agreed && consents !== null && !busy;
  const go = () => {
    if (!ready) return;
    submit(async () => {
      const session = accounts()?.session;
      if (!session) return problemText({ status: 0, code: 'server.internal', level: 'E5' });
      const consent = { accepted: true as const, privacy: consents.privacy, terms: consents.terms };
      const r = await session.register({ name: name.trim(), email: email.trim(), password, challengeId: challenge.id, code, consent });
      if (r.ok) {
        accountBack();
        return undefined;
      }
      if (r.problem.code === 'code.invalid') onCodeError(problemText(r.problem));
      if (r.problem.code === 'consent.outdated') {
        setAgreed(false);
        setConsents(null);
      }
      return problemText(r.problem);
    });
  };
  return (
    <>
      <div style={{ height: '10px' }} />
      <FieldLabel text={T('雅号')} />
      <Field
        value={name}
        onInput={text => setName(clipName(text))}
        placeholder={T('至多 16 个字，可与他人重名')}
        label={T('雅号')}
        maxLength={NAME_INPUT_MAX}
      />
      <div class="gap" />
      <FieldLabel text={T('密码')} />
      <PasswordField value={password} onInput={setPassword} placeholder={T('至少 8 位')} label={T('密码')} autoComplete="new-password" />
      <div style={{ height: '10px' }} />
      <PasswordField value={again} onInput={setAgain} placeholder={T('再次输入密码')} label={T('再次输入密码')} autoComplete="new-password" onEnter={go} />
      <div style={{ height: '12px' }} />
      <ConsentCheck checked={agreed} onChange={setAgreed} consents={consents} onConsents={setConsents} onError={setError} />
      <FormError text={mismatch ? '两次输入的密码不一致' : error} />
      <Button label={T('注册并登录')} primary height={PRIMARY_H} disabled={!ready} style={{ width: '100%' }} onClick={go} />
    </>
  );
}

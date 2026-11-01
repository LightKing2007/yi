/**
 * 协议同意：注册时的勾选框，以及协议更新后进入联机时的补签一屏（契约第 3.2、3.11.2 条）。
 * 版本取自服务端的当前必需版本，同意时原样回传；文书在官网阅读，链接由接口客户端限定为官网地址
 */
import { useEffect, useState } from 'preact/hooks';
import { goScreen } from '../app/controller';
import { accounts, problemText } from '../app/account';
import { Screen } from '../app/state';
import { T } from '../i18n';
import type { RequiredConsents } from '../online/accountApi';
import { FormError, PRIMARY_H, SECONDARY_H, useSubmit } from './accountForms';
import { Button, Check, Fit } from './widgets';

/** 打开官网上的文书 */
const openDoc = (url: string) => {
  if (/^https:\/\//.test(url)) window.open(url);
};

/** 取当前必需的协议版本；失败时经 onError 给出错误原文 */
function useConsents(consents: RequiredConsents | null, onConsents: (c: RequiredConsents) => void, onError: (text: string) => void) {
  useEffect(() => {
    const api = accounts()?.api;
    if (consents || !api) return;
    let live = true;
    void api.requiredConsents().then(r => {
      // 结果只经回调反映到界面；接口调用不抛出异常
      if (!live) return;
      if (r.ok) onConsents(r.value);
      else onError(problemText(r.problem));
    });
    return () => {
      live = false;
    };
  }, [consents]);
}

/** “我已阅读并同意《用户服务条款》与《隐私政策》”：两个文书名为链接；版本取到之前不可勾选 */
export function ConsentCheck({
  checked,
  onChange,
  consents,
  onConsents,
  onError,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  consents: RequiredConsents | null;
  onConsents: (c: RequiredConsents) => void;
  onError: (text: string) => void;
}) {
  useConsents(consents, onConsents, onError);
  const [before, between, after] = T('我已阅读并同意%s与%s').split('%s');
  const link = (name: string, url: string | undefined) => (
    <a
      href={url}
      class="doc-link"
      onClick={event => {
        event.preventDefault(); // 在浏览器或系统中打开，不切换勾选
        if (url) openDoc(url);
      }}
    >
      {T(name)}
    </a>
  );
  return (
    <Check checked={checked && consents !== null} onChange={value => onChange(value && consents !== null)}>
      {before}
      {link('《用户服务条款》', consents?.termsUrl)}
      {between}
      {link('《隐私政策》', consents?.privacyUrl)}
      {after}
    </Check>
  );
}

/** 协议更新后的补签：同意后继续联机；暂不同意回到开始菜单 */
export function ConsentPanel({ h }: { h: number }) {
  const [consents, setConsents] = useState<RequiredConsents | null>(null);
  const [agreed, setAgreed] = useState(false);
  const { busy, error, setError, submit } = useSubmit();
  const go = () =>
    submit(async () => {
      const session = accounts()?.session;
      if (!session || !consents) return undefined;
      const r = await session.acceptConsents({ accepted: true, privacy: consents.privacy, terms: consents.terms });
      if (r.ok) return undefined;
      if (r.problem.code === 'consent.outdated') {
        setAgreed(false);
        setConsents(null);
      }
      return problemText(r.problem);
    });
  return (
    <div class="npanel col account" style={{ height: h + 'px' }}>
      <h1 class="title" style={{ height: '60px' }}>
        <Fit size={44}>{T('协议已更新')}</Fit>
      </h1>
      <div class="form-note" style={{ fontSize: '13.5px', marginTop: '8px' }}>
        <Fit size={13.5} lines={2}>
          {T('用户服务条款与隐私政策已更新，请阅读并同意后继续联机。')}
        </Fit>
      </div>
      <div style={{ height: '20px' }} />
      <ConsentCheck checked={agreed} onChange={setAgreed} consents={consents} onConsents={setConsents} onError={setError} />
      <FormError text={error} />
      <div class="stack">
        <Button label={T('同意并继续')} primary height={PRIMARY_H} disabled={!agreed || busy} onClick={go} />
        <Button label={T('暂不同意')} height={SECONDARY_H} onClick={() => goScreen(Screen.Menu)} />
      </div>
    </div>
  );
}

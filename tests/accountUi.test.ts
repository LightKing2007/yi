/** 账号界面的逻辑部分：开关、开启后恢复登录、加密存储的转接、邮件语言、错误提示与输入检查（src/app/account.ts），以及六格验证码的输入规则（src/ui/codeCells.ts）。 */
import { describe, expect, it } from 'vitest';
import {
  account,
  accounts,
  accountsWanted,
  codeComplete,
  emailLooksValid,
  loginStoreOf,
  mailLanguage,
  passwordLongEnough,
  problemText,
  startAccounts,
} from '../src/app/account';
import type { YiNative } from '../src/app/native';
import { Lang } from '../src/app/settings';
import type { Fetcher } from '../src/online/accountApi';
import { ERRORS } from '../src/shared/errors';
import { backspaceCells, fillCells } from '../src/ui/codeCells';

const user = { publicId: '7KM4P9D2', name: '棋友', emailVerified: true, consentsCurrent: true, onlineAllowed: true };
const token = 'a1'.repeat(16);

describe('开关与开启', () => {
  it('只在开发模式下、地址带 ?accounts 时打开入口', () => {
    expect(accountsWanted('?accounts', true)).toBe(true);
    expect(accountsWanted('?server=ws://127.0.0.1:9&accounts=1', true)).toBe(true);
    expect(accountsWanted('?accounts', false)).toBe(false);
    expect(accountsWanted('?server=ws://127.0.0.1:9', true)).toBe(false);
  });

  it('联机地址不合格时不开启；开启后以保存的令牌取资料，登录状态反映到信号', async () => {
    const calls: { url: string; auth: string | undefined }[] = [];
    const fetcher: Fetcher = async (url, init) => {
      calls.push({ url, auth: (init.headers as Record<string, string>).Authorization });
      return new Response(JSON.stringify(user), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const store = { load: async () => ({ token, expiresAt: '2026-12-01T00:00:00.000Z' }), save: async () => true, clear: async () => undefined };
    expect(startAccounts({ server: 'https://yi.example', fetcher, store })).toBe(false);
    expect(accounts()).toBeUndefined();
    const restored = new Promise<void>(resolve => {
      const stop = account.subscribe(state => {
        if (!state.user) return;
        resolve();
        queueMicrotask(stop);
      });
    });
    expect(startAccounts({ server: 'ws://127.0.0.1:8443', fetcher, store })).toBe(true);
    await restored;
    expect(account.value).toEqual({ user, saved: true });
    expect(accounts()?.session.signedIn).toBe(true);
    expect(calls).toEqual([{ url: 'http://127.0.0.1:8443/api/v1/me', auth: `Bearer ${token}` }]);
  });

  it('桌面版的加密存储转接到 yiNative；浏览器中没有', async () => {
    expect(loginStoreOf(undefined)).toBeUndefined();
    const log: string[] = [];
    const yi = {
      loadLogin: async () => ({ token, expiresAt: 'x' }),
      saveLogin: async (saved: string, expiresAt: string) => (log.push(`save ${saved.length} ${expiresAt}`), true),
      clearLogin: async () => void log.push('clear'),
    } as unknown as YiNative;
    const store = loginStoreOf(yi);
    if (!store) throw new Error('给出 yiNative 时应当有保存处');
    expect(await store.load()).toEqual({ token, expiresAt: 'x' });
    expect(await store.save(token, 'later')).toBe(true);
    await store.clear();
    expect(log).toEqual(['save 32 later', 'clear']);
  });
});

describe('换算与检查', () => {
  it('邮件语言取界面语言的标记', () => {
    expect(mailLanguage(Lang.ZH)).toBe('zh-Hans');
    expect(mailLanguage(Lang.WY)).toBe('lzh');
    expect(mailLanguage(Lang.EN)).toBe('en-GB');
  });

  it('错误提示：字段格式错误按字段，表中有的取原文，其余按服务器出现问题', () => {
    const p = (code: string, field?: string) => ({ status: 400, code, level: 'E2' as const, ...(field ? { field } : {}) });
    expect(problemText(p('request.invalid', 'password'))).toBe('密码至少 8 位');
    expect(problemText(p('request.invalid', 'email'))).toBe('邮箱地址的格式不正确');
    expect(problemText(p('request.invalid', 'nickname'))).toBe(ERRORS['request.invalid'].text);
    expect(problemText(p('request.invalid'))).toBe(ERRORS['request.invalid'].text);
    expect(problemText(p('auth.credentials-invalid'))).toBe('邮箱或密码不正确');
    expect(problemText(p('future.thing'))).toBe(ERRORS['server.internal'].text);
  });

  it('邮箱只拦下明显写错的；密码按码点计 8 位；验证码须为 6 位数字', () => {
    expect(emailLooksValid(' player@example.com ')).toBe(true);
    expect(emailLooksValid('player@example')).toBe(false);
    expect(emailLooksValid('player example.com')).toBe(false);
    expect(emailLooksValid(`${'a'.repeat(243)}@example.com`)).toBe(false); // 255 字节
    expect(emailLooksValid(`${'a'.repeat(242)}@example.com`)).toBe(true);
    expect(passwordLongEnough('密码密码密码密码')).toBe(true);
    expect(passwordLongEnough('😀😀😀😀😀😀😀')).toBe(false); // 7 个码点、14 个码元
    expect(passwordLongEnough('1234567')).toBe(false);
    expect(codeComplete('962914')).toBe(true);
    expect(codeComplete('96291')).toBe(false);
    expect(codeComplete('96291a')).toBe(false);
    expect(codeComplete('9629145')).toBe(false);
  });
});

describe('六格验证码', () => {
  const empty = ['', '', '', '', '', ''];

  it('键入一位覆盖当前格并跳到下一格；最后一格停在原处；非数字不动', () => {
    expect(fillCells(empty, 0, '9')).toEqual({ cells: ['9', '', '', '', '', ''], focus: 1 });
    expect(fillCells(['9', '6', '2', '', '', ''], 1, '4')).toEqual({ cells: ['9', '4', '2', '', '', ''], focus: 2 });
    expect(fillCells(['9', '6', '2', '9', '1', ''], 5, '4')).toEqual({ cells: ['9', '6', '2', '9', '1', '4'], focus: 5 });
    expect(fillCells(['9', '', '', '', '', ''], 1, 'a')).toEqual({ cells: ['9', '', '', '', '', ''], focus: 1 });
  });

  it('粘贴满六位时无论在哪一格都从第一格填满，夹杂的空格与换行忽略', () => {
    expect(fillCells(['1', '1', '1', '1', '', ''], 3, ' 962 914\n')).toEqual({ cells: ['9', '6', '2', '9', '1', '4'], focus: 5 });
  });

  it('粘贴不足六位时从当前格起填，超出末格的部分丢弃', () => {
    expect(fillCells(empty, 2, '12')).toEqual({ cells: ['', '', '1', '2', '', ''], focus: 4 });
    expect(fillCells(empty, 4, '123')).toEqual({ cells: ['', '', '', '', '1', '2'], focus: 5 });
  });

  it('退格：本格有数字时清空本格；本格为空时清空上一格并回到上一格；第一格为空时不动', () => {
    expect(backspaceCells(['9', '6', '2', '', '', ''], 2)).toEqual({ cells: ['9', '6', '', '', '', ''], focus: 2 });
    expect(backspaceCells(['9', '6', '2', '', '', ''], 3)).toEqual({ cells: ['9', '6', '', '', '', ''], focus: 2 });
    expect(backspaceCells(empty, 0)).toEqual({ cells: empty, focus: 0 });
  });

  it('不改动传入的数组', () => {
    const cells = ['9', '', '', '', '', ''];
    fillCells(cells, 1, '6');
    backspaceCells(cells, 0);
    expect(cells).toEqual(['9', '', '', '', '', '']);
  });
});

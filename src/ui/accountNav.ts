/** 账号页的导航：当前一屏（登录、注册、找回密码、账号资料、修改雅号、修改密码）与各屏之间共用的邮箱输入 */
import { signal } from '@preact/signals';
import { goScreen } from '../app/controller';
import { Screen } from '../app/state';

/** 账号页的各屏 */
export type AccountView = 'login' | 'register' | 'reset' | 'profile' | 'rename' | 'password';

/** 当前一屏 */
export const accountView = signal<AccountView>('login');
/** 登录、注册、找回密码之间带过去的邮箱：在登录页填过的邮箱，转到找回密码时不必再填 */
export const typedEmail = signal('');

/** 打开账号页的某一屏（从多人游戏进入时面板滑入） */
export function openAccount(view: AccountView) {
  accountView.value = view;
  goScreen(Screen.Account);
}

/** 返回：修改雅号、修改密码回到账号资料；找回密码回到登录；其余回到多人游戏 */
export function accountBack() {
  const view = accountView.value;
  if (view === 'rename' || view === 'password') accountView.value = 'profile';
  else if (view === 'reset') accountView.value = 'login';
  else goScreen(Screen.Online);
}

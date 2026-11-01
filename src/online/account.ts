/**
 * 当前登录（阶段 6、7 设计第 5.4 条、账号接口契约第 6 章）：令牌只在内存中持有，桌面版经 LoginStore 加密保存以便下次启动恢复，
 * 浏览器调试时不保存（刷新即退出）。任何需要登录的请求收到 401 auth.required 时清除登录；网络中断时保留，不误判为退出。
 * 联机层不使用界面状态库（ARC 第 1.1 条），变化经 onChange 通知，由界面层自行包装。
 */
import type { AccountApi, AccountProblem, AccountResult, AccountUser, RegisterForm, SignedIn } from './accountApi';

/** 加密保存登录的地方（桌面版为 yiNative 的 loadLogin、saveLogin、clearLogin） */
export interface LoginStore {
  load(): Promise<{ token: string; expiresAt: string } | undefined>;
  save(token: string, expiresAt: string): Promise<boolean>;
  clear(): Promise<void>;
}

/** 当前登录的快照：令牌不对外暴露，saved 表示已加密保存（为假时只在本次运行中有效） */
export interface LoginState {
  user?: AccountUser;
  saved: boolean;
}

/** 登录状态失效的错误码：令牌缺失、过期或被撤销 */
const SIGNED_OUT = 'auth.required';

/** 当前登录 */
export class AccountSession {
  private token?: string;
  private state: LoginState = { saved: false };
  private readonly listeners = new Set<(state: LoginState) => void>();

  constructor(
    private readonly api: AccountApi,
    private readonly store?: LoginStore,
  ) {}

  /** 当前快照 */
  get current(): LoginState {
    return this.state;
  }

  /** 是否已登录（有令牌；资料可能因网络中断暂未取得） */
  get signedIn(): boolean {
    return this.token !== undefined;
  }

  /** 登记变化的通知；返回取消函数 */
  onChange(listener: (state: LoginState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 启动时恢复保存的登录：令牌失效时清除；网络中断时保留令牌，资料留空，稍后可再取 */
  async restore(): Promise<AccountResult<AccountUser> | undefined> {
    const saved = await this.loadSaved();
    if (!saved) return undefined;
    this.token = saved.token;
    this.update({ saved: true });
    return this.refresh();
  }

  /** 重新取当前资料 */
  async refresh(): Promise<AccountResult<AccountUser>> {
    return this.authed(
      token => this.api.me(token),
      user => this.update({ ...this.state, user }),
    );
  }

  /** 邮箱与密码登录 */
  async login(email: string, password: string): Promise<AccountResult<AccountUser>> {
    return this.begin(await this.api.login(email, password));
  }

  /** 注册并登录 */
  async register(form: RegisterForm): Promise<AccountResult<AccountUser>> {
    return this.begin(await this.api.register(form));
  }

  /** 退出：通知服务端撤销（失败也照样在本机退出），清除内存与保存的登录 */
  async logout(): Promise<void> {
    const token = this.token;
    await this.end();
    if (token !== undefined) await this.api.logout(token);
  }

  /** 修改雅号 */
  async rename(name: string): Promise<AccountResult<AccountUser>> {
    return this.authed(
      token => this.api.rename(token, name),
      user => this.update({ ...this.state, user }),
    );
  }

  /** 同意当前必需的协议版本 */
  async acceptConsents(consent: RegisterForm['consent']): Promise<AccountResult<AccountUser>> {
    return this.authed(
      token => this.api.acceptConsents(token, consent),
      user => this.update({ ...this.state, user }),
    );
  }

  /** 修改密码：成功后服务端撤销全部会话，本机随之退出，须重新登录 */
  async changePassword(oldPassword: string, password: string): Promise<AccountResult<void>> {
    return this.authed(
      token => this.api.changePassword(token, oldPassword, password),
      () => this.end(),
    );
  }

  /** 开始一次登录：保存令牌（加密不可用时只在内存中） */
  private async begin(result: AccountResult<SignedIn>): Promise<AccountResult<AccountUser>> {
    if (!result.ok) return result;
    const { token, expiresAt, user } = result.value;
    this.token = token;
    this.update({ user, saved: false });
    const saved = (await this.saveSafely(token, expiresAt)) && this.token === token;
    if (saved) this.update({ ...this.state, saved: true });
    return { ok: true, value: user };
  }

  /** 需要登录的调用：没有令牌或收到 auth.required 时清除登录 */
  private async authed<T>(call: (token: string) => Promise<AccountResult<T>>, done: (value: T) => void | Promise<void>): Promise<AccountResult<T>> {
    const token = this.token;
    if (token === undefined) return { ok: false, problem: signedOut() };
    const result = await call(token);
    if (this.token !== token) return result; // 等待期间已退出或换了账号：结果不再作用于当前登录
    if (result.ok) await done(result.value);
    else if (result.problem.code === SIGNED_OUT) await this.end();
    return result;
  }

  /** 清除内存与保存的登录 */
  private async end(): Promise<void> {
    this.token = undefined;
    this.update({ saved: false });
    try {
      await this.store?.clear();
    } catch {
      // 删不掉保存的登录：下次启动时其令牌已在服务端失效，恢复时会被清除
    }
  }

  /** 读取保存的登录；出错按没有处理 */
  private async loadSaved() {
    try {
      return await this.store?.load();
    } catch {
      return undefined; // 读取失败：按未登录处理，游戏照常运行
    }
  }

  /** 保存登录；出错或没有保存处时为假 */
  private async saveSafely(token: string, expiresAt: string): Promise<boolean> {
    try {
      return (await this.store?.save(token, expiresAt)) === true;
    } catch {
      return false; // 保存失败：本次运行中仍保持登录
    }
  }

  /** 更新快照并通知 */
  private update(state: LoginState): void {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

/** 没有登录时调用需要登录的接口 */
function signedOut(): AccountProblem {
  return { status: 401, code: SIGNED_OUT, level: 'E2' };
}

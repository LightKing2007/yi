/** 桌面更新状态机：检查、下载和安装互斥；只有玩家明确操作才下载或退出安装（EDGE-002）。 */

const PERCENT_MAX = 100;

/** 页面可请求的有限操作；版本、下载地址和文件路径均由主进程决定。 */
export type UpdateAction = 'status' | 'check' | 'download' | 'install';
/** 更新过程公开给页面的状态，不暴露文件路径或内部异常。 */
export interface UpdateState {
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';
  version: string;
  percent: number;
  automatic: boolean;
  failed?: 'check' | 'download' | 'install';
}
/** 原生更新器的系统边界，测试中以可控制的网络和安装器替换。 */
export interface UpdateDriver {
  check(): Promise<string | null>;
  download(progress: (percent: number) => void): Promise<void>;
  install(): void;
}
/** 集中验证 IPC 操作，拒绝任意命令与参数（SEC-032）。 */
export function isUpdateAction(value: unknown): value is UpdateAction {
  return value === 'status' || value === 'check' || value === 'download' || value === 'install';
}
/** 同一时刻只运行一个更新操作；失败保留版本号，并允许从失败步骤重试。 */
export class UpdateController {
  private state: UpdateState;
  private pending: Promise<UpdateState> | undefined;

  constructor(
    private readonly driver: UpdateDriver,
    private readonly notify: (state: UpdateState) => void,
    private readonly warn: (err: unknown) => void,
    automatic: boolean,
  ) {
    this.state = { phase: 'idle', version: '', percent: 0, automatic };
  }

  /** 返回副本，防止调用方篡改安装条件。 */
  snapshot(): UpdateState {
    return { ...this.state };
  }

  /** 无效顺序的操作无副作用；重复点击复用正在进行的请求。 */
  run(action: UpdateAction): Promise<UpdateState> {
    if (action === 'status') return Promise.resolve(this.snapshot());
    if (this.pending) return this.pending;
    if (this.state.phase === 'installing') return Promise.resolve(this.snapshot());
    const task = this.perform(action).catch(err => {
      this.fail(action, err);
    });
    this.pending = task.then(() => {
      this.pending = undefined;
      return this.snapshot();
    });
    return this.pending;
  }

  /** 安装器以事件异步报告的错误也回到可操作状态。 */
  fail(action: Exclude<UpdateAction, 'status'>, err: unknown): void {
    this.warn(err);
    this.set({ phase: 'error', failed: action });
  }

  private set(change: Partial<UpdateState>): void {
    this.state = { ...this.state, failed: undefined, ...change };
    this.notify(this.snapshot());
  }

  private async download(): Promise<void> {
    if (!this.state.automatic || !(this.state.phase === 'available' || (this.state.phase === 'error' && this.state.failed === 'download'))) return;
    if (this.state.phase === 'error') {
      // 官网可能已切换到更新的版本；失败重试先刷新清单，避免反复请求已经下架的旧程序。
      await this.perform('check');
      if (this.snapshot().phase !== 'available') return;
    }
    this.set({ phase: 'downloading', percent: 0 });
    await this.driver.download(percent => {
      if (Number.isFinite(percent)) this.set({ percent: Math.max(0, Math.min(PERCENT_MAX, Math.floor(percent))) });
    });
    this.set({ phase: 'ready', percent: PERCENT_MAX });
  }

  private async perform(action: Exclude<UpdateAction, 'status'>): Promise<void> {
    if (action === 'check') {
      if (this.state.phase === 'ready') return;
      this.set({ phase: 'checking', percent: 0 });
      const version = await this.driver.check();
      this.set({ phase: version ? 'available' : 'idle', version: version ?? '' });
    } else if (action === 'download') {
      await this.download();
    } else if (this.state.automatic && (this.state.phase === 'ready' || (this.state.phase === 'error' && this.state.failed === 'install'))) {
      this.set({ phase: 'installing' });
      this.driver.install();
    }
  }
}

/** macOS 暂从官网既有校验清单找新版本，不建立账号或对战连接。 */
export function latestMacVersion(sums: string, current: string, arch: string): string | null {
  const newer = (left: string, right: string) => {
    const parts = left.split('.').map(Number),
      other = right.split('.').map(Number);
    for (let i = 0; i < parts.length; i++) if (parts[i] !== other[i]) return (parts[i] ?? 0) > (other[i] ?? 0);
    return false;
  };
  let latest = current;
  for (const line of sums.split('\n')) {
    const match = /^[a-f0-9]{64} {2}Yi-(\d+\.\d+\.\d+)-mac-(arm64|x64)\.dmg$/.exec(line);
    if (match?.[1] && match[2] === arch && newer(match[1], latest)) latest = match[1];
  }
  return latest === current ? null : latest;
}

/** 必需协议版本与明确同意的仓储；版本来自服务端，记录时刻来自受控时钟。 */
import type { DatabaseSync } from 'node:sqlite';
import { transaction } from './transaction';

const VERSION_MAX_LENGTH = 64;
const VERSION_FORMAT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** 服务端发布的两种必需版本；不接收客户端指定当前版本。 */
export interface RequiredConsents {
  privacy: string;
  terms: string;
}
/** 入库的准确版本；accepted 动作已由 acceptance 检查。 */
export interface ConsentRecord {
  kind: 'privacy' | 'terms';
  version: string;
}

/** 版本以有限 ASCII 标记保存；格式不合法时不启动相关认证业务。 */
function validVersion(value: string): boolean {
  return typeof value === 'string' && value.length <= VERSION_MAX_LENGTH && value.trim() === value && VERSION_FORMAT.test(value);
}

/** 一个实例固定一组版本，更新协议时重新装配；不能暗中修改既有同意记录。 */
export class ConsentRepo {
  private readonly required: Readonly<RequiredConsents>;
  private readonly read;
  private readonly write;
  private readonly active;

  constructor(
    private readonly db: DatabaseSync,
    required: RequiredConsents,
  ) {
    if (!validVersion(required.privacy) || !validVersion(required.terms)) throw new Error('consent-policy-invalid');
    this.required = Object.freeze({ ...required });
    this.read = db.prepare('SELECT 1 FROM consents WHERE user_id = ? AND kind = ? AND document_version = ? AND consented_at <= ?');
    this.write = db.prepare(
      'INSERT INTO consents (user_id, kind, document_version, consented_at) VALUES (?, ?, ?, ?) ' + 'ON CONFLICT (user_id, kind, document_version) DO NOTHING',
    );
    this.active = db.prepare("SELECT 1 FROM accounts WHERE user_id = ? AND status = 'active' AND created_at <= ?");
  }

  /** 必须有明确同意动作并提交两份准确版本，返回值可交给原子注册。 */
  acceptance(value: unknown): readonly ConsentRecord[] | undefined {
    if (!value || typeof value !== 'object' || !('accepted' in value) || value.accepted !== true) return undefined;
    if (!('privacy' in value) || !('terms' in value) || value.privacy !== this.required.privacy || value.terms !== this.required.terms) return undefined;
    return [
      { kind: 'privacy', version: this.required.privacy },
      { kind: 'terms', version: this.required.terms },
    ];
  }

  /** 旧版本及未来时刻不满足当前要求，不能只检查“有同意过”布尔值。 */
  current(userId: number, now: number): boolean {
    this.clock(now);
    return ['privacy', 'terms'].every(kind => this.read.get(userId, kind, kind === 'privacy' ? this.required.privacy : this.required.terms, now) !== undefined);
  }

  /** 仅对活动且已创建的账号记同意；重复提交保留首次同意时刻，支持更大外层事务。 */
  accept(userId: number, value: unknown, now: number): boolean {
    this.clock(now);
    const records = this.acceptance(value);
    if (!records) return false;
    return transaction(this.db, () => {
      if (!this.active.get(userId, now)) return false;
      for (const item of records) this.write.run(userId, item.kind, item.version, now);
      return true;
    });
  }

  /** 不能用无效时间跳过当前版本或制造没有期限的同意。 */
  private clock(now: number): void {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('auth-clock-invalid');
  }
}

/** 账号仓储：原子创建、公开 UID 有界碰撞重试及账号索引查询；不接通注册或现有游客握手（DAT-040、DAT-044）。 */
import type { DatabaseSync } from 'node:sqlite';
import { parsePublicId } from '../../src/shared/publicId';
import type { ProtectedEmail } from '../emailProtection';
import { newPublicId } from '../publicId';
import { transaction } from './transaction';

const PUBLIC_ID_ATTEMPTS = 5;

/** 已由认证业务验证邮箱、密码及协议内容；仓储不接受明文邮箱或原始密码。 */
export interface NewAccount {
  name: string;
  emailLookup: string;
  passwordHash: string;
  now: number;
  consents: readonly { kind: 'privacy' | 'terms'; version: string }[];
}

/** 内部认证资料；不得直接作为公开 HTTP 响应。 */
export interface StoredAccount {
  userId: number;
  publicId: string;
  name: string;
  passwordHash: string;
  emailLookup: string;
  email: ProtectedEmail;
  authVersion: number;
  emailVerifiedAt: number;
}

/** 数据行转为内部认证资料；查询只返回 active 账号。 */
function account(row: Record<string, unknown> | undefined): StoredAccount | undefined {
  if (!row) return undefined;
  return {
    userId: Number(row.user_id),
    publicId: String(row.public_id),
    name: String(row.name),
    passwordHash: String(row.pass_hash),
    emailLookup: String(row.email_lookup),
    email: { v: 1, keyId: String(row.email_key_id), nonce: String(row.email_nonce), tag: String(row.email_tag), ciphertext: String(row.email_cipher) },
    authVersion: Number(row.auth_version),
    emailVerifiedAt: Number(row.email_verified_at),
  };
}

/** 全部 SQL 在仓储预编译，索引查询按唯一标识定位（DAT-032、DAT-045）。 */
function statements(db: DatabaseSync) {
  const select = "SELECT accounts.*, users.name FROM accounts JOIN users ON users.id = accounts.user_id WHERE status = 'active' AND ";
  return {
    byLookup: db.prepare(select + 'email_lookup = ?'),
    byPublicId: db.prepare(select + 'public_id = ?'),
    byUserId: db.prepare(select + 'user_id = ?'),
    usedPublicId: db.prepare('SELECT 1 FROM accounts WHERE public_id = ?'),
    insertUser: db.prepare("INSERT INTO users (kind, name, created_at, last_seen_at) VALUES ('member', ?, ?, ?)"),
    insertAccount: db.prepare(
      'INSERT INTO accounts (user_id, public_id, email_version, email_key_id, email_nonce, email_tag, email_cipher, ' +
        'email_lookup, email_verified_at, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ),
    consent: db.prepare('INSERT INTO consents (user_id, kind, document_version, consented_at) VALUES (?, ?, ?, ?)'),
  };
}

/** 支持同步外层认证事务；加密回调必须同步，不访问网络。 */
export class AccountRepo {
  private readonly sql;

  constructor(
    private readonly db: DatabaseSync,
    private readonly nextPublicId: () => string = newPublicId,
  ) {
    this.sql = statements(db);
  }

  /** 登录与唯一邮箱注册使用相同的规范化 HMAC 查找标识，不扫描或逐行解密。 */
  byEmailLookup(lookup: string): StoredAccount | undefined {
    return account(this.sql.byLookup.get(lookup));
  }

  /** 公开查找也必须先校验 UID；内部认证字段不得透传给公开资料接口。 */
  byPublicId(id: string): StoredAccount | undefined {
    const canonical = parsePublicId(id);
    return canonical ? account(this.sql.byPublicId.get(canonical)) : undefined;
  }

  /** 认证会话使用固定内部主键，不能从设备标识猜测账号。 */
  byUserId(userId: number): StoredAccount | undefined {
    return account(this.sql.byUserId.get(userId));
  }

  /** 创建用户、账号与协议同意同一事务提交；失败时不遗留用户或泄露邮箱。 */
  create(input: NewAccount, seal: (userId: number) => ProtectedEmail): StoredAccount {
    if (!input.consents.some(item => item.kind === 'privacy')) throw new Error('account-privacy-required');
    return transaction(this.db, () => {
      if (this.byEmailLookup(input.emailLookup)) throw new Error('account-email-taken');
      const publicId = this.availablePublicId();
      const userId = Number(this.sql.insertUser.run(input.name, input.now, input.now).lastInsertRowid);
      const email = seal(userId);
      this.sql.insertAccount.run(
        userId,
        publicId,
        email.v,
        email.keyId,
        email.nonce,
        email.tag,
        email.ciphertext,
        input.emailLookup,
        input.now,
        input.passwordHash,
        input.now,
      );
      for (const item of input.consents) this.sql.consent.run(userId, item.kind, item.version, input.now);
      const stored = this.byUserId(userId);
      if (!stored) throw new Error('account-create-failed');
      return stored;
    });
  }

  /** 检查也覆盖已注销账号，已发放的公开编号不能重新分配。 */
  private availablePublicId(): string {
    for (let attempt = 0; attempt < PUBLIC_ID_ATTEMPTS; attempt++) {
      const candidate = this.nextPublicId();
      if (parsePublicId(candidate) !== candidate) throw new Error('account-public-id-invalid');
      if (!this.sql.usedPublicId.get(candidate)) return candidate;
    }
    throw new Error('account-public-id-exhausted');
  }
}

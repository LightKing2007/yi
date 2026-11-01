/**
 * 桌面版的登录状态保存（阶段 6、7 设计第 5.4 条、DAT-083）：登录令牌只在主进程用系统的加密存储（safeStorage）加密后写入
 * userData/account.bin，页面经 IPC 读写，不落明文。加密不可用（含 Linux 上只有明文后端）时不保存，文件损坏、过期或格式不符时
 * 删除并视为未登录。不依赖 electron，加密与读写文件由调用者注入，便于测试。
 */

/** 令牌：32 位小写十六进制（API-013） */
const TOKEN = /^[0-9a-f]{32}$/;
/** 期限：RFC 3339 UTC，与账号接口的 expiresAt 一致（API-062） */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
/** 加密文件的字节上限：远大于一条登录记录，超过即视为损坏 */
const FILE_MAX_BYTES = 4096;
/** 保存格式的版本 */
const FORMAT = 1;

/** 是不是 JSON 对象（electron 层不能引用 src/shared/check.ts，ARC 第 1.1 条） */
const isRecord = (val: unknown): val is Record<string, unknown> => typeof val === 'object' && val !== null && !Array.isArray(val);
/** 对象自身的字段；不是对象或没有该字段时为 undefined，不读原型链上的属性 */
const field = (obj: unknown, key: string): unknown => (isRecord(obj) && Object.hasOwn(obj, key) ? obj[key] : undefined);

/** 系统加密存储；available 为假时不能保存 */
export interface Cipher {
  available(): boolean;
  encrypt(text: string): Buffer;
  decrypt(data: Buffer): string;
}

/** 保存文件的读写；read 在文件不存在时为 undefined */
export interface Disk {
  read(): Buffer | undefined;
  write(data: Buffer): void;
  remove(): void;
}

/** 一次登录：令牌与绝对期限 */
export interface SavedLogin {
  token: string;
  expiresAt: string;
}

/** 校验页面或文件给出的登录记录；不合格时为 undefined */
export function savedLogin(token: unknown, expiresAt: unknown): SavedLogin | undefined {
  if (typeof token !== 'string' || !TOKEN.test(token) || typeof expiresAt !== 'string' || !ISO_UTC.test(expiresAt)) return undefined;
  return Number.isFinite(Date.parse(expiresAt)) ? { token, expiresAt } : undefined;
}

/**
 * 系统加密存储在本机是否可用：Linux 上没有密钥环时 Electron 退为明文后端 basic_text，等于没有加密，视为不可用；
 * backend 为 Linux 上 safeStorage.getSelectedStorageBackend() 的结果，其他系统不需要
 */
export function encryptionUsable(available: boolean, platform: string, backend?: string): boolean {
  if (!available) return false;
  return platform !== 'linux' || (backend !== undefined && backend !== 'basic_text' && backend !== 'unknown');
}

/** 登录状态的保存处 */
export class CredentialStore {
  constructor(
    private readonly cipher: Cipher,
    private readonly disk: Disk,
    private readonly now: () => number,
  ) {}

  /** 读取保存的登录；不存在、无法解密、格式不符或已过期时删除文件（存在时）并返回 undefined */
  load(): SavedLogin | undefined {
    const data = this.read();
    if (data === undefined) return undefined;
    const login = this.decode(data);
    if (login && Date.parse(login.expiresAt) > this.now()) return login;
    this.clear();
    return undefined;
  }

  /** 保存一次登录；记录不合格或加密不可用时不写任何文件并返回 false，不降级为明文 */
  save(token: unknown, expiresAt: unknown): boolean {
    const login = savedLogin(token, expiresAt);
    if (!login || !this.cipher.available()) return false;
    try {
      this.disk.write(this.cipher.encrypt(JSON.stringify({ v: FORMAT, ...login })));
      return true;
    } catch {
      return false; // 加密失败或磁盘写不了：本次登录只在内存中有效，下次启动需重新登录
    }
  }

  /** 退出登录、换账号或令牌失效时删除保存的登录；删不掉（如目录只读）时不抛出，下次读取仍会按过期或损坏处理 */
  clear(): void {
    try {
      this.disk.remove();
    } catch {
      // 删除失败不能让页面的读取或退出出错：未登录照常生效，残留的文件下次读取时再判定
    }
  }

  /** 读文件；读取出错按不存在处理 */
  private read(): Buffer | undefined {
    try {
      return this.disk.read();
    } catch {
      return undefined; // 无权读取等情况：视为未登录，游戏照常运行
    }
  }

  /** 解密并解析；任何一步失败都为 undefined */
  private decode(data: Buffer): SavedLogin | undefined {
    if (data.length === 0 || data.length > FILE_MAX_BYTES || !this.cipher.available()) return undefined;
    try {
      const value: unknown = JSON.parse(this.cipher.decrypt(data));
      return field(value, 'v') === FORMAT ? savedLogin(field(value, 'token'), field(value, 'expiresAt')) : undefined;
    } catch {
      return undefined; // 换了系统用户、钥匙串被重置或文件损坏：解不开即视为未登录
    }
  }
}

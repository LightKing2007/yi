/**
 * 账号功能的配置（ARC-042，由 config.ts 调用）：开关 `YI_ACCOUNTS` 默认关闭；打开时必须给出两份协议的必需版本，
 * 密钥与发信凭据经 systemd 的 `LoadCredential=` 传入（SEC-051），这里只记下凭据目录 `CREDENTIALS_DIRECTORY`，内容由 accountSecrets.ts 读取。
 */

/** 账号功能打开时的配置 */
export interface AccountConfig {
  /** 必需的隐私政策版本（`YI_PRIVACY_VERSION`） */
  privacyVersion: string;
  /** 必需的服务条款版本（`YI_TERMS_VERSION`） */
  termsVersion: string;
  /** systemd 凭据目录的绝对路径（`CREDENTIALS_DIRECTORY`，由 `LoadCredential=` 设置） */
  credentialsDir: string;
  /** 全局每分钟发送验证码的上限（`YI_CODE_BUDGET`，1 至 1000，默认 30），按邮件服务商的配额设定 */
  codeBudget: number;
  /** 本机开发时额外允许的来源（`YI_DEV_ORIGIN`，只接受 http://localhost:端口 或 http://127.0.0.1:端口） */
  devOrigin?: string;
}

/** 环境变量 */
type Env = Record<string, string | undefined>;
/** 记下一项校验失败 */
type Fail = (variable: string, expected: string) => void;

const VERSION = /^[0-9A-Za-z][0-9A-Za-z.-]{0,31}$/;
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):[1-9][0-9]{0,4}$/;
const BUDGET = /^[1-9][0-9]{0,3}$/;
const BUDGET_MAX = 1000;
const BUDGET_DEFAULT = 30;

/** 协议版本：必填，未设置或不合格时记为一项错误 */
function version(env: Env, variable: string, fail: Fail): string {
  const value = env[variable] ?? '';
  if (!VERSION.test(value)) fail(variable, '1 至 32 位字母、数字、点或连字符');
  return value;
}

/** 解析账号功能的配置；开关未打开时为 undefined，其余各项不检查 */
export function parseAccountConfig(env: Env, fail: Fail): AccountConfig | undefined {
  const flag = env.YI_ACCOUNTS ?? '';
  if (flag !== '' && flag !== '0' && flag !== '1') fail('YI_ACCOUNTS', '0 或 1');
  if (flag !== '1') return undefined;
  const privacyVersion = version(env, 'YI_PRIVACY_VERSION', fail);
  const termsVersion = version(env, 'YI_TERMS_VERSION', fail);
  const credentialsDir = env.CREDENTIALS_DIRECTORY ?? '';
  if (!credentialsDir.startsWith('/')) fail('CREDENTIALS_DIRECTORY', '由 systemd 的 LoadCredential= 设置的绝对路径');
  const budgetText = env.YI_CODE_BUDGET;
  const budget = budgetText === undefined ? BUDGET_DEFAULT : Number(budgetText);
  if (budgetText !== undefined && (!BUDGET.test(budgetText) || budget > BUDGET_MAX)) fail('YI_CODE_BUDGET', '1 至 1000 的整数');
  const devOrigin = env.YI_DEV_ORIGIN;
  if (devOrigin !== undefined && !DEV_ORIGIN.test(devOrigin)) fail('YI_DEV_ORIGIN', 'http://localhost:端口 或 http://127.0.0.1:端口');
  return { privacyVersion, termsVersion, credentialsDir, codeBudget: budget, devOrigin };
}

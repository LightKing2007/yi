/** 账号认证的时间和规模边界，调用方注入毫秒时钟；现有联机协议尚未接入（SEC-021）。 */
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const ABSOLUTE_DAYS = 30;
const IDLE_DAYS = 7;
const DAY_MS = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
/** 登录绝对期限，不能通过活动续期。 */
export const SESSION_LIFETIME_MS = ABSOLUTE_DAYS * DAY_MS;
/** 连续闲置到此期限即失效，边界时刻不再允许续活。 */
export const SESSION_IDLE_MS = IDLE_DAYS * DAY_MS;
/** 随机令牌碰撞时的最大尝试次数，耗尽明确失败。 */
export const SESSION_TOKEN_ATTEMPTS = 5;

const FAILURE_WINDOW_MINUTES = 15;
const LOGIN_LOCK_MINUTES = 15;
/** 一分钟的毫秒数 */
export const MINUTE_MS = SECONDS_PER_MINUTE * MS_PER_SECOND;
/** 同账号失败统计采用滚动十五分钟窗口（SEC-023）。 */
export const LOGIN_FAILURE_WINDOW_MS = FAILURE_WINDOW_MINUTES * MINUTE_MS;
/** 第五次失败起锁定十五分钟，锁定期间重试不延长期限。 */
export const LOGIN_LOCK_MS = LOGIN_LOCK_MINUTES * MINUTE_MS;
/** 达到此失败次数即锁定账号（SEC-023）。 */
export const LOGIN_FAILURES = 5;
/** 登录及其他密码派生入口共享同来源每分钟上限（SEC-023）。 */
export const LOGIN_IP_ATTEMPTS = 10;
/** 登录来源统计窗口。 */
export const LOGIN_IP_WINDOW_MS = MINUTE_MS;

const CODE_TTL_MINUTES = 10;
const CODE_SEND_TIMEOUT_SECS = 30;
/** 验证码有效十分钟，精确到期即不可用。 */
export const CODE_TTL_MS = CODE_TTL_MINUTES * MINUTE_MS;
/** 同一挑战最多五次错误，之后须按原限额重新申请。 */
export const CODE_ATTEMPTS = 5;
/** 同邮箱所有用途共享六十秒冷却。 */
export const CODE_COOLDOWN_MS = MINUTE_MS;
/** 同邮箱滚动一天最多十次，发送失败也计入。 */
export const CODE_EMAIL_BUDGET = 10;
/** 同来源滚动一小时最多十次。 */
export const CODE_SOURCE_BUDGET = 10;
/** 来源统计窗口。 */
export const CODE_SOURCE_WINDOW_MS = MINUTES_PER_HOUR * MINUTE_MS;
/** 邮箱日限额的窗口。 */
export const CODE_EMAIL_WINDOW_MS = DAY_MS;
/** 全局预算由装配层必填，本常量仅定义其一分钟窗口。 */
export const CODE_GLOBAL_WINDOW_MS = MINUTE_MS;
/** 单次发送等待上限；超时不能确认交付，标记 unknown。 */
export const CODE_SEND_TIMEOUT_MS = CODE_SEND_TIMEOUT_SECS * MS_PER_SECOND;
/** 随机挑战编号碰撞重试上限。 */
export const CODE_ID_ATTEMPTS = 5;

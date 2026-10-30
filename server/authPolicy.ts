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
const MINUTE_MS = SECONDS_PER_MINUTE * MS_PER_SECOND;
/** 同账号失败统计采用滚动十五分钟窗口（SEC-023）。 */
export const LOGIN_FAILURE_WINDOW_MS = FAILURE_WINDOW_MINUTES * MINUTE_MS;
/** 第五次失败起锁定十五分钟，锁定期间重试不延长期限。 */
export const LOGIN_LOCK_MS = LOGIN_LOCK_MINUTES * MINUTE_MS;
/** 达到此失败次数即锁定账号（SEC-023）。 */
export const LOGIN_FAILURES = 5;
/** 同一来源每分钟登录请求上限（SEC-023）。 */
export const LOGIN_IP_ATTEMPTS = 10;
/** 登录来源统计窗口。 */
export const LOGIN_IP_WINDOW_MS = MINUTE_MS;

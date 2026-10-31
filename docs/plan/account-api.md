# 弈 · 账号 HTTP 接口契约

| 项目 | 内容 |
|---|---|
| 文件版本 | 0.4 |
| 修订日期 | 2026-11-01（Asia/Shanghai） |
| 状态 | 2026-11-01 经项目所有者确认（#228）；业务补充与路由处理已实现（`server/accountApi.ts`、`server/accountRoutes.ts`），尚未装配到联机程序，线上 `/api/*` 仍一律返回 404 |
| 相关文档 | [阶段 6、7 设计](phase6-7.md)、[下一步计划](next-development.md)、[接口规范](../standards/04-api.md)、[安全规范](../standards/05-security.md)、[数据规范](../standards/03-data.md) |

本契约是 [下一步计划](next-development.md) 第 13.4 节第 1 项的前置条件，定义批次 D（账号 HTTP 与邮件边界）与批次 E（桌面安全存储与账号界面）共同遵守的路径、请求、响应与错误。实现以本契约为准；[阶段 6、7 设计](phase6-7.md) 第 5 章的接口表为早期草拟，路径与名称以本文为准。本契约不涉及联机协议第 4 版的 `hello` 字段，该部分随批次 F 另行定稿。

## 1 范围与原则

1.1 接口只由联机程序提供。Caddy 已将 `/api/*` 转发到联机程序（`scripts/server/yi.caddy`），官网程序不处理任何账号请求。未装配的路径统一返回 404，与 API-060 一致。

1.2 全部路径以 `/api/v1/` 开头（API-062）。字段名为 lowerCamelCase，时刻为 RFC 3339 UTC 字符串（如 `2026-11-30T08:00:00.000Z`），等待时长沿用协议已有的 `retryAfterMs` 毫秒整数。

1.3 服务端只做认证与资料的权威判定；客户端校验只用于提前提示，不能代替服务端校验（API-010 的原则同样适用于 HTTP）。

1.4 业务层已有实现（`server/authentication.ts`、`server/emailCodes.ts`）。本契约要求的少量业务补充见第 7 章，实现时与路由一并完成，并各自补充测试。

## 2 通用约定

### 2.1 请求

| 项目 | 规定 |
|---|---|
| 方法 | 每个路径只接受第 3 章列出的方法；其他方法返回 405 并带 `Allow` 头；`OPTIONS` 只用于跨源预检（第 2.4 条） |
| 内容类型 | 带请求体的请求必须为 `Content-Type: application/json`，允许 `charset=utf-8` 参数，其他取值返回 400 `request.invalid` |
| 请求体上限 | 4096 字节，按实际读取的字节计，不信任 `Content-Length`；超出时立即停止读取并返回 413 `request.too-large` |
| 请求体格式 | 合法 UTF-8 编码的单个 JSON 对象；顶层不是对象、解析失败或含损坏编码时返回 400 `request.invalid` |
| 未知字段 | 忽略；未知字段超过 16 个时按非法请求处理（与 API-011 一致） |
| 不带请求体的方法 | `GET`、`DELETE` 的请求体必须为空，否则返回 400 `request.invalid` |
| 超时 | 沿用 API-047 的 `headersTimeout`、`requestTimeout` 等设置，不另设更长的时限 |

### 2.2 认证

2.2.1 登录令牌只通过请求头 `Authorization: Bearer <令牌>` 提交，令牌为 32 位小写十六进制（API-013、SEC-020）。不使用 Cookie，因此不存在跨站请求伪造的自动携带问题，也不需要 CSRF 令牌。

2.2.2 需要认证的接口在以下任一情况返回 401 `auth.required`：未带请求头、格式不符、令牌不存在、已过期、已闲置失效、已撤销，或账号认证世代已变。服务端不区分这些原因，客户端统一回到未登录状态并提示重新登录。

2.2.3 令牌不得出现在路径、查询参数或日志中。只读接口（`GET /api/v1/me`）不延长闲置期限；会改变资料或同意记录的接口才更新活动时间（SEC-021）。

### 2.3 响应

| 项目 | 规定 |
|---|---|
| 成功 | 201 表示创建了账号或登录会话；200 返回资料；202 表示请求已受理但结果异步产生；204 表示成功且无响应体 |
| 内容类型 | 有响应体时为 `application/json; charset=utf-8`；错误为 `application/problem+json; charset=utf-8` |
| 缓存 | 全部 `/api/*` 响应带 `Cache-Control: no-store` |
| 安全头 | 带 `X-Content-Type-Options: nosniff`（API-063）与 `Referrer-Policy: no-referrer` |
| 资料字段 | 只返回第 4 章的白名单字段；不返回内部主键、认证世代、密码散列、邮箱密文、邮箱查找标识或任何密钥 |

### 2.4 来源与跨源

2.4.1 桌面页面的来源为 `app://yi`，属于跨源请求。服务端只对精确列入允许名单的 `Origin` 回应 `Access-Control-Allow-Origin`（回显该来源，不使用 `*`），并带 `Vary: Origin`。

2.4.2 允许名单由服务端配置提供：生产环境仅 `app://yi`；本机开发另行配置开发服务器的来源，不随生产配置发布。带 `Origin` 但不在名单内的请求返回 403 `request.origin-denied`，不执行任何业务。不带 `Origin` 的请求（命令行工具、测试）照常处理，安全性由令牌与限流保证。

2.4.3 预检请求只允许第 3 章所列的方法与 `Authorization`、`Content-Type` 两个请求头，`Access-Control-Max-Age` 为 600 秒；不设置 `Access-Control-Allow-Credentials`，因为本接口不使用 Cookie。

2.4.4 桌面页面的 CSP 需在 `connect-src` 中增加 `https://yi.lightking.com.cn`，随批次 E 修改 `index.html`；不放宽为通配来源。

### 2.5 来源标识与限流

2.5.1 服务端按 API-040 的规则取客户端真实地址，再以服务端密钥计算 HMAC-SHA-256 作为业务层的 `sourceHash`。请求体中不接受任何自称的地址或设备字段。

2.5.2 `/api/*` 先经现有的同一 IP HTTP 令牌桶（API-041），再进入业务层的持久化限额（[阶段 6、7 设计](phase6-7.md) 第 3.2、4.2 条）。任何一层拒绝都返回 429 `rate.limited`，带 `Retry-After` 秒数（向上取整）与 `retryAfterMs`。

2.5.3 密码派生同时只允许一个任务（第 3.3 条），忙时返回 503 `auth.busy` 与 `Retry-After`，不排队等待。

## 3 接口

### 3.1 一览

| 方法与路径 | 认证 | 作用 | 成功 |
|---|---|---|---|
| `GET /api/v1/consents/required` | 否 | 当前必需协议的版本 | 200 |
| `POST /api/v1/email-codes` | 否 | 申请注册或重置密码的邮箱验证码 | 202 |
| `GET /api/v1/email-codes/{challengeId}` | 否 | 查询验证码邮件的发送状态 | 200 |
| `POST /api/v1/accounts` | 否 | 注册并登录 | 201 |
| `POST /api/v1/sessions` | 否 | 邮箱与密码登录 | 201 |
| `DELETE /api/v1/sessions/current` | 是 | 退出当前登录 | 204 |
| `POST /api/v1/password-resets` | 否 | 以邮箱验证码重置密码 | 204 |
| `GET /api/v1/me` | 是 | 当前账号资料 | 200 |
| `PUT /api/v1/me/name` | 是 | 修改雅号 | 200 |
| `PUT /api/v1/me/password` | 是 | 以旧密码修改密码 | 204 |
| `POST /api/v1/me/consents` | 是 | 同意新的必需协议版本 | 200 |
| `DELETE /api/v1/me` | 是 | 注销账号 | 保留，实现前为 405，见第 3.12 条 |

### 3.2 必需协议版本

`GET /api/v1/consents/required` 返回服务端当前要求的两份协议版本与官网地址，客户端在注册表单和补签提示中原样回传版本：

```json
{ "privacy": "2026-10-31", "terms": "2026-10-31",
  "privacyUrl": "https://yi.lightking.com.cn/privacy-policy", "termsUrl": "https://yi.lightking.com.cn/terms-of-service" }
```

版本取值以服务端装配的 `RequiredConsents` 为准；示例中的日期仅为格式示意。文书仍为草案时不开放注册入口（第 6.2 条）。

### 3.3 申请邮箱验证码

请求 `POST /api/v1/email-codes`：

```json
{ "purpose": "register", "email": "player@example.com", "language": "zh-Hans" }
```

| 字段 | 规则 |
|---|---|
| `purpose` | `register` 或 `reset`；`change`（更换邮箱）保留，本契约暂不开放 |
| `email` | 字符串，UTF-8 不超过 254 字节，按 `server/emailAddress.ts` 规范化后必须有效 |
| `language` | 可选，邮件的语言，取玩家当前的界面语言：`zh-Hans`（中文）、`lzh`（文言）、`en-GB`（英文），按 I18N-001；不带此字段时为中文，其他取值（含 `null`）返回 400 |

受理时返回 202：

```json
{ "challengeId": "0f1e2d3c4b5a69788796a5b4c3d2e1f0", "expiresAt": "2026-11-01T08:10:00.000Z", "resendAfterMs": 60000 }
```

3.3.1 无论邮箱是否已注册，`register` 与 `reset` 的受理响应在结构、状态码与可观察流程上完全一致，不透露账号是否存在（[阶段 6、7 设计](phase6-7.md) 第 4.5 条）。

3.3.2 `challengeId` 只用于随后的核验与查询，不是通过验证的证明。超出冷却、邮箱、来源或全局额度时返回 429 `rate.limited`。

3.3.3 发信在请求结束后异步执行，202 不表示邮件已送达。

3.3.4 邮件整封只用 `language` 指明的一种语言，只发 HTML：纸色底与官网同款细网格、居中的墨色“弈”字、线条胶囊框起的验证码，页脚为链接与版权（项目所有者 2026-11-01 定稿）。文案见 `server/codeMailText.ts`，版式见 `server/codeMailHtml.ts`；“弈”字图随邮件内嵌，不引用外部图片。

### 3.4 查询发送状态

`GET /api/v1/email-codes/{challengeId}`，路径参数必须为 32 位小写十六进制，否则返回 404 `code.not-found`。返回：

```json
{ "state": "sent", "expiresAt": "2026-11-01T08:10:00.000Z" }
```

| `state` | 对应的存储状态 | 客户端处理 |
|---|---|---|
| `pending` | `queued`、`sending` | 显示“正在发送”，每 2 秒查询一次，最多 30 秒 |
| `sent` | `sent` | 提示查收邮件并输入验证码 |
| `retry` | `failed`、`unknown` | 提示发送未成功，允许在冷却结束后重新申请 |
| — | `consumed`、`superseded`、已过期或不存在 | 404 `code.not-found`，提示重新申请 |

查询不消耗验证码的错误次数，不返回邮箱或验证码；同一 IP 的 HTTP 令牌桶限制查询频率。由于任何邮箱都能申请验证码，发送状态与账号是否存在无关，不构成存在性泄露。

### 3.5 注册

请求 `POST /api/v1/accounts`：

```json
{ "name": "黑白", "email": "player@example.com", "password": "……",
  "challengeId": "0f1e2d3c4b5a69788796a5b4c3d2e1f0", "code": "123456",
  "consent": { "accepted": true, "privacy": "2026-10-31", "terms": "2026-10-31" } }
```

| 字段 | 规则 |
|---|---|
| `name` | 雅号，按 `server/accountInput.ts`：修剪外围空白并转为 NFC，至多 16 个字素且 UTF-8 不超过 64 字节，拒绝控制字符与格式字符；允许重名 |
| `email` | 同第 3.3 条，必须与申请验证码时的邮箱规范化后一致 |
| `password` | 至少 8 个 Unicode 码点，UTF-8 不超过 1024 字节；原文不修剪、不规范化 |
| `challengeId`、`code` | 32 位小写十六进制；6 位数字 |
| `consent` | `accepted` 必须为 `true`，两个版本必须等于当前必需版本 |

成功返回 201，与登录的响应相同（第 3.6 条）。失败时不创建任何记录。

| 情形 | 响应 |
|---|---|
| 字段格式不符 | 400 `request.invalid`，`params.field` 为首个出错的字段名 |
| 协议版本不是当前版本或未明确同意 | 422 `consent.outdated`，客户端重新获取第 3.2 条的版本 |
| 验证码错误、过期、已用或已被重发替换 | 422 `code.invalid`；错误达到 5 次后同一挑战不再可用 |
| 验证码有效但邮箱已注册 | 409 `account.email-taken`，提示直接登录或找回密码；此时已证明能接收该邮箱的邮件，告知已注册不构成泄露，验证码不被消费 |
| 来源超出密码派生预算 | 429 `rate.limited` |

### 3.6 登录

请求 `POST /api/v1/sessions`：

```json
{ "email": "player@example.com", "password": "……" }
```

成功返回 201：

```json
{ "token": "（32 位小写十六进制，此处不写示例值）", "expiresAt": "2026-12-01T08:00:00.000Z",
  "user": { "publicId": "7KM4P9D2", "name": "黑白", "emailVerified": true, "consentsCurrent": true, "onlineAllowed": true } }
```

`expiresAt` 是三十日的绝对期限；闲置七日也会失效，客户端不得据 `expiresAt` 判断令牌一定有效。

| 情形 | 响应 |
|---|---|
| 邮箱或密码错误、账号不存在 | 401 `auth.credentials-invalid`，两种情况不可区分 |
| 账号因连续失败被锁定，或来源超出预算 | 429 `rate.limited`；锁定按邮箱查找标识计，不存在的账号同样计数，不泄露存在性 |
| 密码任务忙 | 503 `auth.busy` |

### 3.7 退出

`DELETE /api/v1/sessions/current` 撤销本次请求所带的令牌，成功返回 204。令牌已失效时同样返回 204，使退出可以安全重试。撤销后，使用该会话的认证联机连接立即失效（批次 F 接入）。

### 3.8 重置密码

请求 `POST /api/v1/password-resets`：

```json
{ "email": "player@example.com", "password": "……", "challengeId": "0f1e2d3c4b5a69788796a5b4c3d2e1f0", "code": "123456" }
```

验证码有效时一律返回 204，不论账号是否存在；账号存在时写入新密码、撤销全部会话并解除该账号的登录失败锁定，客户端随后引导登录。验证码无效返回 422 `code.invalid`，其余错误同第 3.5 条。

### 3.9 当前资料

`GET /api/v1/me` 返回 200 与第 4 章的 `user` 对象。此接口只读，不延长闲置期限。

### 3.10 修改雅号

请求 `PUT /api/v1/me/name`，请求体 `{ "name": "新雅号" }`，规则同第 3.5 条。成功返回 200 与更新后的 `user`；公开 UID 不变。已开局对局中显示的雅号不随之改变，下一局起使用新雅号。

### 3.11 修改密码与补签协议

3.11.1 `PUT /api/v1/me/password`，请求体 `{ "oldPassword": "……", "password": "……" }`。旧密码错误返回 401 `auth.credentials-invalid` 并计入该账号的失败次数；成功返回 204，并撤销包括当前会话在内的全部会话，客户端回到登录界面。

3.11.2 `POST /api/v1/me/consents`，请求体与注册中的 `consent` 字段相同。成功返回 200 与更新后的 `user`；版本不是当前版本返回 422 `consent.outdated`。重复同意保留首次同意时刻。

### 3.12 注销（保留）

`DELETE /api/v1/me` 需要重新输入密码，进入 [决策 0011](../adr/0011-public-id-and-account-retention.md) 所述的限期匿名化流程。业务层尚未实现；`/api/v1/me` 已有 `GET`，因此实现前 `DELETE` 返回 405 `request.method-not-allowed` 并带 `Allow: GET`。请求与响应在实现注销的 PR 中补入本契约。

## 4 资料对象

| 字段 | 类型 | 含义 |
|---|---|---|
| `publicId` | 字符串 | 八位公开 UID 的规范值（大写、无连字符）；显示时由客户端按 `src/shared/publicId.ts` 加连字符 |
| `name` | 字符串 | 雅号 |
| `emailVerified` | 布尔值 | 邮箱已验证；注册即完成验证，现有流程中恒为真，保留字段以便更换邮箱时使用 |
| `consentsCurrent` | 布尔值 | 已同意全部当前必需版本 |
| `onlineAllowed` | 布尔值 | 前两项同时满足；客户端据此决定是否显示联机入口，服务端在联机握手时另行检查 |

后续增加的字段（如各棋种段位）只追加，不改变已有字段的含义；客户端忽略未知字段。

## 5 错误

### 5.1 响应体

错误响应遵循 RFC 9457，字段与 WebSocket 错误（API-020）保持一致，不下发自然语言文本，客户端按 `code` 查译文：

```json
{ "type": "https://yi.lightking.com.cn/errors/rate.limited", "status": 429,
  "code": "rate.limited", "level": "E3", "retryAfterMs": 60000 }
```

| 字段 | 是否必有 | 说明 |
|---|---|---|
| `type` | 是 | `https://yi.lightking.com.cn/errors/` 加错误码（04-api 第 4.1 条） |
| `status` | 是 | 与响应状态码相同 |
| `code`、`level` | 是 | 错误码与级别 |
| `params` | 否 | 附加参数，如 `field` |
| `retryAfterMs` | 否 | E3 与 503 时必有，与 `Retry-After` 头一致 |
| `errorId` | 否 | E5 时必有，UUID v4，与服务端日志对照（API-023） |

### 5.2 错误码

下表中“已有”指 04-api 第 8 节已列出的错误码；“新增”已加入第 8.2 条与 `src/shared/errors.ts`，`tests/errors.test.ts` 核对两处一致，`tests/accountApi.test.ts` 逐个验证下发条件（API-021、API-022）。

| 错误码 | 级别 | 状态码 | 中文原文 | 来源 |
|---|---|---|---|---|
| `request.invalid` | E4 | 400 | 请求格式错误 | 新增 |
| `request.too-large` | E4 | 413 | 请求内容过大 | 新增 |
| `request.method-not-allowed` | E4 | 405 | 不支持此请求方式 | 新增 |
| `request.origin-denied` | E2 | 403 | 请求来源不受支持 | 新增 |
| `auth.required` | E2 | 401 | 请先登录 | 已有；原文由“排位需要登录”改为通用表述，该码尚未发布，不违反第 3.1 条 |
| `auth.credentials-invalid` | E2 | 401 | 邮箱或密码不正确 | 新增 |
| `auth.busy` | E3 | 503 | 登录人数较多，请稍后再试 | 新增 |
| `code.invalid` | E2 | 422 | 验证码不正确或已失效 | 新增 |
| `code.not-found` | E2 | 404 | 验证码已失效，请重新获取 | 新增 |
| `account.email-taken` | E2 | 409 | 该邮箱已注册 | 新增 |
| `consent.outdated` | E2 | 422 | 相关协议已更新，请重新阅读并同意 | 新增 |
| `rate.limited` | E3 | 429 | 操作过于频繁，请稍后再试 | 已有 |
| `server.maintenance` | E2 | 503 | 服务器即将维护，暂不开始新的对局 | 已有；账号接口在维护模式下照常提供，不使用此码 |
| `server.internal` | E5 | 500 | 服务器出现问题，请稍后再试 | 已有 |

5.2.1 04-api 第 4.1 条的状态码表没有 422。本契约用 422（RFC 9110 第 15.5.21 节）表示请求格式正确、但业务校验未通过且玩家可自行纠正的情形，对应级别 E2；04-api 1.1.15 已在第 4.1 条增加此行。

5.2.2 客户端收到未知错误码时，按 `level` 处理；`level` 也未知时按 E5 处理（API-024）。网络中断、超时或响应不是合法 JSON 时，统一按 `server.internal` 的处理方式提示，不清除已保存的登录状态。

## 6 客户端约定

6.1 桌面端只在主进程用 `safeStorage` 加密保存令牌，渲染进程经受校验的 IPC 读取与清除，渲染进程内只在内存中持有（DAT-083、[阶段 6、7 设计](phase6-7.md) 第 5.4 条）。加密不可用或文件损坏时视为未登录，不写明文。开发用浏览器只在内存中保存，刷新即退出。

6.2 注册与登录入口在以下条件全部满足前不对玩家开放：生产配置了真实发信与密钥、三份文书已正式生效并有联系邮箱、批次 D 的验收完成。未开放时界面不显示入口，不出现无法完成的流程。

6.3 客户端收到 401 `auth.required` 时清除保存的令牌并回到未登录状态；收到 `auth.credentials-invalid` 时保留输入的邮箱、清空密码。所有错误提示在三种界面语言下都有译文（I18N 规范）。

## 7 业务层须补充的内容

| 补充 | 位置 | 实现 |
|---|---|---|
| 注册时区分“验证码无效”与“邮箱已注册” | `server/authentication.ts` | 已完成：验证码通过后先查邮箱，已注册时抛出 `taken`，不派生密码、不消费验证码；派生期间被他人注册时，在最终事务中同样回滚为 `taken`。验证码无效仍为 `denied` |
| 改密时区分旧密码错误与会话失效 | `server/authentication.ts` | 已完成：令牌失效或派生期间会话被撤销为 `session`，旧密码错误仍为 `denied` |
| 修改雅号 | `server/authentication.ts` 的 `rename`、`server/db/accounts.ts` | 已完成：输入层规范化，只写活动账号，公开 UID 不变，更新会话活动时间 |
| 按挑战编号读取发送状态 | `server/emailCodes.ts` 的 `delivery`、`server/db/emailChallenges.ts` | 已完成：只读；当前且未用尽的挑战按第 3.4 条映射，其他情况为空 |
| 受理时返回到期与冷却时长 | `server/emailCodes.ts` | 已完成：受理结果带 `expiresAt`（毫秒时刻，路由层转为 RFC 3339）与 `resendAfterMs` |
| 补签协议更新活动时间 | `server/authentication.ts` | 已完成：与第 2.2.3 条一致，只读的 `me` 仍不更新 |
| 密码任务忙时的映射 | 路由层 | 已完成：`server/accountRoutes.ts` 将 `PasswordBusyError` 映射为第 2.5.3 条的 503 `auth.busy`，建议等待 1 秒 |

## 8 极端情况

| 场景（10-edge-cases） | 处理 |
|---|---|
| 重复提交、网络重试 | 注册在同一验证码上至多成功一次，重试返回 422 `code.invalid`，客户端此时提示直接登录；退出可重复调用；重置在验证码消费后重试返回 422 |
| 并发注册同一邮箱 | 由邮箱查找标识的唯一约束裁决，一个成功，另一个返回 409 `account.email-taken` |
| 改密或重置后旧设备仍在使用 | 旧令牌的下一次请求返回 401 `auth.required`；认证联机连接由撤销通知立即断开（批次 F） |
| 发信服务不可用 | 申请照常 202，状态查询得到 `retry`；失败的发送照常计入额度，不能借此绕过限流 |
| 密码任务过载 | 503 `auth.busy`，不排队；游戏消息处理不受影响由批次 G 的同环境压测验证 |
| 服务端时钟回退 | 沿用业务层现有处理：受影响的挑战转为 `unknown`，会话按存储的期限判定 |
| 维护模式 | 账号接口照常提供；联机入口仍由现有维护逻辑拒绝新对局 |
| 数据库不可写 | 数据层故障即停（EDGE-002），返回 500 `server.internal`，不签发令牌 |

## 9 验收

批次 D 的路由实现按 [下一步计划](next-development.md) 第 6 章验证，并至少满足：

1. 使用真实 SQLite 与本机随机端口上的真实 HTTP 请求，覆盖第 3 章每个接口的成功与每种失败；发信使用实现同一接口的假发送器。
2. 每个错误码至少一条测试，断言状态码、`code`、`level`、`Retry-After` 与 `retryAfterMs` 一致，并按项目要求逐条做实现变异。
3. 断言响应中不出现令牌以外的机密字段，日志中不出现密码、验证码、令牌、邮箱查找标识与完整请求体。
4. 允许名单之外的 `Origin`、超限请求体、错误内容类型、未知方法与未装配路径均有测试。
5. 真实投递只在项目所有者确认后，以项目所有者指定的邮箱验证一次，并记录结果。

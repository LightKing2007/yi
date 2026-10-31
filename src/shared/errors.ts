/** 错误码表（API-021）：每个错误码的级别与中文原文唯一定义于此，与 04-api.md 第 8 节一致；界面经 T() 按错误码取译文。 */

/** 错误级别（04-api.md 第 3.2 条）：决定客户端的处理方式与服务端日志级别。 */
export type ErrorLevel = 'E1' | 'E2' | 'E3' | 'E4' | 'E5';

/** 一个错误码的定义；错误码一经发布严禁改变含义或删除（04-api.md 第 3.1 条）。 */
export interface ErrorDef {
  level: ErrorLevel;
  text: string;
}

/** 全部错误码。联机协议 v3 仍以文本下发，各项随协议 v4 启用；账号接口的错误码已由 HTTP 下发。 */
export const ERRORS = {
  'proto.invalid-message': { level: 'E4', text: '消息格式错误' },
  'proto.not-hello': { level: 'E4', text: '请先完成连接握手' },
  'proto.version-mismatch': { level: 'E4', text: '客户端版本与服务器不一致，请更新游戏' },
  'rate.limited': { level: 'E3', text: '操作过于频繁，请稍后再试' },
  'server.full': { level: 'E2', text: '服务器繁忙，请稍后再试' },
  'server.internal': { level: 'E5', text: '服务器出现问题，请稍后再试' },
  'server.maintenance': { level: 'E2', text: '服务器即将维护，暂不开始新的对局' },
  'room.already-in': { level: 'E2', text: '你已经在一个房间里了' },
  'room.not-found': { level: 'E2', text: '房号不存在，或房间已经开始' },
  'room.own': { level: 'E2', text: '这是你自己的房间' },
  'room.join-throttled': { level: 'E3', text: '尝试次数太多，请稍后再试' },
  'queue.ranked-elsewhere': { level: 'E2', text: '这台设备已经在排位中了' },
  'game.not-your-turn': { level: 'E1', text: '还没轮到你' },
  'game.awaiting-reply': { level: 'E1', text: '请先等对方回应申请' },
  'game.illegal-move': { level: 'E1', text: '这里不能落子' },
  'game.undo-not-allowed': { level: 'E1', text: '现在不能申请悔棋' },
  'game.undo-exhausted': { level: 'E2', text: '本局悔棋次数已用完' },
  'game.undo-nothing': { level: 'E1', text: '你还没有可以悔的棋' },
  'game.draw-exhausted': { level: 'E2', text: '本局求和次数已用完' },
  'game.rematch-ranked': { level: 'E2', text: '排位赛不能再来一局' },
  'game.rematch-opponent-left': { level: 'E2', text: '对方已离开，无法再来一局' },
  'auth.required': { level: 'E2', text: '请先登录' },
  'auth.invalid': { level: 'E4', text: '登录已失效，请重新登录' },
  'auth.credentials-invalid': { level: 'E2', text: '邮箱或密码不正确' },
  'auth.busy': { level: 'E3', text: '登录人数较多，请稍后再试' },
  'account.restricted': { level: 'E2', text: '账号暂时不能进行排位' },
  'account.email-taken': { level: 'E2', text: '该邮箱已注册' },
  'code.invalid': { level: 'E2', text: '验证码不正确或已失效' },
  'code.not-found': { level: 'E2', text: '验证码已失效，请重新获取' },
  'consent.outdated': { level: 'E2', text: '相关协议已更新，请重新阅读并同意' },
  'request.invalid': { level: 'E4', text: '请求格式错误' },
  'request.too-large': { level: 'E4', text: '请求内容过大' },
  'request.method-not-allowed': { level: 'E4', text: '不支持此请求方式' },
  'request.origin-denied': { level: 'E2', text: '请求来源不受支持' },
} as const satisfies Record<string, ErrorDef>;

/** 已定义的错误码。 */
export type ErrorCode = keyof typeof ERRORS;

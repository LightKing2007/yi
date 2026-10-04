/**
 * 界面文字排版检查的页面部分（I18N-020、I18N-022，整改项 P1-15）：由 scripts/fit-check.cjs 在开发服务器的页面中以 import() 载入，
 * 以三种语言走遍开始菜单、单机对局、设置、更多、联机大厅与联机对局，联机对手由本模块另开一条连接扮演；
 * 再把译文表中“更多”页面以外的全部文字放进联机提示条，检查两行内能否放下。
 * 放不下的文字由 Fit 在开发模式下经日志接口报告“[fit] 放不下”，提示条的检查也以同样的前缀报告，均由 fit-check.cjs 收集。
 */
import { Lang, setSettings } from '../src/app/settings';
import { game } from '../src/app/state';
import { GameType, WHITE } from '../src/core/types';
import { T } from '../src/i18n';
import { TABLE } from '../src/i18n/table';
import * as net from '../src/online/client';
import { isInvalid, parseS2C } from '../src/shared/parse';
import type { C2S } from '../src/shared/protocol';
import { INFO_PAGES } from '../src/ui/info';

/** 每一步之后的停留：长于 Fit 等布局稳定的 500 毫秒，否则界面切走后才量就漏报 */
const STEP_MS = 900;
/** 等待某个状态出现的上限：本机服务端往返只需几十毫秒，超时即说明流程没有走到 */
const WAIT_MS = 8000;
const POLL_MS = 100;
/** 对手回应悔棋申请前的停顿：留出时间让“等待对方回应”显示并被量到 */
const REPLY_MS = 1500;
/** 场景脚本跑到最后一刻所需的时间（场景的时钟随画面帧推进） */
const SCENARIO_MS = 8000;
/** 格式占位符代入的示例值：数字取两位、名字取常见长度 */
const SAMPLE = { d: '20', f: '7.5', s: 'Player635' } as const;
/** 舍入误差，与 Fit 一致 */
const ROUNDING_PX = 0.5;
/** 好友对局：9 路围棋、每步 60 秒，己方执白（对手执黑先行并停一手） */
const FRIEND = { size: 9, moveSecs: 60 } as const;
/** 己方在 9 路棋盘上落子的位置（天元） */
const MY_MOVE = 4;
/** 排位的路数参数（五子棋排位固定 15 路，服务端按棋种决定） */
const RANKED_SIZE = 19;

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** 等 cond 成立；超时说明流程没有走到 what，检查不能算通过 */
async function waitFor(cond: () => boolean, what: string) {
  for (let waited = 0; waited < WAIT_MS; waited += POLL_MS) {
    if (cond()) return;
    await sleep(POLL_MS);
  }
  throw new Error(`等待超时：${what}`);
}

function panel() {
  const el = document.querySelector<HTMLElement>('.panel:not(.leaving)');
  if (!el) throw new Error('找不到当前面板');
  return el;
}

/** 点击当前面板中文字为 T(zh) 的元素：按钮用 button，分段选项用 .seg .opt */
async function click(selector: string, zh: string) {
  const label = T(zh);
  const el = [...panel().querySelectorAll<HTMLElement>(selector)].find(el => el.textContent?.trim() === label);
  if (!el) throw new Error(`找不到“${zh}”（${label}）`);
  el.click();
  await sleep(STEP_MS);
}
const press = (zh: string) => click('button', zh);
const pick = (zh: string) => click('.seg .opt', zh);

/** 扮演联机对手：自动接受配对；autoPass 时轮到它就停一手；拒绝悔棋申请 */
class Opponent {
  autoPass = false;
  private color = 0;
  private ws: WebSocket;

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.addEventListener('message', ev => this.receive(ev.data));
  }

  /** 连上并握手 */
  async open() {
    await waitFor(() => this.ws.readyState === WebSocket.OPEN, '对手连上服务端');
    this.send({ t: 'hello', v: 3, name: 'Opponent', uid: 'fit-check-opponent-0001' });
  }

  send(m: C2S) {
    this.ws.send(JSON.stringify(m));
  }

  close() {
    this.ws.close();
  }

  private receive(data: unknown) {
    const m = parseS2C(JSON.parse(String(data)));
    if (isInvalid(m)) throw new Error(`对手收到非法消息：${m.why}`);
    if (m.t === 'found') this.send({ t: 'confirm', ok: true });
    else if (m.t === 'start') this.color = m.color;
    else if (m.t === 'turn' && this.autoPass && m.color === this.color) this.send({ t: 'pass' });
    else if (m.t === 'ask' && m.kind === 'undo') setTimeout(() => this.send({ t: 'reply', kind: 'undo', ok: false }), REPLY_MS);
  }
}

/** 开始菜单 → 单机对局的四种组合 → 设置三页 → 更多五页，回到开始菜单 */
async function sweepStatic() {
  await press('单人游戏');
  for (const zh of ['人机对弈', '围棋', '双人对弈', '五子棋']) await pick(zh);
  await press('菜单');
  await press('设置');
  for (const zh of ['画面', '对局', '声音']) await pick(zh);
  await press('返回');
  await press('更多');
  const tabs = INFO_PAGES.map(p => p.title);
  for (const zh of [...tabs.slice(1), tabs[0]]) await pick(zh);
  await press('返回');
}

/** 联机大厅的三栏与好友的两个子页 */
async function sweepLobby() {
  await press('联机对战');
  await waitFor(() => net.st.phase === net.Phase.Lobby, '进入联机大厅');
  for (const zh of ['排位', '好友', '加入房间', '开房间', '匹配']) await pick(zh);
}

/** 译文表中“更多”页面以外的全部文字放进提示条，至多两行（I18N-020）；“更多”页面的段落与日志不在提示条中出现 */
function probeNotice() {
  const box = panel().querySelector<HTMLElement>('.msg');
  if (!box) throw new Error('当前面板没有提示条');
  const probe = document.createElement('span');
  probe.className = 'fit two';
  probe.style.fontSize = '14px';
  box.append(probe);
  const inInfo = new Set(INFO_PAGES.flatMap(p => [p.title, ...p.lines.flatMap(line => line.slice(1) as string[])]));
  let n = 0;
  for (const [zh] of TABLE) {
    if (inInfo.has(zh)) continue;
    probe.textContent = T(zh).replace(/%(?:\.\d+)?([dfs])/g, (_, conv: keyof typeof SAMPLE) => SAMPLE[conv]);
    if (probe.scrollHeight > probe.clientHeight + ROUNDING_PX) console.warn(`[fit] 放不下（提示条两行）：${probe.textContent}`);
    n++;
  }
  probe.remove();
  return n;
}

/** 围棋好友对局：等待好友、对局、和棋申请、悔棋待回应、离开确认、点目、终局与再来一局的申请；返回提示条检查的条数 */
async function friendGo(opp: Opponent) {
  net.createRoom(GameType.Go, FRIEND.size, WHITE, false, FRIEND.moveSecs);
  await waitFor(() => net.st.phase === net.Phase.Hosting && net.st.code !== '', '开好房间');
  await sleep(STEP_MS);
  const probed = probeNotice();
  opp.autoPass = true;
  opp.send({ t: 'join', code: net.st.code });
  await waitFor(() => net.st.phase === net.Phase.Playing, '好友对局开局');
  opp.send({ t: 'draw' });
  await waitFor(() => net.st.askIn === 'draw', '收到和棋申请');
  await sleep(STEP_MS);
  net.reply(false);
  await waitFor(() => net.myTurn(), '轮到己方落子');
  const before = game.hist.length;
  net.move(MY_MOVE, MY_MOVE);
  await waitFor(() => game.hist.length > before, '己方落子生效'); // 落子确认前 myTurn() 仍为真，不能据此判断
  await waitFor(() => net.myTurn(), '对手停一手');
  net.undo();
  await waitFor(() => net.st.askOut === 'undo', '悔棋待回应');
  await sleep(STEP_MS);
  await waitFor(() => !net.st.askOut, '对手拒绝悔棋');
  net.askLeave();
  await sleep(STEP_MS);
  await press('继续下');
  net.pass();
  await waitFor(() => game.scoring, '进入点目');
  await sleep(STEP_MS);
  net.resign();
  await waitFor(() => net.st.over, '认输后终局');
  opp.send({ t: 'rematch' });
  await waitFor(() => net.st.askIn === 'rematch', '收到再来一局的申请');
  await sleep(STEP_MS);
  net.reply(false);
  net.leave();
  opp.send({ t: 'leave' }); // 对手也离开房间，否则下一步排队时服务端以“已经在一个房间里”拒绝
  await waitFor(() => net.st.phase === net.Phase.Lobby, '离开房间回到大厅');
  return probed;
}

/** 五子棋排位：排队、配对确认、对局、离开确认、对手认输后的段位结算 */
async function ranked(opp: Opponent) {
  opp.autoPass = false;
  net.queue('ranked', GameType.Gomoku, RANKED_SIZE);
  await waitFor(() => net.st.phase === net.Phase.Queue, '排位排队');
  await sleep(STEP_MS);
  opp.send({ t: 'queue', mode: 'ranked', type: GameType.Gomoku, size: RANKED_SIZE });
  await waitFor(() => net.st.phase === net.Phase.Found, '排位配对');
  await sleep(STEP_MS);
  net.confirm(true);
  await waitFor(() => net.st.phase === net.Phase.Playing, '排位开局');
  net.askLeave();
  await sleep(STEP_MS);
  await press('继续下');
  opp.send({ t: 'resign' });
  await waitFor(() => net.st.over && net.st.rated !== null, '排位结算');
  await sleep(STEP_MS);
  net.leave();
  opp.send({ t: 'leave' });
  await waitFor(() => net.st.phase === net.Phase.Lobby, '离开排位回到大厅');
}

/** 以文言、中文、英文依次走一遍；返回每种语言提示条检查的条数 */
export async function runAll(serverUrl: string) {
  const opp = new Opponent(serverUrl);
  await opp.open();
  const probed: Record<string, number> = {};
  try {
    for (const lang of [Lang.WY, Lang.ZH, Lang.EN]) {
      setSettings({ lang });
      await sleep(STEP_MS);
      await sweepStatic();
      await sweepLobby();
      probed[Lang[lang]] = await friendGo(opp);
      await ranked(opp);
      await sleep(STEP_MS); // 状态先回到大厅，面板随后才切换
      await press('返回');
    }
  } finally {
    opp.close();
  }
  return probed;
}

/** 场景脚本（单机的终局、点目等）载入后切换语言，等场景跑到最后一刻 */
export async function runScenario(lang: Lang) {
  setSettings({ lang });
  await sleep(SCENARIO_MS);
}

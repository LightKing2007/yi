/**
 * 多人游戏：一页三栏——匹配、排位、好友；匹配中 / 找到对手 / 等好友加入各有一屏；联机对局的面板；棋盘上的名牌。
 * 服务器在界面上不出现：需要时自动连接，出错时只提示“网络连接失败”。
 */
import { signal } from '@preact/signals';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { goScreen, newGame, toggleReview } from '../app/controller';
import { layout } from '../app/app';
import { Lang, NICK_MAX_CHARS, setSettings, settings } from '../app/settings';
import { game, screen, Screen, uiTick, boardView } from '../app/state';
import { now } from '../core/clock';
import { BLACK, GameType, WHITE } from '../core/types';
import { blowing } from '../fx/blow';
import { T, TF } from '../i18n';
import * as net from '../online/client';
import { Phase, netTick, ratingOf, st, tr } from '../online/client';
import { seatPlates } from '../scene/online';
import { RANKS, clipName, queueRules, rankIndex, rankName, type Opponent } from '../shared/protocol';
import { Row, UpdateNote } from './panels';
import { Button, Field, Fit, Hair, Seg, StoneIcon } from './widgets';

const typeName = (type: number) => T(type ? '围棋' : '五子棋');

/** 对局设置的简要说明：五子棋 15 路 · 禁手 · 每步 30 秒 */
function summary(r: { type: number; size: number; renju: boolean; moveTime: number }) {
  const t = r.moveTime > 0 ? TF('每步 %d 秒', r.moveTime) : T('不限时');
  return TF('%s %d 路%s  ·  %s', typeName(r.type), r.size, !r.type && r.renju ? T('  ·  禁手') : '', t);
}

/** 段位：三段 · 1486 分 */
const rankText = (points: number) => TF('%s · %d 分', T(rankName(points)), points);
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** 最近 4 秒内的提示 */
function Notice({ style }: { style?: Record<string, string> }) {
  const age = now() - st.noticeAt,
    show = st.notice.length > 0 && age < 4;
  return (
    <div class="msg" style={{ opacity: show && age < 3.4 ? 1 : 0, ...style }}>
      <Fit size={14} min={10}>
        {show ? st.notice.map(tr).join('  ·  ') : ''}
      </Fit>
    </div>
  );
}

/** 昵称输入框的码元上限只是兜底：一个字素可能由多个码元组成，实际按字素截到 NAME_MAX 个（I18N-030） */
const NICK_INPUT_MAX = NICK_MAX_CHARS;

const labelW = () => (settings.value.lang === Lang.EN ? 118 : 80);

// ---------------- 大厅：匹配 · 排位 · 好友 ----------------

/** 页面上的选择（离开再回来时保持） */
const ui = signal({ tab: 0, type: 0, size: 19, friend: 0, fType: 0, fSize: 19, fColor: 0, fTime: 0, fRenju: -1, code: '' });
const setUi = (patch: Partial<typeof ui.value>) => {
  ui.value = { ...ui.value, ...patch };
};

/** 棋盘跟着当前的选择换棋类、路数 */
function boardFor(): [GameType, number] {
  const u = ui.value;
  if (u.tab === 2) return u.friend === 0 ? [u.fType ? GameType.Go : GameType.Gomoku, u.fType ? u.fSize : 15] : [game.type, game.N];
  const r = queueRules(u.tab === 1 ? 'ranked' : 'match', u.type, u.size);
  return [r.type ? GameType.Go : GameType.Gomoku, r.size];
}

function typeRows(ranked: boolean) {
  const u = ui.value;
  return (
    <>
      <Row label={T('棋类')}>
        <Seg height={34} items={[T('五子棋'), T('围棋')]} sel={u.type} onChange={v => setUi({ type: v })} />
      </Row>
      {u.type === 1 && !ranked && (
        <Row label={T('路数')}>
          <Seg
            height={34}
            items={[T('9 路'), T('13 路'), T('19 路')]}
            sel={u.size === 9 ? 0 : u.size === 13 ? 1 : 2}
            onChange={v => setUi({ size: [9, 13, 19][v] })}
          />
        </Row>
      )}
    </>
  );
}

function matchTab() {
  const u = ui.value,
    rules = queueRules('match', u.type, u.size);
  return (
    <>
      {typeRows(false)}
      <div class="rule-line">{summary(rules)}</div>
      <div class="hint">{T('与正在匹配的弈者对局，不计段位')}</div>
      <Button label={T('开始匹配')} primary height={46} style={{ width: '100%', marginTop: '18px' }} onClick={() => net.queue('match', u.type, u.size)} />
    </>
  );
}

function rankCard(type: number) {
  const r = ratingOf(type),
    i = rankIndex(r.points),
    top = i === RANKS.length - 1;
  const prog = top ? 1 : Math.min(1, Math.max(0, (r.points - 840 - i * 60) / 60));
  const games = r.win + r.loss + r.draw;
  return (
    <div class="rank-card">
      <div class="rank-name">{T(RANKS[i])}</div>
      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
        <div style={{ fontSize: '15px' }}>
          <Fit size={15}>{TF('%d 分', r.points)}</Fit>
        </div>
        <div class="dim" style={{ fontSize: '12px', marginTop: '3px' }}>
          <Fit size={12} min={9}>
            {games ? TF('%d 胜  ·  %d 负  ·  %d 和', r.win, r.loss, r.draw) : T('还没有排位记录')}
          </Fit>
        </div>
        <div class="rank-bar">
          <div style={{ width: prog * 100 + '%' }} />
        </div>
        <div class="faint" style={{ fontSize: '11px', marginTop: '4px' }}>
          <Fit size={11} min={9}>
            {top ? T('已是最高段位') : TF('距 %s 还差 %d 分', T(RANKS[i + 1]), Math.ceil(840 + (i + 1) * 60 - r.points))}
          </Fit>
        </div>
      </div>
    </div>
  );
}

function rankedTab() {
  const u = ui.value,
    rules = queueRules('ranked', u.type, 19);
  return (
    <>
      {typeRows(true)}
      {rankCard(u.type)}
      <div class="rule-line">{summary(rules)}</div>
      <div class="hint">{T('胜负计入段位，中途离开按输棋计')}</div>
      <Button label={T('开始排位')} primary height={46} style={{ width: '100%', marginTop: '14px' }} onClick={() => net.queue('ranked', u.type, 19)} />
    </>
  );
}

function friendTab() {
  const u = ui.value,
    s = settings.value;
  const renju = u.fRenju < 0 ? s.renju : !!u.fRenju;
  const codeOk = /^\d{4}$/.test(u.code);
  const join = () => {
    if (codeOk && !st.busy) net.joinRoom(u.code);
  };
  return (
    <>
      <Seg height={34} items={[T('开房间'), T('加入房间')]} sel={u.friend} onChange={v => setUi({ friend: v })} />
      <div style={{ height: '18px' }} />
      {u.friend === 0 ? (
        <>
          <Row label={T('棋类')}>
            <Seg height={34} items={[T('五子棋'), T('围棋')]} sel={u.fType} onChange={v => setUi({ fType: v })} />
          </Row>
          {u.fType === 1 ? (
            <Row label={T('路数')}>
              <Seg
                height={34}
                items={[T('9 路'), T('13 路'), T('19 路')]}
                sel={u.fSize === 9 ? 0 : u.fSize === 13 ? 1 : 2}
                onChange={v => setUi({ fSize: [9, 13, 19][v] })}
              />
            </Row>
          ) : (
            <Row label={T('黑棋禁手')}>
              <Seg height={34} items={[T('开'), T('关')]} sel={renju ? 0 : 1} onChange={v => setUi({ fRenju: v === 0 ? 1 : 0 })} />
            </Row>
          )}
          <Row label={T('我执')}>
            <Seg height={34} items={[T('执黑'), T('执白'), T('随机')]} sel={u.fColor} onChange={v => setUi({ fColor: v })} />
          </Row>
          <Row label={T('每步限时')}>
            <Seg
              height={34}
              items={[T('不限'), T('30 秒'), T('60 秒'), T('120 秒')]}
              sel={[0, 30, 60, 120].indexOf(u.fTime)}
              onChange={v => setUi({ fTime: [0, 30, 60, 120][v] })}
            />
          </Row>
          <Button
            label={st.busy ? T('创建中…') : T('开房间')}
            primary
            height={46}
            disabled={st.busy}
            style={{ width: '100%', marginTop: '6px' }}
            onClick={() => net.createRoom(u.fType, u.fType ? u.fSize : 15, u.fColor, u.fType === 0 && renju, u.fTime)}
          />
        </>
      ) : (
        <>
          <input
            class="code-field"
            value={u.code}
            inputMode="numeric"
            maxLength={4}
            placeholder="····"
            spellcheck={false}
            autoFocus
            onInput={e => setUi({ code: (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 4) })}
            onKeyDown={e => {
              e.stopPropagation();
              if (e.key === 'Enter') join();
              if (e.key === 'Escape') (e.target as HTMLInputElement).blur();
            }}
          />
          <div class="hint" style={{ textAlign: 'center' }}>
            {T('输入好友告诉你的四位房号')}
          </div>
          <Button
            label={st.busy ? T('加入中…') : T('加入')}
            primary
            height={46}
            disabled={!codeOk || st.busy}
            style={{ width: '100%', marginTop: '18px' }}
            onClick={join}
          />
        </>
      )}
    </>
  );
}

function lobby(h: number) {
  const s = settings.value,
    u = ui.value;
  return (
    <div class="npanel col" style={{ height: h + 'px', ['--lw' as any]: labelW() + 'px' }}>
      <h1 class="title" style={{ height: '60px' }}>
        {T('联机对战')}
      </h1>
      <UpdateNote style={{ marginTop: '-8px', marginBottom: '8px' }} />
      <Row label={T('昵称')}>
        <Field value={s.nick} maxLength={NICK_INPUT_MAX} placeholder={T('给自己取个名字')} onInput={v => setSettings({ nick: clipName(v) })} />
      </Row>
      <Seg items={[T('匹配'), T('排位'), T('好友')]} sel={u.tab} onChange={v => setUi({ tab: v })} />
      <div style={{ height: '20px' }} />
      <div key={u.tab} class="tab-body">
        {u.tab === 0 ? matchTab() : u.tab === 1 ? rankedTab() : friendTab()}
      </div>
      <div style={{ flex: '1 1 0' }} />
      <Notice style={{ marginBottom: '10px' }} />
      <Button label={T('返回')} height={44} style={{ width: '100%' }} onClick={() => goScreen(Screen.Menu)} />
    </div>
  );
}

// ---------------- 匹配中 · 找到对手 · 等好友 ----------------

function searching(h: number) {
  const ranked = st.qMode === 'ranked',
    t = now();
  const dots = '...'.slice(0, Math.floor(t * 2) % 4);
  return (
    <div class="npanel col" style={{ height: h + 'px' }}>
      <h1 class="title" style={{ height: '60px' }}>
        {T(ranked ? '正在排位' : '正在匹配')}
      </h1>
      <div class="sub" style={{ height: '30px' }}>
        <Fit size={14} min={10}>
          {summary(queueRules(st.qMode, st.qType, st.qSize))}
        </Fit>
      </div>
      {ranked && (
        <div class="sub" style={{ height: '26px' }}>
          {TF('你的段位 %s', rankText(ratingOf(st.qType).points))}
        </div>
      )}
      <div class="big-clock">{clock(Math.max(0, t - st.qSince))}</div>
      <div style={{ fontSize: '15px', height: '28px' }}>{T('正在寻找对手') + dots}</div>
      <div class="hint">{T('找到对手后双方确认即开局')}</div>
      <div style={{ flex: '1 1 0' }} />
      <Notice style={{ marginBottom: '10px' }} />
      <Button label={T('取消匹配')} height={44} style={{ width: '100%' }} onClick={net.unqueue} />
    </div>
  );
}

function found(h: number) {
  const o = st.opp!,
    left = Math.max(0, st.foundSecs - (now() - st.foundAt)),
    ranked = st.qMode === 'ranked';
  const status = st.accepted
    ? st.oppAccepted
      ? '双方已确认，即将开局…'
      : '已接受，等待对方确认…'
    : st.oppAccepted
      ? '对方已接受，请确认'
      : '请在倒计时结束前确认';
  return (
    <div class="npanel col" style={{ height: h + 'px' }}>
      <h1 class="title" style={{ height: '60px' }}>
        {T('找到对手')}
      </h1>
      <div class="sub" style={{ height: '30px' }}>
        <Fit size={14} min={10}>
          {summary(queueRules(st.qMode, st.qType, st.qSize))}
        </Fit>
      </div>
      <div class="opp-card">
        <div class="opp-name">
          <Fit size={24} min={14}>
            {o.name}
          </Fit>
        </div>
        {ranked && o.points !== undefined && <div class="opp-rank">{rankText(o.points)}</div>}
        <div class="count-bar">
          <div style={{ width: (left / st.foundSecs) * 100 + '%' }} />
        </div>
        <div class="row-between" style={{ marginTop: '8px', fontSize: '13px' }}>
          <span class="dim" style={{ minWidth: 0 }}>
            <Fit size={13} min={10}>
              {T(status)}
            </Fit>
          </span>
          <span class="dim" style={{ flex: 'none', marginLeft: '8px', fontVariantNumeric: 'tabular-nums' }}>
            {Math.ceil(left)}s
          </span>
        </div>
      </div>
      <div class="btns" style={{ marginTop: '22px' }}>
        <Button label={T('拒绝')} height={46} onClick={() => net.confirm(false)} />
        <Button label={st.accepted ? T('已接受') : T('接受')} primary height={46} disabled={st.accepted} onClick={() => net.confirm(true)} />
      </div>
      <div style={{ flex: '1 1 0' }} />
      <Notice />
    </div>
  );
}

function hosting(h: number) {
  const u = ui.value,
    s = settings.value;
  const renju = u.fType === 0 && (u.fRenju < 0 ? s.renju : !!u.fRenju);
  const side = u.fColor === 0 ? '你执黑先行' : u.fColor === 1 ? '你执白后行' : '开局时随机决定先后';
  return (
    <div class="npanel col" style={{ height: h + 'px' }}>
      <h1 class="title" style={{ height: '60px' }}>
        {T('等待好友加入')}
      </h1>
      <div class="sub" style={{ height: '26px' }}>
        <Fit size={14} min={10}>
          {summary({ type: u.fType, size: u.fType ? u.fSize : 15, renju, moveTime: u.fTime })}
        </Fit>
      </div>
      <div class="sub" style={{ height: '20px', fontSize: '13px' }}>
        {T(side)}
      </div>
      <div class="room-code">
        {st.code.split('').map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </div>
      <div style={{ fontSize: '14px', lineHeight: '22px' }}>{T('把房号告诉好友，好友在加入房间里输入就能开局')}</div>
      <div style={{ flex: '1 1 0' }} />
      <Notice style={{ marginBottom: '10px' }} />
      <Button label={T('关闭房间')} height={44} style={{ width: '100%' }} onClick={net.closeRoom} />
    </div>
  );
}

/** 右侧面板里的多人游戏页。各屏写成普通函数在这里调用：读了信号的子组件在 props 不变时不会随父组件重绘 */
export function OnlinePanel({ h }: { h: number }) {
  netTick.value;
  settings.value;
  ui.value;
  const inLobby = st.phase < Phase.Queue;
  useEffect(() => {
    if (inLobby) {
      const [t, n] = boardFor();
      if (game.type !== t || game.N !== n) newGame(t, n);
    }
  });
  if (st.phase === Phase.Queue) return searching(h);
  if (st.phase === Phase.Found && st.opp) return found(h);
  if (st.phase === Phase.Hosting) return hosting(h);
  return lobby(h);
}

// ---------------- 联机对局 ----------------

const KIND_TAG = { match: '匹配', ranked: '排位', friend: '好友' } as const;

function PlayerRow({ color }: { color: number }) {
  netTick.value;
  uiTick.value; // 读了信号的组件在 props 不变时不随父组件重绘，所以自己订阅
  const active = !st.over && !game.scoring && st.toMove === color,
    t = now();
  const p: Opponent = st.players[color] ?? { name: '?' };
  let right = '',
    warn = false;
  if (color !== st.myColor && !st.peerOnline) right = TF('离线 %d 秒', Math.max(0, Math.floor(st.peerBackBy - t)));
  else if (active && st.turnEnds > 0) {
    const left = Math.max(0, Math.ceil(st.turnEnds - t));
    right = clock(left);
    warn = st.turnEnds - t < 10; // 最后 10 秒变红
  } else if (active) right = T(color === st.myColor ? '落子中' : '思考中');
  const rank = st.kind === 'ranked' && p.points !== undefined ? '  ·  ' + T(rankName(p.points)) : '';
  return (
    <div class={'player-row' + (active ? ' active' : '')}>
      <StoneIcon color={color} small />
      <span style={{ flex: '1 1 auto', minWidth: 0, fontSize: '16px' }}>
        <Fit size={16}>{p.name + (color === st.myColor ? T('（你）') : '') + rank}</Fit>
      </span>
      {right && (
        <span style={{ flex: 'none', fontSize: '15px', color: warn ? 'rgb(190 70 50)' : 'var(--dim)', fontVariantNumeric: 'tabular-nums' }}>{right}</span>
      )}
    </div>
  );
}

const ASK_IN: Record<string, string> = { undo: '对方申请悔棋，%d 秒', draw: '对方申请和棋，%d 秒', rematch: '对方申请再来一局，%d 秒' };
const ASK_OUT: Record<string, string> = { undo: '已申请悔棋，等待对方回应…', draw: '已申请和棋，等待对方回应…', rematch: '已申请再来一局，等待对方回应…' };

export function OnlineGamePanel({ h }: { h: number }) {
  netTick.value;
  uiTick.value;
  settings.value;
  const g = game,
    blown = blowing(),
    t = now(),
    ranked = st.kind === 'ranked';
  let status: string;
  if (st.over) status = st.winner === 3 ? '和棋' : st.winner === st.myColor ? '你赢了' : '你输了';
  else if (g.scoring) status = '点目';
  else if (st.toMove === st.myColor) status = '轮到你';
  else status = '等待对手';
  const info =
    g.type === GameType.Go && (g.scoring || g.finished)
      ? TF('黑 %.0f  ·  白 %.1f，含贴目 %.1f', g.scoreB, g.scoreW, g.komi)
      : g.type === GameType.Go
        ? TF('第 %d 手  ·  黑提 %d  ·  白提 %d', g.cur.moves + 1, g.cur.cap[BLACK], g.cur.cap[WHITE])
        : TF('第 %d 手', g.cur.moves + 1);
  const free = !st.askIn && !st.askOut && !st.leaveAsk;
  const msgAge = boardView.msg ? t - boardView.msgAt : 99;
  const foot = st.over ? (blown ? 'V 查看棋局   Esc 离开' : 'Esc 离开') : g.type === GameType.Go ? 'U 悔棋   P 停一手   Esc 离开' : 'U 悔棋   Esc 离开';
  const leaveNow = () => {
    net.leave();
    goScreen(Screen.Online);
  };

  return (
    <div class="npanel" style={{ height: h + 'px' }}>
      <div class="row-between" style={{ height: '60px', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: '1 1 auto' }}>
          <h1 class="title" style={{ flex: 'none' }}>
            {typeName(st.type)}
          </h1>
          <span class={'tag ' + st.kind}>{T(KIND_TAG[st.kind])}</span>
        </div>
        <Button label={T('离开')} height={30} style={{ width: '72px', flex: 'none', marginTop: '12px' }} onClick={net.askLeave} />
      </div>
      <div class="sub" style={{ height: '36px' }}>
        <Fit size={14} min={10}>
          {summary(st)}
        </Fit>
      </div>
      <PlayerRow color={BLACK} />
      <div style={{ height: '6px' }} />
      <PlayerRow color={WHITE} />
      <Hair style={{ margin: '12px 0 24px' }} />
      <div class="status" style={{ height: '34px', alignItems: 'flex-start' }}>
        <Fit size={22} min={14}>
          {T(status)}
        </Fit>
      </div>
      <div class="sub" style={{ height: '30px' }}>
        <Fit size={14} min={10}>
          {info}
        </Fit>
      </div>
      {st.over && ranked && st.rated && (
        <div class="rated">
          <span>{rankText(st.rated.rating.points)}</span>
          <span class={st.rated.delta >= 0 ? 'up' : 'down'}>{(st.rated.delta >= 0 ? '+' : '') + st.rated.delta}</span>
        </div>
      )}

      {(st.askIn || st.askOut || st.leaveAsk) && (
        <div class="ask-card">
          {st.leaveAsk ? (
            <>
              <div style={{ fontSize: '14px' }}>
                <Fit size={14} min={10}>
                  {T(ranked ? '对局还没结束，现在离开会判负并扣段位分。' : '对局还没结束，现在离开会判负。')}
                </Fit>
              </div>
              <div class="btns" style={{ marginTop: '12px' }}>
                <Button
                  label={T('继续下')}
                  height={36}
                  onClick={() => {
                    st.leaveAsk = false;
                    netTick.value++;
                  }}
                />
                <Button label={T('确定离开')} primary height={36} onClick={leaveNow} />
              </div>
            </>
          ) : st.askIn ? (
            <>
              <div style={{ fontSize: '15px' }}>
                <Fit size={15} min={10}>
                  {TF(ASK_IN[st.askIn], Math.max(0, Math.floor(20 - (t - st.askInAt))))}
                </Fit>
              </div>
              <div class="btns" style={{ marginTop: '12px' }}>
                <Button label={T('拒绝')} height={36} onClick={() => net.reply(false)} />
                <Button label={T('同意')} primary height={36} onClick={() => net.reply(true)} />
              </div>
            </>
          ) : (
            <div class="dim" style={{ fontSize: '14px' }}>
              <Fit size={14} min={10}>
                {T(ASK_OUT[st.askOut!])}
              </Fit>
            </div>
          )}
        </div>
      )}

      {st.over ? (
        <div class="btns">
          {blown && <Button label={T(boardView.review ? '收起棋局' : '查看棋局')} onClick={toggleReview} />}
          {ranked ? (
            <Button label={T('继续排位')} primary onClick={net.playAgain} />
          ) : (
            <Button label={T('再来一局')} primary disabled={!free || st.oppLeft || !st.peerOnline} onClick={net.rematch} />
          )}
          <Button label={T('离开')} onClick={leaveNow} />
        </div>
      ) : g.scoring ? (
        <>
          <div class="btns">
            <Button label={T('继续对局')} disabled={!free} onClick={net.resume} />
            <Button label={T(st.agreed[st.myColor] ? '已确认' : '确认结果')} primary disabled={!free || st.agreed[st.myColor]} onClick={net.agree} />
          </div>
          <div class="faint" style={{ fontSize: '12px', marginTop: '10px', height: '22px' }}>
            <Fit size={12} min={9}>
              {T(st.agreed[3 - st.myColor] ? '对方已确认结果' : '点击棋块可以标记或取消死子，双方都确认后结束')}
            </Fit>
          </div>
        </>
      ) : (
        <div class="btns">
          <Button label={T('悔棋')} disabled={!free || !g.hist.length} onClick={net.undo} />
          {g.type === GameType.Go && <Button label={T('停一手')} disabled={!free || !net.myTurn()} onClick={net.pass} />}
          <Button label={T('求和')} disabled={!free} onClick={net.draw} />
          <Button label={T('认输')} disabled={!free} onClick={net.resign} />
        </div>
      )}
      <Notice style={{ marginTop: '12px' }} />
      <div class="msg faint" style={{ fontSize: '13px', marginTop: '2px', opacity: msgAge < 2.4 ? 1 : 0 }}>
        {boardView.msg && msgAge < 3 ? T(boardView.msg.key) : ''}
      </div>
      <div class="foot" style={{ bottom: '0px' }}>
        {T(foot)}
      </div>
    </div>
  );
}

// ---------------- 棋盘上的名牌 ----------------

function Plate({ x, y, text, strong = false, dim = 1 }: { x: number; y: number; text: string; strong?: boolean; dim?: number }) {
  return (
    <div class={'plate' + (strong ? ' strong' : '')} style={{ left: x + 'px', top: y + 'px', opacity: dim }}>
      {text}
    </div>
  );
}

/** 两只棋罐的名牌：黑罐是自己，白罐是对手的座位 */
export function ScenePlates() {
  netTick.value;
  settings.value;
  const u = ui.value;
  const L = layout.value;
  const on = screen.value === Screen.Online;
  const last = useRef<ComponentChildren>(null);
  const [, force] = useState(0);
  useEffect(() => {
    // 离开多人游戏页时名牌跟着面板淡出，淡完再清掉
    if (on || !last.current) return;
    const id = setTimeout(() => {
      last.current = null;
      force(v => v + 1);
    }, 350);
    return () => clearTimeout(id);
  }, [on]);
  if (!on) return <div class={last.current ? 'plates off' : 'plates'}>{last.current}</div>;
  const pl = seatPlates(L),
    nick = settings.value.nick.trim() || T('棋手');
  const rankedView = st.phase === Phase.Queue || st.phase === Phase.Found ? st.qMode === 'ranked' : st.phase !== Phase.Hosting && u.tab === 1;
  const myType = st.phase === Phase.Queue || st.phase === Phase.Found ? st.qType : u.type;
  const me = TF('你 · %s', nick) + (rankedView ? '  ·  ' + T(rankName(ratingOf(myType).points)) : '');
  let other: string,
    strong = false;
  if (st.phase === Phase.Found && st.opp) {
    other = st.opp.name + (st.qMode === 'ranked' && st.opp.points !== undefined ? '  ·  ' + T(rankName(st.opp.points)) : '');
    strong = true;
  } else other = T(st.phase === Phase.Queue ? '寻找对手…' : st.phase === Phase.Hosting ? '等待好友…' : '虚位以待');
  last.current = (
    <>
      <Plate x={pl[0].x} y={pl[0].y} strong text={me} />
      <Plate key={strong ? 'o' : 'e'} x={pl[1].x} y={pl[1].y} strong={strong} dim={strong ? 1 : 0.8} text={other} />
    </>
  );
  return <div class="plates on">{last.current}</div>;
}

/** 右侧面板：开始菜单、对局、设置、更多 */
import { useState } from 'preact/hooks';
import { confirmScore, goScreen, newGame, pass, requestUndo, resumeGame, setVsAI, toggleReview } from '../app/controller';
import { Lang, resetSettings, setSettings, settings } from '../app/settings';
import { game, Screen, uiTick, VERSION, boardView } from '../app/state';
import { sfx } from '../audio';
import { now } from '../core/clock';
import { BLACK, GameType, WHITE } from '../core/types';
import { blowing } from '../fx/blow';
import { T, TF } from '../i18n';
import { INFO_PAGES, type InfoLine } from './info';
import { native } from '../app/native';
import { netTick, st as netSt } from '../online/client';
import { Button, Fit, Hair, Seg, Slider, StoneIcon } from './widgets';

export const isDesktop = () => !!native();

/** 服务端告知有新版本时的提示；有下载地址时点一下用浏览器打开 */
export function UpdateNote({ style }: { style?: Record<string, string> }) {
  netTick.value;
  const u = netSt.update;
  if (!u) return null;
  const go = () => { if (/^https?:\/\//.test(u.url)) window.open(u.url); };
  return <div class={'update-note' + (u.url ? ' link' : '')} style={style} onClick={go}><Fit size={13} min={10}>{TF(u.url ? '有新版本 %s，点这里下载' : '有新版本 %s', u.version)}</Fit></div>;
}

// ---------------- 开始菜单 ----------------

export function MenuPanel({ h }: { h: number }) {
  return (
    <div style={{ height: h + 'px', position: 'relative', paddingTop: h * 0.08 + 'px' }}>
      <div class="brand">
        <div class="big" role="img" aria-label="弈" />
        <div class="seal">{T('棋')}</div>
      </div>
      <div class="sub" style={{ fontSize: '16px' }}>{T('五子棋  ·  围棋')}</div>
      <div class="sub faint" style={{ fontSize: '13px', marginTop: '10px' }}>{T('以木为枰，以石为子')}</div>
      <Hair style={{ margin: '28px 0 34px' }} />
      <div class="stack">
        <Button label={T('单人游戏')} primary height={46} onClick={() => goScreen(Screen.Game)} />
        <Button label={T('多人游戏')} height={46} onClick={() => goScreen(Screen.Online)} />
        <Button label={T('设置')} height={46} onClick={() => goScreen(Screen.Settings)} />
        <Button label={T('更多')} height={46} onClick={() => goScreen(Screen.More)} />
        {isDesktop() && <Button label={T('退出游戏')} height={46} onClick={() => native()?.quit()} />}
      </div>
      <UpdateNote style={{ position: 'absolute', left: '0px', right: '0px', bottom: '24px' }} />
      <div class="foot" style={{ bottom: '0px' }}>v{VERSION}   ·   Copyright 2026 LightKing</div>
    </div>
  );
}

// ---------------- 对局 ----------------

export function GamePanel({ h }: { h: number }) {
  uiTick.value;
  const g = game, s = settings.value, blown = blowing();
  const subtitle = g.type === GameType.Gomoku ? TF('%d 路  ·  五子连珠为胜%s', g.N, g.renju ? T('  ·  黑棋禁手') : '') : TF('%d 路  ·  数子法  ·  贴 %.1f 目', g.N, g.komi);
  let status: string, icon = g.cur.toMove;
  if (g.over) {
    icon = g.winner === 3 ? 0 : g.winner;
    status = g.winner === BLACK ? T('黑棋胜') : g.winner === WHITE ? T('白棋胜') : T('和棋');
  } else if (g.scoring) { status = T('点目'); icon = 0; }
  else if (g.aiToMove()) status = T('电脑思考中…');
  else status = g.cur.toMove === BLACK ? T('黑方落子') : T('白方落子');
  const info = g.over && g.type === GameType.Gomoku && g.winner !== 3 ? TF('五子连珠  ·  共 %d 手', g.cur.moves)
    : g.over && g.type === GameType.Go ? TF('胜 %.1f 目  ·  共 %d 手', Math.abs(g.scoreB - g.scoreW), g.cur.moves)
      : g.scoring ? T('点击棋块可标记 / 取消死子') : TF('第 %d 手', g.cur.moves + 1);
  const capText = (c: number) => (g.cur.cap[c] || s.lang !== Lang.WY ? TF('提子 %d', g.cur.cap[c]) : '未有所提');
  const msgAge = boardView.msg ? now() - boardView.msgAt : 99;
  const foot = g.type === GameType.Go ? T('U 悔棋   P 停一手   N 新局   C 坐标   T 主题   Esc 菜单')
    : blown ? T('U 悔棋   V 查看棋局   N 新局   T 主题   Esc 菜单') : T('U 悔棋   N 新局   C 坐标   T 主题   Esc 菜单');

  return (
    <div style={{ height: h + 'px', position: 'relative', paddingTop: '4px' }}>
      <div class="row-between" style={{ height: '56px' }}>
        <h1 class="title" style={{ flex: '1 1 auto', minWidth: 0 }}><Fit size={44} min={26}>{g.type === GameType.Gomoku ? T('五子棋') : T('围棋')}</Fit></h1>
        <Button label={T('菜单')} height={30} style={{ width: '64px', flex: 'none' }} onClick={() => goScreen(Screen.Menu)} />
      </div>
      <div class="sub" style={{ marginTop: '4px', height: '38px' }}><Fit size={14} min={11}>{subtitle}</Fit></div>
      <Seg items={[T('五子棋'), T('围棋')]} sel={g.type} onChange={m => newGame(m, m === GameType.Gomoku ? 15 : g.goSize)} />
      <div style={{ height: '10px' }} />
      {g.type === GameType.Go && <>
        <Seg items={[T('9 路'), T('13 路'), T('19 路')]} sel={g.N === 9 ? 0 : g.N === 13 ? 1 : 2} onChange={v => newGame(GameType.Go, [9, 13, 19][v])} />
        <div style={{ height: '8px' }} />
      </>}
      <Seg items={[T('双人对弈'), T('人机对弈')]} sel={g.vsAI ? 1 : 0} onChange={v => setVsAI(v === 1)} />
      {g.vsAI && <>
        <div style={{ height: '8px' }} />
        <Seg height={34} items={[T('简单'), T('普通'), T('困难')]} sel={s.aiLevel} onChange={v => setSettings({ aiLevel: v })} />
      </>}
      <Hair style={{ margin: `${g.vsAI ? 28 : 32}px 0 30px` }} />
      <div class="status">
        {icon ? <StoneIcon color={icon} /> : null}
        <Fit size={22} min={14}>{status}</Fit>
      </div>
      <div class="sub" style={{ marginTop: '14px', height: '34px' }}><Fit size={14} min={11}>{info}</Fit></div>
      {g.type === GameType.Go && (
        <div class="caps" style={{ marginBottom: '6px' }}>
          {g.scoring || g.finished ? <>
            <div><StoneIcon color={BLACK} small /><span style={{ fontSize: '18px' }}>{TF('%.0f', g.scoreB)}</span></div>
            <div><StoneIcon color={WHITE} small /><span style={{ fontSize: '18px' }}>{TF('%.1f', g.scoreW)}</span></div>
            <div class="faint" style={{ fontSize: '12px' }}>{T('子 + 地')}</div>
            <div class="faint" style={{ fontSize: '12px' }}>{TF('子 + 地 + 贴 %.1f', g.komi)}</div>
          </> : <>
            <div><StoneIcon color={BLACK} small />{capText(BLACK)}</div>
            <div><StoneIcon color={WHITE} small />{capText(WHITE)}</div>
          </>}
        </div>
      )}
      <Hair style={{ margin: '20px 0 30px' }} />
      <div class="btns">
        {g.scoring ? <>
          <Button label={T('继续对局')} onClick={resumeGame} />
          <Button label={T('确认结果')} primary onClick={confirmScore} />
        </> : g.type === GameType.Go ? <>
          <Button label={T('悔棋')} disabled={!g.hist.length} onClick={requestUndo} />
          <Button label={T('停一手')} disabled={g.over || g.aiToMove()} onClick={pass} />
          <Button label={T('新局')} primary onClick={() => newGame(GameType.Go, g.N)} />
        </> : blown ? <>
          <Button label={T('悔棋')} disabled={!g.hist.length} onClick={requestUndo} />
          <Button label={boardView.review ? T('收起棋局') : T('查看棋局')} onClick={toggleReview} />
          <Button label={T('新局')} primary onClick={() => newGame(GameType.Gomoku, 15)} />
        </> : <>
          <Button label={T('悔棋')} disabled={!g.hist.length} onClick={requestUndo} />
          <Button label={T('新局')} primary onClick={() => newGame(GameType.Gomoku, 15)} />
        </>}
      </div>
      <div class="msg" style={{ marginTop: '22px', opacity: msgAge < 2 ? 1 : 0 }}>{boardView.msg && msgAge < 2.6 ? T(boardView.msg.key) : ''}</div>
      <div class="foot" style={{ bottom: '0px' }}>{foot}</div>
    </div>
  );
}

// ---------------- 设置 ----------------

export function Row({ label, children }: { label: string; children: preact.ComponentChildren }) {
  return <div class="srow"><div class="label"><Fit size={14} min={10}>{label}</Fit></div><div class="ctl">{children}</div></div>;
}

function OnOff({ label, on, set }: { label: string; on: boolean; set: (v: boolean) => void }) {
  return <Row label={label}><Seg height={34} items={[T('开'), T('关')]} sel={on ? 0 : 1} onChange={v => set(v === 0)} /></Row>;
}

const SCALES = [0.85, 1, 1.15, 1.3];

export function SettingsPanel({ h }: { h: number }) {
  const [tab, setTab] = useState(0);
  const s = settings.value;
  const lw = s.lang === Lang.EN ? 118 : 80;
  const scaleIdx = SCALES.reduce((b, v, i) => (Math.abs(v - s.uiScale) < Math.abs(SCALES[b] - s.uiScale) ? i : b), 1);
  return (
    <div style={{ height: h + 'px', position: 'relative', paddingTop: '4px', ['--lw' as any]: lw + 'px' }}>
      <h1 class="title" style={{ height: '56px' }}>{T('设置')}</h1>
      <div class="sub" style={{ marginTop: '4px', height: '34px' }}>{T('修改后自动保存')}</div>
      <Seg items={[T('声音'), T('画面'), T('对局')]} sel={tab} onChange={setTab} />
      <div style={{ height: '22px' }} />
      {tab === 0 && <>
        <OnOff label={T('背景音乐')} on={s.music} set={v => setSettings({ music: v })} />
        <Row label={T('音乐音量')}><Slider value={s.musicVol} onChange={v => setSettings({ musicVol: v })} /></Row>
        <OnOff label={T('音效')} on={s.sound} set={v => setSettings({ sound: v })} />
        <Row label={T('音效音量')}><Slider value={s.volume} onChange={v => setSettings({ volume: v })} onRelease={() => sfx.clack(0.9)} /></Row>
      </>}
      {tab === 1 && <>
        <Row label={T('语言')}><Seg height={34} items={['文言', '中文', 'English']} sel={s.lang} onChange={v => setSettings({ lang: v })} /></Row>
        <Row label={T('主题')}><Seg height={34} items={[T('浅色'), T('深色')]} sel={s.theme} onChange={v => setSettings({ theme: v })} /></Row>
        <Row label={T('终局特效')}><Seg height={34} items={[T('关闭'), T('简洁'), T('完整')]} sel={s.fx} onChange={v => setSettings({ fx: v })} /></Row>
        <OnOff label={T('屏幕震动')} on={s.shake} set={v => setSettings({ shake: v })} />
        <Row label={T('界面大小')}><Seg height={34} items={[T('小'), T('标准'), T('大'), T('特大')]} sel={scaleIdx} onChange={v => setSettings({ uiScale: SCALES[v] })} /></Row>
        <div class="swide">
          <div class="label">{T('光影')}</div>
          <Seg items={[T('无'), T('黄昏'), T('晨曦'), T('月夜'), T('竹影')]} sel={s.light} onChange={v => setSettings({ light: v })} />
        </div>
      </>}
      {tab === 2 && <>
        <Row label={T('落子动画')}><Seg height={34} items={[T('慢'), T('标准'), T('快')]} sel={s.animSpeed} onChange={v => setSettings({ animSpeed: v })} /></Row>
        <Row label={T('预览跟随')}><Seg height={34} items={[T('柔和'), T('标准'), T('跟手')]} sel={s.follow} onChange={v => setSettings({ follow: v })} /></Row>
        <Row label={T('棋盘坐标')}><Seg height={34} items={[T('隐藏'), T('显示')]} sel={s.coords ? 1 : 0} onChange={v => setSettings({ coords: v === 1 })} /></Row>
        <OnOff label={T('最后一手')} on={s.lastMark} set={v => setSettings({ lastMark: v })} />
        <OnOff label={T('五子棋禁手')} on={s.renju} set={v => {
          setSettings({ renju: v });
          if (game.type === GameType.Gomoku && game.cur.moves === 0) game.renju = v;   // 还没落子就立即生效，否则下一局生效
        }} />
        <Row label={T('电脑难度')}><Seg height={34} items={[T('简单'), T('普通'), T('困难')]} sel={s.aiLevel} onChange={v => setSettings({ aiLevel: v })} /></Row>
        <Row label={T('人机执子')}><Seg height={34} items={[T('执黑先行'), T('执白后行')]} sel={s.humanWhite ? 1 : 0} onChange={v => {
          setSettings({ humanWhite: v === 1 });
          if (game.vsAI) newGame(game.type, game.N);                                  // 换边从新局开始
        }} /></Row>
      </>}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 4 + 56 + 38 + 38 + 22 + 7 * 46 + 16 + 'px' }}>
        <Hair />
        <div class="btns" style={{ marginTop: '24px' }}>
          <Button label={T('恢复默认')} height={44} onClick={() => {
            const white = s.humanWhite;
            resetSettings();
            if (white !== settings.value.humanWhite && game.vsAI) newGame(game.type, game.N);
          }} />
          <Button label={T('返回')} primary height={44} onClick={() => goScreen(Screen.Menu)} />
        </div>
      </div>
    </div>
  );
}

// ---------------- 更多 ----------------

function InfoView({ lines }: { lines: InfoLine[] }) {
  return <>{lines.map((ln, i) => {
    if (ln[0] === 'H') return <h4 key={i}>{T(ln[1])}</h4>;
    if (ln[0] === 'P') return <p key={i}>{T(ln[1])}</p>;
    if (ln[0] === 'K') return <div key={i} class="kv"><span>{T(ln[1])}</span><span>{T(ln[2])}</span></div>;
    return <div key={i} class="gap" />;
  })}</>;
}

export function MorePanel({ h }: { h: number }) {
  const [tab, setTab] = useState(0);
  settings.value;
  const top = 4 + 56 + 38 + 38 + 20, bottom = Math.max(h, 420) - 44 - 24;
  return (
    <div style={{ height: h + 'px', position: 'relative', paddingTop: '4px' }}>
      <h1 class="title" style={{ height: '56px' }}>{T('更多')}</h1>
      <div class="sub" style={{ marginTop: '4px', height: '34px' }}>{T('弈')} v{VERSION}   ·   Copyright 2026 LightKing</div>
      <Seg items={INFO_PAGES.map(p => T(p.title))} sel={tab} onChange={setTab} />
      <div class="info" key={tab} style={{ position: 'absolute', left: 0, right: 0, top: top + 'px', height: Math.max(80, bottom - top) + 'px' }}>
        <InfoView lines={INFO_PAGES[tab].lines} />
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, top: Math.max(80, bottom - top) + top + 12 + 'px' }}>
        <Hair />
        {INFO_PAGES[tab].title === '关于' && isDesktop()
          ? <div class="btns" style={{ marginTop: '12px' }}>
            <Button label={T('打开日志文件夹')} height={44} onClick={() => native()?.openLogs()} />
            <Button label={T('返回')} height={44} onClick={() => goScreen(Screen.Menu)} />
          </div>
          : <Button label={T('返回')} height={44} style={{ marginTop: '12px', width: '100%' }} onClick={() => goScreen(Screen.Menu)} />}
      </div>
    </div>
  );
}

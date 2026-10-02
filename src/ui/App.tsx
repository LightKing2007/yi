/** 界面根：右侧面板（切换时旧面板左移淡出、新面板从右侧淡入）与棋盘坐标 */
import { useEffect, useState } from 'preact/hooks';
import { layout } from '../app/app';
import { settings } from '../app/settings';
import { game, screen, Screen, uiTick } from '../app/state';
import { T } from '../i18n';
import { OnlineGamePanel, OnlinePanel, ScenePlates } from './online';
import { netTick, st as net } from '../online/client';
import { GamePanel, MenuPanel, MorePanel, SettingsPanel } from './panels';

function Panel({ s, h }: { s: Screen; h: number }) {
  netTick.value;
  switch (s) {
    case Screen.Menu:
      return <MenuPanel h={h} />;
    case Screen.Settings:
      return <SettingsPanel h={h} />;
    case Screen.More:
      return <MorePanel h={h} />;
    case Screen.Game:
      return net.shownOnline ? <OnlineGamePanel h={h} /> : <GamePanel h={h} />;
    case Screen.Online:
      return <OnlinePanel h={h} />;
  }
}

function PanelHost() {
  const L = layout.value,
    scr = screen.value;
  const [st, setSt] = useState<{ cur: Screen; prev: Screen | null }>({ cur: scr, prev: null });
  useEffect(() => {
    // 前半程旧面板离开，后半程新面板进来
    if (scr === st.cur) return;
    setSt({ cur: scr, prev: st.cur });
    const id = setTimeout(() => setSt(v => ({ ...v, prev: null })), 300);
    return () => clearTimeout(id);
  }, [scr]);
  const h = L.panel.h / L.u;
  const leaving = st.prev;
  const s = leaving ?? st.cur;
  return (
    <div
      class={'panel-host' + (L.vertical ? ' vertical' : '')}
      style={{ left: L.panel.x + 'px', top: L.panel.y + 'px', width: L.panel.w + 'px', height: L.panel.h + 'px' }}
    >
      <div key={String(s) + (leaving !== null ? 'l' : 'e')} class={'panel ' + (leaving !== null ? 'leaving' : 'entering')} style={{ height: h + 'px' }}>
        <Panel s={s} h={h} />
      </div>
    </div>
  );
}

const LETTERS = 'ABCDEFGHJKLMNOPQRST';

function Coords() {
  const L = layout.value;
  uiTick.value;
  if (!settings.value.coords) return null;
  const N = game.N,
    fs = Math.max(9, L.cell * 0.3),
    off = 0.92 * L.cell * 0.42,
    out = [];
  for (let i = 0; i < N; i++) {
    const x = L.ox + i * L.cell,
      y = L.oy + i * L.cell;
    out.push(
      <span key={'t' + i} style={{ left: x + 'px', top: L.board.y + off + 'px' }}>
        {LETTERS[i]}
      </span>,
    );
    out.push(
      <span key={'b' + i} style={{ left: x + 'px', top: L.board.y + L.board.h - off + 'px' }}>
        {LETTERS[i]}
      </span>,
    );
    out.push(
      <span key={'l' + i} style={{ left: L.board.x + off + 'px', top: y + 'px' }}>
        {N - i}
      </span>,
    );
    out.push(
      <span key={'r' + i} style={{ left: L.board.x + L.board.w - off + 'px', top: y + 'px' }}>
        {N - i}
      </span>,
    );
  }
  return (
    <div class="coords" style={{ fontSize: fs + 'px' }}>
      {out}
    </div>
  );
}

export function App() {
  const s = settings.value;
  useEffect(() => {
    document.documentElement.classList.toggle('dark', !!s.theme);
    document.documentElement.lang = s.lang === 2 ? 'en' : 'zh-CN';
    document.title = T('弈 · 五子棋 & 围棋');
  }, [s.theme, s.lang]);
  return (
    <>
      <Coords />
      <ScenePlates />
      <PanelHost />
    </>
  );
}

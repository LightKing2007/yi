/**
 * 主页上的棋盘：榧木盘面、网格与星位、依次落下的棋子、连线与禁手标记、可预览落子的交叉点。坐标按棋谱的写法表示，
 * 样式见本文件的 boardStyle，随滚动落子的动画见 homeStyle.ts 与 geometry.ts；页面不含脚本（API-063）。
 */

/** 坐标按棋谱的写法以两个小写字母表示（a 为第 1 路），如 dd 为左上的星位 */
const COL_A = 'a'.charCodeAt(0);
const point = (code: string) => ({ x: code.charCodeAt(0) - COL_A, y: code.charCodeAt(1) - COL_A });
const PERCENT = 100;
/** 位置的小数位数 */
const PLACES = 3;
/** 交叉点在棋盘内的百分比位置；line 为第几路（从 0 起），size 为路数 */
const pct = (line: number, size: number) => `${((line / (size - 1)) * PERCENT).toFixed(PLACES)}%`;

/** 棋盘的选项：路数、星位、依次落下的棋子（黑先，以空格分隔），以及可选的类名、是否可预览落子 */
export interface BoardSpec {
  size: number;
  stars: string;
  moves: string;
  cls?: string;
  /** 在空交叉点上预览落子（以 CSS 的悬停实现） */
  ghost?: boolean;
  /** 自行指定每手棋的颜色（b 或 w，与 moves 一一对应），不指定时黑白交替 */
  colors?: string;
  /** 盖在棋子上的连线（两端的坐标）与禁手标记（小叉，坐标以空格分隔） */
  line?: string;
  cross?: string;
}

/** 棋盘：网格与星位（SVG）、依次落下的棋子（序号写入 --i 供动画错开）、最后一手的标记 */
export function board(spec: BoardSpec) {
  const { size } = spec;
  const lines: string[] = [];
  for (let i = 0; i < size; i++) lines.push(`<line x1="0" y1="${i}" x2="${size - 1}" y2="${i}"/><line x1="${i}" y1="0" x2="${i}" y2="${size - 1}"/>`);
  const stars = spec.stars.split(' ').map(code => {
    const { x, y } = point(code);
    return `<circle cx="${x}" cy="${y}" r="0.09"/>`;
  });
  const moves = spec.moves.split(' ');
  const stones = moves.map((code, i) => {
    const { x, y } = point(code);
    const color = spec.colors?.[i] ?? (i % 2 ? 'w' : 'b');
    const last = i === moves.length - 1 ? ' last' : '';
    return `<b class="st ${color}${last}" style="left:${pct(x, size)};top:${pct(y, size)};--i:${i}"></b>`;
  });
  return (
    `<div class="board ${spec.cls ?? ''}" style="--n:${size}"><div class="grid">` +
    `<svg viewBox="0 0 ${size - 1} ${size - 1}" preserveAspectRatio="none" aria-hidden="true">${lines.join('')}${stars.join('')}</svg>` +
    `${stones.join('')}${overlay(spec)}${spec.ghost ? ghostCells(size, moves) : ''}</div></div>`
  );
}

/** 盖在棋子上的连线与禁手标记：以 pathLength 归一，供 CSS 描线 */
function overlay(spec: BoardSpec) {
  if (!spec.line && !spec.cross) return '';
  const { size } = spec;
  const [from, to] = (spec.line ?? '').split(' ').map(point);
  const line = from && to ? `<line class="win" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" pathLength="1"/>` : '';
  const arm = 0.22;
  const crosses = (spec.cross ?? '')
    .split(' ')
    .filter(Boolean)
    .map(point)
    .map(({ x, y }) => `<path class="ban" d="M${x - arm} ${y - arm}L${x + arm} ${y + arm}M${x + arm} ${y - arm}L${x - arm} ${y + arm}"/>`);
  return `<svg class="over" viewBox="0 0 ${size - 1} ${size - 1}" preserveAspectRatio="none" aria-hidden="true">${line}${crosses.join('')}</svg>`;
}

/** 可预览落子的交叉点：每个交叉点一个格子，已有棋子的不响应 */
function ghostCells(size: number, moves: string[]) {
  const taken = new Set(moves.map(code => point(code)).map(({ x, y }) => y * size + x));
  const cells = Array.from({ length: size * size }, (_, k) => (taken.has(k) ? '<i class="o"></i>' : '<i></i>')).join('');
  return `<div class="cells" aria-hidden="true">${cells}</div>`;
}

/**
 * 棋盘的样式：榧木纹理、网格、星位、棋子、连线与禁手标记、可预览落子的交叉点，以及棋子落下的动画。
 * 黑子仿云子：窗形的柔光高光、背光一侧透出墨绿；白子仿贝壳：温润的底色、细纹与边缘透光。投影分两层：贴盘的接触阴影与柔和的投影
 */
export const boardStyle = `
.board { position: relative; aspect-ratio: 1; border-radius: 4px; --pad: 5cqi; container-type: inline-size; }
.grid { position: absolute; inset: var(--pad); }
.grid > svg { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; }
.grid line { stroke: rgb(40 24 8 / 0.72); stroke-width: 1; vector-effect: non-scaling-stroke; }
.grid circle { fill: rgb(40 24 8 / 0.8); }
.over { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
.over .win { stroke: var(--seal); stroke-width: 0.13; stroke-linecap: round; stroke-dasharray: 1; }
.over .ban { stroke: var(--seal); stroke-width: 0.08; stroke-linecap: round; fill: none; }
.cells { position: absolute; left: calc(-50% / (var(--n) - 1)); top: calc(-50% / (var(--n) - 1)); width: calc(100% + 100% / (var(--n) - 1));
  height: calc(100% + 100% / (var(--n) - 1)); display: grid; grid-template-columns: repeat(var(--n), 1fr); grid-template-rows: repeat(var(--n), 1fr); }
.cells i { position: relative; }
.cells i.o { pointer-events: none; }
.cells i::after { content: ""; position: absolute; inset: 3%; border-radius: 50%; opacity: 0; transform: scale(0.5);
  background: var(--stone-b);
  transition: opacity 0.3s var(--ease), transform 0.45s cubic-bezier(0.3, 1.6, 0.5, 1); }
.cells i:hover::after { opacity: 0.55; transform: scale(1); }
.cells i:active::after { opacity: 0.9; transform: scale(0.94); }
.wood { background:
    radial-gradient(120% 80% at 22% 10%, rgb(255 240 205 / 0.35), transparent 55%),
    repeating-linear-gradient(91deg, rgb(110 62 18 / 0.08) 0 1px, transparent 1px 7px),
    repeating-linear-gradient(89.4deg, rgb(110 62 18 / 0.06) 0 2px, transparent 2px 19px),
    repeating-linear-gradient(90.7deg, rgb(255 236 200 / 0.09) 0 3px, transparent 3px 29px),
    linear-gradient(170deg, #ecd09a, #ddb673 55%, #c99a52);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.4), inset 0 -2px 0 rgb(0 0 0 / 0.08); }
.st { position: absolute; width: calc(100% / (var(--n) - 1) * 0.94); aspect-ratio: 1; border-radius: 50%; transform: translate(-50%, -50%);
  font-size: calc((100cqi - 2 * var(--pad)) / (var(--n) - 1)); }
.st.b { background:
    radial-gradient(ellipse 30% 20% at 36% 27%, rgb(255 255 255 / 0.5), rgb(255 255 255 / 0.08) 65%, transparent 100%),
    radial-gradient(circle at 72% 82%, rgb(70 110 95 / 0.38), transparent 42%),
    radial-gradient(circle at 42% 36%, #3c3c3b 0, #181817 42%, #070707 78%, #000 100%);
  box-shadow: 0 0.05em 0.05em rgb(0 0 0 / 0.55), 0.1em 0.2em 0.3em rgb(0 0 0 / 0.38), inset 0 -0.05em 0.1em rgb(0 0 0 / 0.6); }
.st.w { background:
    radial-gradient(ellipse 34% 24% at 36% 28%, rgb(255 255 255 / 0.95), transparent 70%),
    repeating-radial-gradient(circle at 50% 135%, rgb(150 130 100 / 0.07) 0 2.5%, transparent 2.5% 5%),
    radial-gradient(circle at 70% 84%, rgb(190 205 215 / 0.45), transparent 45%),
    radial-gradient(circle at 42% 38%, #fdfbf6 0, #efe9de 50%, #d6cdbd 88%, #c2b7a4 100%);
  box-shadow: 0 0.05em 0.05em rgb(50 30 5 / 0.45), 0.1em 0.2em 0.3em rgb(60 40 10 / 0.3), inset 0 -0.05em 0.12em rgb(120 100 70 / 0.35); }
.st.last::before { content: ""; position: absolute; left: 50%; top: 50%; width: 24%; height: 24%; border-radius: 50%; transform: translate(-50%, -50%);
  background: var(--seal); z-index: 1; }
@keyframes drop {
  0% { opacity: 0; transform: translate(-50%, -50%) translateY(-30%) scale(1.35); filter: blur(2px); }
  55% { opacity: 1; transform: translate(-50%, -50%) scale(0.95); filter: none; }
  100% { opacity: 1; transform: translate(-50%, -50%); }
}
`;

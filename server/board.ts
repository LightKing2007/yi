/**
 * 主页上的棋盘：网格与星位、依次落下的棋子、连线与禁手标记、可预览落子的交叉点。坐标按棋谱的写法表示，
 * 样式见本文件的 boardStyle，随滚动落子的动画见 homeStyle.ts；页面不含脚本（API-063）。
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

/** 棋盘的样式：网格、星位、连线与禁手标记、可预览落子的交叉点；棋子的样式见 pageStyle.ts */
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
  background: radial-gradient(circle at 34% 30%, #6a6a6a 0, #1a1a1a 55%, #000 100%);
  transition: opacity 0.3s var(--ease), transform 0.45s cubic-bezier(0.3, 1.6, 0.5, 1); }
.cells i:hover::after { opacity: 0.55; transform: scale(1); }
.cells i:active::after { opacity: 0.9; transform: scale(0.94); }
`;

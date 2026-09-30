/**
 * 窗口布局：棋盘与面板的位置、格距、交叉点坐标（CSS 像素）。
 * 界面按设计稿（1320×900 的窗口）等比缩放：u 为一个设计像素在当前窗口里的大小，
 * 所以高分辨率屏幕、大窗口上界面跟着放大，不会缩成一小块。
 */
export interface Rect { x: number; y: number; w: number; h: number }

export interface Layout {
  board: Rect;
  panel: Rect;
  cell: number;
  ox: number;
  oy: number;
  R: number;
  thick: number;
  /** 一个设计像素的大小 */
  u: number;
  vertical: boolean;
}

export const PAD = 0.92;                // 棋盘边缘到第一条线的距离（格）
export const DESIGN_W = 1320, DESIGN_H = 900;

/** 设计像素的大小：按窗口等比缩放，小窗口不低于 0.8；userScale 为设置里的界面缩放 */
export function uiUnit(W: number, H: number, userScale = 1) {
  return Math.max(0.8, Math.min(W / DESIGN_W, H / DESIGN_H)) * userScale;
}

export function computeLayout(W: number, H: number, N: number, userScale = 1): Layout {
  const u = uiUnit(W, H, userScale);
  const margin = Math.max(28 * u, Math.min(W, H) * 0.055);
  const panelW = 300 * u, gap = Math.max(40 * u, W * 0.04);
  const vertical = W < H * 1.1;
  let board: Rect, panel: Rect, bs: number;
  if (!vertical) {
    bs = Math.max(240, Math.min(H - 2 * margin - 16 * u, W - panelW - gap - 2 * margin));
    const total = bs + gap + panelW, x0 = (W - total) / 2;
    board = { x: Math.round(x0), y: Math.round((H - bs) / 2 - 8 * u), w: Math.round(bs), h: Math.round(bs) };
    panel = { x: board.x + bs + gap, y: board.y, w: panelW, h: bs };
  } else {
    const panelH = 330 * u;
    bs = Math.max(240, Math.min(W - 2 * margin, H - 2 * margin - panelH - 24 * u));
    board = { x: Math.round((W - bs) / 2), y: Math.round(margin), w: Math.round(bs), h: Math.round(bs) };
    panel = { x: (W - panelW) / 2, y: board.y + bs + 40 * u, w: panelW, h: Math.max(panelH, H - (board.y + bs + 40 * u) - 12 * u) };
  }
  return { board, panel, u, vertical, ...gridFor(board, N) };
}

/** 同一块棋盘换成 N 路时的格距与原点 */
export function gridFor(board: Rect, N: number) {
  const cell = board.w / (N - 1 + 2 * PAD);
  return { cell, ox: board.x + PAD * cell, oy: board.y + PAD * cell, R: cell * 0.482, thick: Math.max(5, board.w * 0.022) };
}

export function layoutForN(L: Layout, N: number): Layout { return { ...L, ...gridFor(L.board, N) }; }

export const pt = (L: Layout, x: number, y: number) => ({ x: L.ox + x * L.cell, y: L.oy + y * L.cell });

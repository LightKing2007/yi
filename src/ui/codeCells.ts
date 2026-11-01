/**
 * 六格验证码的输入规则（项目所有者 2026-11-01 定稿）：每格一位数字；在任一格粘贴满六位时从第一格起填满，不足六位时从当前格起依次填；
 * 键入一位覆盖当前格并跳到下一格；当前格为空时退格删去上一格并回到上一格。非数字一律忽略。只是纯函数，界面见 widgets.tsx 的 CodeCells
 */

/** 一次编辑的结果：各格内容与之后应当聚焦的格 */
export interface CellsEdit {
  cells: string[];
  focus: number;
}

/** 从 at 格起填入 input 中的数字；input 恰有全部格数的数字时（粘贴整串、系统自动填充）从第一格起 */
export function fillCells(cells: readonly string[], at: number, input: string): CellsEdit {
  const digits = input.match(/\d/g) ?? [];
  const out = [...cells];
  if (digits.length === 0) return { cells: out, focus: at };
  let i = digits.length >= out.length ? 0 : at;
  for (const digit of digits) {
    if (i >= out.length) break;
    out[i++] = digit;
  }
  return { cells: out, focus: Math.min(i, out.length - 1) };
}

/** 在 at 格按退格：本格有数字时清空本格；本格为空时清空上一格并回到上一格 */
export function backspaceCells(cells: readonly string[], at: number): CellsEdit {
  const out = [...cells];
  if (out[at]) {
    out[at] = '';
    return { cells: out, focus: at };
  }
  if (at === 0) return { cells: out, focus: 0 };
  out[at - 1] = '';
  return { cells: out, focus: at - 1 };
}

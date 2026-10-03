/**
 * 外部输入的取值校验函数：联机消息（parse.ts）与本地存储（app/storage.ts）共用。
 * 每个函数只判断一个值是否合格，不做任何转换；NaN、Infinity、负零等一律不合格（10-edge-cases.md 第 4 节）。
 */

/** 一个值的校验 */
export type Check = (val: unknown) => boolean;
/** 通过即可确定类型的校验 */
export type Guard<T> = (val: unknown) => val is T;

/** 是不是 JSON 对象（不是 null，也不是数组） */
export const isRecord = (val: unknown): val is Record<string, unknown> => typeof val === 'object' && val !== null && !Array.isArray(val);

/** 有限整数且在 [lo, hi] 内；小数与负零不合格 */
export const intIn =
  (lo: number, hi: number): Guard<number> =>
  (val): val is number =>
    typeof val === 'number' && Number.isInteger(val) && !Object.is(val, -0) && val >= lo && val <= hi;
/** 数值且在 [lo, hi] 内（可以是小数，如音量）；lo、hi 为有限数，NaN 与无穷比较的结果为假，自然不合格 */
export const numIn =
  (lo: number, hi: number): Guard<number> =>
  (val): val is number =>
    typeof val === 'number' && val >= lo && val <= hi;
/** 取值属于列出的几项（数值按 Object.is 比较，负零不等于零） */
export const oneOf =
  (xs: readonly (string | number)[]): Check =>
  val =>
    xs.some(x => Object.is(x, val));
/** 取值是表中的一个键；表的类型为 Record<联合类型, true>，联合类型新增成员而表中漏写时类型检查不通过 */
export const member =
  <K extends string>(all: Record<K, true>): Guard<K> =>
  (val): val is K =>
    typeof val === 'string' && Object.hasOwn(all, val);
/** 布尔值 */
export const bool: Guard<boolean> = (val): val is boolean => typeof val === 'boolean';
/** 字符串且整体匹配正则（正则须以 ^ 与 $ 限定） */
export const match =
  (re: RegExp): Guard<string> =>
  (val): val is string =>
    typeof val === 'string' && re.test(val);
/** 字符串且长度（UTF-16 码元数）不超过 max */
export const text =
  (max: number): Guard<string> =>
  (val): val is string =>
    typeof val === 'string' && val.length <= max;

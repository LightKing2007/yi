/** 测试中取出必然存在的值（数组的某一项、按键查到的项等）：取不到时抛出说明，使测试在此处失败，而不是在后面报出难懂的错误 */
export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`测试数据中缺少${what}`);
  return value;
}

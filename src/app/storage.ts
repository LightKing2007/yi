/**
 * 本地存储中的 JSON 值（DAT-080 至 DAT-082、VER-012）：每个值带版本号 v；读取时逐字段校验，不合格的字段回退为默认值；
 * 整体解析失败时把原值改存到 `键名.corrupt` 并写 warn 日志；版本高于本程序支持的值只读使用、不写回；读写失败不影响运行。
 */
import { isRecord, type Guard } from '../shared/check';
import { logWarn } from './native';

/** 一个本地存储的 JSON 值：键名、本程序写入的版本、默认值，以及每个字段的校验 */
export interface StoreSpec<T extends object> {
  key: string;
  version: number;
  defaults: T;
  /** 每个字段都必须有校验：类型新增字段而这里漏写时，类型检查不通过 */
  fields: { [K in keyof T]-?: Guard<T[K]> };
}

/** 读取的结果：writable 为 false 时，这个值由更新版本的程序写入，本程序不得写回（VER-012） */
export interface Loaded<T> {
  value: T;
  writable: boolean;
}

/** 写进日志时使用的位置名 */
const WHERE = '本地存储';

/** 本地存储整体损坏：原值改存到 `键名.corrupt`，再使用默认值（DAT-081） */
function setAside(key: string, raw: string, why: string) {
  try {
    localStorage.setItem(`${key}.corrupt`, raw);
    localStorage.removeItem(key);
  } catch {
    // 另存失败（如配额已满）时原值仍留在原处，下次读取还会再试；本次照常使用默认值
  }
  logWarn(WHERE, `${key} ${why}，原值已另存为 ${key}.corrupt，改用默认值`);
}

/** 按规格逐字段取出：合格的字段用存储的值，缺少或不合格的用默认值；返回取出的值与不合格的字段名 */
function pickFields<T extends object>(spec: StoreSpec<T>, obj: Record<string, unknown>) {
  const value = { ...spec.defaults };
  const bad: string[] = [];
  for (const key of Object.keys(spec.fields)) {
    if (!Object.hasOwn(obj, key)) continue;
    const field = key as keyof T, // spec 自己的键名，不是外部输入
      val = obj[key];
    if (spec.fields[field](val)) value[field] = val;
    else bad.push(key);
  }
  return { value, bad };
}

/** 读取并逐字段校验；没有存过（或旧版本存的是 null）时返回默认值 */
export function loadStored<T extends object>(spec: StoreSpec<T>): Loaded<T> {
  const fresh = { value: { ...spec.defaults }, writable: true };
  let raw: string | null;
  try {
    raw = localStorage.getItem(spec.key);
  } catch {
    return fresh; // 隐私模式等读不到时用默认值（DAT-082）
  }
  if (raw === null) return fresh;
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    setAside(spec.key, raw, '不是合法的 JSON');
    return fresh;
  }
  if (obj === null) return fresh;
  const ver = isRecord(obj) ? (Object.hasOwn(obj, 'v') ? obj.v : 0) : undefined; // 没有版本号的是加入版本号之前写入的，算作第 0 版
  if (!isRecord(obj) || typeof ver !== 'number' || !Number.isSafeInteger(ver) || ver < 0) {
    setAside(spec.key, raw, '的结构或版本号不合格');
    return fresh;
  }
  const { value, bad } = pickFields(spec, obj);
  if (bad.length) logWarn(WHERE, `${spec.key} 中不合格的字段改用默认值：${bad.join('、')}`);
  if (ver > spec.version) {
    logWarn(WHERE, `${spec.key} 由更新的版本写入（第 ${ver} 版，本程序支持到第 ${spec.version} 版），只读使用，不写回`);
    return { value, writable: false };
  }
  // 低版本迁移：目前只有第 0 版，字段与第 1 版相同，逐字段校验后即为当前版本；迁移后写回
  if (ver < spec.version || bad.length) saveStored(spec, value);
  return { value, writable: true };
}

/** 写入，带上本程序的版本号；写入失败（隐私模式、配额已满）不影响运行（DAT-082） */
export function saveStored<T extends object>(spec: StoreSpec<T>, value: T) {
  try {
    localStorage.setItem(spec.key, JSON.stringify({ v: spec.version, ...value }));
  } catch {
    // 写不进去时本次修改只在内存中生效，游戏照常运行
  }
}

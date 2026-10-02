/**
 * 界面文字的多语言：文言（默认）、中文、English。
 * 代码里照常写中文（白话）原文，显示时经 T() 换成当前语言；原文本身就是查表的键，
 * 所以服务端发来的中文提示也能在客户端翻译。TF() 按当前语言的格式串排版；文言时数字写成汉字。
 */
import { Lang, settings } from '../app/settings';
import { TABLE } from './table';

const map = new Map<string, [string, string, string]>();
for (const row of TABLE) map.set(row[0], row);

export const lang = () => settings.value.lang;

/** 原文 → 当前语言；表里没有的原样返回 */
export function T(zh: string): string {
  const l = lang();
  if (l === Lang.ZH || !zh) return zh;
  const row = map.get(zh);
  if (!row) {
    if (import.meta.env?.DEV && /[^\x00-\x7f]/.test(zh)) console.warn('[i18n] 缺译文：', zh);
    return zh;
  }
  return l === Lang.WY ? row[1] : row[2];
}

const DIG = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const UNIT = ['', '十', '百', '千', '万'];

/** 整数写成汉字：十九、一百零五、三千二百 */
export function hanInt(n: number): string {
  n = Math.trunc(n);
  let out = '';
  if (n < 0) {
    out = '负';
    n = -n;
  }
  if (n === 0) return out + DIG[0];
  const d: number[] = [];
  for (let m = n; m > 0 && d.length < 6; m = Math.floor(m / 10)) d.push(m % 10);
  let zero = false;
  for (let i = d.length - 1; i >= 0; i--) {
    if (d[i] === 0) {
      zero = true;
      continue;
    }
    if (zero && i < d.length - 1) out += DIG[0];
    zero = false;
    if (!(i === 1 && d[i] === 1 && d.length === 2)) out += DIG[d[i]]; // 十九而非一十九
    out += UNIT[Math.min(i, 4)];
  }
  return out;
}

/** 小数：整数部分 + “又半”或“点几” */
function hanNum(v: number, prec: number) {
  const ip = Math.trunc(v),
    frac = v - ip;
  let out = hanInt(ip);
  if (prec <= 0 || frac < 0.05) return out;
  if (frac > 0.45 && frac < 0.55) return out + '又半';
  return out + '点' + DIG[Math.min(9, Math.round(frac * 10))];
}

/** 按当前语言排版。支持 %d %s %f 及 %.1f 等精度写法 */
export function TF(zhFmt: string, ...args: (string | number)[]): string {
  const fmt = T(zhFmt),
    wy = lang() === Lang.WY;
  let k = 0;
  return fmt.replace(/%(%|(?:\.(\d+))?[dsfiu])/g, (m, conv: string, prec?: string) => {
    if (conv === '%') return '%';
    const v = args[k++];
    const c = m[m.length - 1];
    if (c === 's') return String(v);
    const num = Number(v);
    if (c === 'f') {
      const p = prec !== undefined ? parseInt(prec, 10) : 6;
      return wy ? hanNum(num, p) : num.toFixed(p);
    }
    return wy ? hanInt(num) : String(Math.trunc(num));
  });
}

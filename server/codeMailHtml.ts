/**
 * 验证码邮件的 HTML 版式（数据文件）：一张素净的纸。取官网贝色区块（server/pageStyle.ts 的 .shell）的纸色与墨色、宋体与字距；
 * 顶部居中为墨色“弈”字，正文为标题、说明、线条胶囊框起的验证码与提醒，背景为官网同款的细网格；页脚两行：链接，以及版权与收信说明，
 * 不含备案号与字体许可说明（项目所有者 2026-11-01 的要求）。
 * 邮箱客户端不执行脚本、多数不支持网页字体与 <style>，因此全部样式内联、以表格排版；唯一的图片是随邮件内嵌的“弈”字（cid），
 * 不引用外部图片。文字全部来自 codeMailText.ts 的固定文案与校验过的六位数字，不含任何收件人提供的内容。
 */
import type { CodeMailText } from './codeMailText';

/** 官网贝色区块的色彩 */
const PAPER = '#f3efe7';
const INK = '#141210';
const DIM = '#5f584e';
const FAINT = '#696155';
const LINE = 'rgba(20,18,16,0.12)';
/** 线条胶囊的描边：官网 .pill 在纸色上的对应（墨色 35%） */
const PILL = 'rgba(20,18,16,0.35)';
/** 官网同款的 64px 网格（homeStyle.ts 的 .hero::before），在纸色上改用墨色细线；不支持背景渐变的客户端退为纯纸色 */
const GRID =
  `background-color:${PAPER};background-image:linear-gradient(rgba(20,18,16,0.045) 1px,transparent 1px),` +
  'linear-gradient(90deg,rgba(20,18,16,0.045) 1px,transparent 1px);background-size:64px 64px;background-position:center top';
/** 字体名用单引号：样式写在双引号的 style 属性里 */
const SERIF = "'Songti SC', STSong, 'Noto Serif CJK SC', 'Source Han Serif SC', SimSun, serif";
const SANS = "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Source Han Sans SC', system-ui, sans-serif";
/** “弈”字图的像素宽高 */
const GLYPH_WIDTH = 568;
const GLYPH_HEIGHT = 646;
const GLYPH_RATIO = GLYPH_HEIGHT / GLYPH_WIDTH;
const HEAD_PX = 56;
/** 线条胶囊中的验证码（官网 .pill 的造型，字取宋体） */
const CODE_STYLE =
  `border:1px solid ${PILL};border-radius:999px;padding:16px 30px 16px 40px;` + `font:900 38px/1 ${SERIF};letter-spacing:0.3em;color:${INK};white-space:nowrap`;
/** 正文中的链接 */
const LINK_STYLE = `color:${INK};text-decoration:underline;text-underline-offset:3px`;

/** 墨色“弈”字图；src 为邮件内的 cid 地址或预览用的 data 地址 */
const glyph = (src: string, width: number, center: boolean) =>
  `<img src="${src}" width="${width}" height="${Math.round(width * GLYPH_RATIO)}" alt="弈" ` +
  `style="display:block;border:0;width:${width}px;height:auto${center ? ';margin:0 auto' : ''}">`;

/** 页脚：细线之下两行，第一行为链接，第二行为版权与收信说明 */
function footer(text: CodeMailText): string {
  const links = text.links
    .map(
      ([name, href]) => `<a href="${href}" style="display:inline-block;margin-right:22px;color:${FAINT};text-decoration:none;white-space:nowrap">${name}</a>`,
    )
    .join('');
  return `<div style="margin-top:56px;padding-top:24px;border-top:1px solid ${LINE};font:12px/2 ${SANS};color:${FAINT}">
<p style="margin:0">${links}</p>
<p style="margin:10px 0 0">${text.copyright}${text.lang === 'en-GB' ? ' ' : ''}${text.notice}</p>
</div>`;
}

/** 提醒与求助同一段：中文与文言把提醒句末的句号换成逗号接下去（项目所有者 2026-11-01 的要求），英文仍为两句 */
export const joined = (text: CodeMailText) => (text.lang === 'en-GB' ? `${text.warn} ` : `${text.warn.replace(/。$/, '')}，`);

/** 求助一句，“支持页面”为链接 */
const support = (text: CodeMailText) => `${text.support[0]}<a href="${text.supportUrl}" style="${LINK_STYLE}">${text.support[1]}</a>${text.support[2]}`;

/** 完整的 HTML 文档；image 为墨色“弈”字图的地址。文言也标为 zh-Hans：标记 lzh 会使客户端为标点选用西文字体 */
export function codeHtml(text: CodeMailText, code: string, image: string): string {
  return `<!DOCTYPE html>
<html lang="${text.lang === 'en-GB' ? 'en-GB' : 'zh-Hans'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>${text.title}</title></head>
<body style="margin:0;padding:0;${GRID}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="${GRID}"><tr><td align="center" style="padding:72px 32px 56px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px"><tr><td style="color:${INK}">
<div align="center">${glyph(image, HEAD_PX, true)}</div>
<p style="margin:48px 0 0;font:900 28px/1.3 ${SERIF};letter-spacing:0.12em;color:${INK}">${text.title}</p>
<p style="margin:18px 0 0;font:15px/1.9 ${SANS};color:${DIM}">${text.lead}</p>
<table role="presentation" align="center" cellpadding="0" cellspacing="0" style="margin:32px auto 0"><tr>
<td style="${CODE_STYLE}">${code}</td>
</tr></table>
<p style="margin:32px 0 0;font:14px/1.9 ${SANS};color:${DIM}">${text.ttl}</p>
<p style="margin:6px 0 0;font:14px/1.9 ${SANS};color:${DIM}">${joined(text)}${support(text)}</p>
${footer(text)}
</td></tr></table>
</td></tr></table>
</body></html>`;
}

/**
 * 同一封邮件的纯文本版本：与 HTML 同样的文字与顺序，链接以括号附上地址。放在 multipart/alternative 中，
 * 支持 HTML 的客户端只显示 HTML；缺少纯文本版本会被垃圾邮件过滤器扣分（2026-11-01 实测 iCloud 归入垃圾邮件）
 */
export function codePlain(text: CodeMailText, code: string): string {
  const links = text.links.map(([name, href]) => `${name}：${href}`).join('\n');
  return [
    text.title,
    '',
    text.lead,
    '',
    code,
    '',
    text.ttl,
    `${joined(text)}${text.support[0]}${text.support[1]}（${text.supportUrl}）${text.support[2]}`,
    '',
    links,
    `${text.copyright}${text.lang === 'en-GB' ? ' ' : ''}${text.notice}`,
  ].join('\n');
}

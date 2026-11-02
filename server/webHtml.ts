/** 官网 HTML 的最小安全工具：只转义文本与属性，不拼接可执行代码。 */

/** 转义写入 HTML 文本或双引号属性的文字。 */
export const esc = (text: string) => text.replace(/[&<>"']/g, character => `&#${character.charCodeAt(0)};`);

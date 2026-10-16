/**
 * 开发模式的 CSP（SEC-013）：index.html 中 connect-src 只放行生产服务器的确切地址；
 * Vite 开发服务器为页面另加本机地址，供热更新与本机服务端（?server=ws://127.0.0.1:8443）使用。打包的正式版不经过这里。
 */

/** index.html 中的 connect-src（生产服务器的确切地址） */
export const PROD_CONNECT = "connect-src 'self' wss://yi.lightking.com.cn";
/** 开发模式另加的本机地址 */
export const DEV_EXTRA = 'ws://localhost:* ws://127.0.0.1:*';

/**
 * 在 index.html 的 connect-src 后加上本机地址；找不到生产的 connect-src 时抛出，免得开发模式悄悄用上别的策略
 * @param {string} html
 * @returns {string}
 */
export function devCsp(html) {
  if (!html.includes(`${PROD_CONNECT};`)) throw new Error(`index.html 中没有 “${PROD_CONNECT};”`);
  return html.replace(`${PROD_CONNECT};`, `${PROD_CONNECT} ${DEV_EXTRA};`);
}

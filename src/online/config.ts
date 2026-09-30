/**
 * 在线服务器地址：构建时从环境变量 VITE_YI_SERVER 读取（见 .env.production），没有配置时用下面的默认地址。
 * 本机测试可在地址栏加 ?server=ws://127.0.0.1:7700（见 client.ts 的 serverUrl）。
 * 只给客户端用；服务端不引用这个文件。
 */
export const ONLINE_SERVER: string = import.meta.env.VITE_YI_SERVER || 'ws://47.108.181.240:7700';

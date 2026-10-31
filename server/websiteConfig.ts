/** 官网的独立配置：只接受网站端口和安装包目录，不读取联机配置或数据库。 */
import path from 'node:path';

const DEFAULT_PORT = 8444;
const MAX_PORT = 65535;

/** 官网配置的解析结果；错误为可直接显示的说明。 */
export function parseWebsiteConfig(argv: string[], env: Record<string, string | undefined>, cwd: string) {
  const version = argv.length === 1 && argv[0] === '--version';
  const port = Number(env.YI_WEB_PORT ?? DEFAULT_PORT);
  const errors: string[] = [];
  if (argv.length && !version) errors.push('命令行只接受 --version');
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) errors.push('YI_WEB_PORT 必须为 1 至 65535 的整数');
  if (env.YI_WEB_FILES === '') errors.push('YI_WEB_FILES 不能是空字符串');
  const files = path.resolve(cwd, env.YI_WEB_FILES ?? 'downloads/current');
  return { version, port, files, errors: version ? [] : errors };
}

/** 官网唯一的环境与参数读取入口；不读取联机环境或密钥。 */
export function loadWebsiteConfig() {
  return parseWebsiteConfig(process.argv.slice(2), process.env, process.cwd());
}

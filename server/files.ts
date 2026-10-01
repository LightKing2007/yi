/**
 * 安装包下载：联机端口上的普通网页请求（不是 WebSocket 的）走这里，不用另开端口。
 *   GET /         下载页：列出目录里的安装包
 *   GET /<文件名>  下载这个文件，支持断点续传
 * 目录里只认 Yi-版本-平台 这样命名的文件，其他文件与子目录一概不给。
 * 每个 IP 同时最多 2 个下载、全服最多 8 个，免得下载把带宽占满影响对局。
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const PER_IP = 2, TOTAL = 8;
const NAME = /^Yi-(\d+(?:\.\d+)*)-(mac-arm64|mac-x64|win-x64|linux-x86_64)[\w.-]*\.(dmg|exe|AppImage)$/;
const LABEL: Record<string, string> = {
  'mac-arm64': 'macOS（Apple 芯片）',
  'mac-x64': 'macOS（Intel 芯片）',
  'win-x64': 'Windows',
  'linux-x86_64': 'Linux',
};
const ORDER = ['win-x64', 'mac-arm64', 'mac-x64', 'linux-x86_64'];

interface Pkg { file: string; version: string; platform: string; size: number }

const cmpVer = (a: string, b: string) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** 目录里每个平台最新的安装包 */
function list(dir: string): Pkg[] {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const best = new Map<string, Pkg>();
  for (const file of names) {
    const m = NAME.exec(file);
    if (!m) continue;
    let st: fs.Stats;
    try { st = fs.statSync(path.join(dir, file)); } catch { continue; }
    if (!st.isFile()) continue;
    const p = { file, version: m[1], platform: m[2], size: st.size };
    const old = best.get(p.platform);
    if (!old || cmpVer(p.version, old.version) > 0) best.set(p.platform, p);
  }
  return ORDER.filter(k => best.has(k)).map(k => best.get(k)!);
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`);
const mb = (n: number) => `${(n / 1048576).toFixed(0)} MB`;

function page(pkgs: Pkg[]) {
  const rows = pkgs.map(p => `<li><a href="/${encodeURIComponent(p.file)}">${esc(LABEL[p.platform])}</a><span>${esc(p.version)}　${mb(p.size)}</span></li>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>弈 · 下载</title>
<style>
body{margin:0;background:#f3ead8;color:#2b2118;font:16px/1.7 "PingFang SC","Microsoft YaHei",sans-serif}
main{max-width:560px;margin:0 auto;padding:48px 16px}
h1{font:900 56px/1 "Songti SC","SimSun",serif;margin:0 0 8px}
ul{list-style:none;padding:0;margin:32px 0}
li{display:flex;justify-content:space-between;align-items:baseline;padding:14px 0;border-bottom:1px solid #d8c9aa}
a{color:#8a2b1d;font-size:18px;text-decoration:none}a:hover{text-decoration:underline}
span,p{color:#6b5a46;font-size:14px}
</style></head><body><main><h1>弈</h1><p>“弈”是一款围棋与五子棋游戏，支持人机对弈及联机对战。请根据您的操作系统选择对应的安装程序。</p>
${rows ? `<ul>${rows}</ul>` : '<p>暂无可供下载的安装程序。</p>'}
<p>macOS：首次打开时，请在“访达”中按住 Control 键点按该应用程序并选择“打开”，或前往“系统设置”中的“隐私与安全性”，点按“仍要打开”。</p>
<p>Windows：首次运行时如出现“Windows 已保护你的电脑”提示，请点击“更多信息”，再点击“仍要运行”。</p>
</main></body></html>`;
}

export function fileServer(dir: string) {
  const perIp = new Map<string, number>();
  let total = 0;

  return (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    let name: string;
    try { name = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname.slice(1)); } catch { res.writeHead(400).end(); return; }

    if (name === '') {
      const body = page(list(dir));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }

    const pkg = NAME.test(name) ? list(dir).find(p => p.file === name) : undefined;
    if (!pkg) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('未找到所请求的文件。'); return; }

    // 断点续传：只认 bytes=开始-结束 一段
    let start = 0, end = pkg.size - 1;
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(end, Number(range[2])); }
      else start = Math.max(0, pkg.size - Number(range[2]));
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${pkg.size}` }).end(); return; }
    }
    const head = {
      'Content-Type': 'application/octet-stream',
      'Content-Length': end - start + 1,
      'Content-Disposition': `attachment; filename="${pkg.file}"`,
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${pkg.size}` } : {}),
    };
    if (req.method === 'HEAD') { res.writeHead(range ? 206 : 200, head).end(); return; }

    const ip = req.socket.remoteAddress ?? '';
    if ((perIp.get(ip) ?? 0) >= PER_IP || total >= TOTAL) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30' }).end('当前下载请求过多，请稍后再试。');
      return;
    }
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1); total++;
    let done = false;
    const release = () => {
      if (done) return;
      done = true; total--;
      const n = (perIp.get(ip) ?? 1) - 1;
      if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
    };
    res.on('close', release);
    res.writeHead(range ? 206 : 200, head);
    const stream = fs.createReadStream(path.join(dir, pkg.file), { start, end });
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  };
}

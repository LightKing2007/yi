/**
 * 性能基准（TST-041 至 TST-046，整改项 P2-07）：打包 scripts/bench-entry.ts 后运行，并统计前端产物的压缩体积（TST-044）。
 *   node scripts/bench.mjs              完整运行（约 2 分钟，围棋困难难度每手按规定想满 3 秒）
 *   node scripts/bench.mjs --quick      缩小规模，只用于确认脚本能跑通
 *   node scripts/bench.mjs --json 文件   另把结果写成 JSON
 * 先运行 npm run build:web，才会统计前端产物体积。结果与上一版本比较，劣化超过 20% 时严禁发布（TST-046）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { build } from 'esbuild';
import { pageAssets } from './page-assets.mjs';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const KB = 1024;

/** 完整与快速两种规模 */
const SCALE = {
  full: { gomokuGames: 6, goMoves: 3, connections: 500, rounds: 20, httpRequests: 300 },
  quick: { gomokuGames: 1, goMoves: 1, connections: 50, rounds: 4, httpRequests: 20 },
};

/** 前端产物的 gzip 体积（TST-044：主包 ≤ 150 KB，单个 Worker ≤ 30 KB） */
function bundleSizes() {
  const dir = path.join(root, 'dist/assets');
  if (!fs.existsSync(dir)) return null;
  const out = {};
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.js'))) {
    const data = fs.readFileSync(path.join(dir, file));
    out[file.replace(/-[\w-]{8}\.js$/, '.js')] = { kb: Math.round(data.length / KB), gzipKb: Math.round(zlib.gzipSync(data).length / KB) };
  }
  return out;
}

async function main(argv) {
  const scale = argv.includes('--quick') ? SCALE.quick : SCALE.full;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-bench-build-'));
  try {
    const outfile = path.join(tmp, 'bench.mjs');
    await build({
      entryPoints: [path.join(root, 'scripts/bench-entry.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      outfile,
      logLevel: 'error',
      define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
        __APP_COMMIT__: JSON.stringify('bench'),
        __PAGE_ASSETS__: JSON.stringify(pageAssets(new URL('../', import.meta.url))),
      },
    });
    const { runBench } = await import(outfile);
    const result = {
      version: pkg.version,
      machine: `${os.cpus()[0]?.model ?? '未知'}，${Math.round(os.totalmem() / KB ** 3)} GB，${os.platform()} ${os.release()}，Node ${process.version}`,
      scale,
      ...(await runBench(scale)),
      bundles: bundleSizes(),
    };
    console.log(JSON.stringify(result, null, 2));
    const jsonAt = argv.indexOf('--json');
    if (jsonAt >= 0) fs.writeFileSync(argv[jsonAt + 1], JSON.stringify(result, null, 2) + '\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

await main(process.argv.slice(2));

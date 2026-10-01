/**
 * 发版第一步：npm run release -- 2.0.2
 * 依次检查：在 main 上、没有没提交的改动、和 GitHub 上的 main 一致、版本号比现在的大、这个标签还没有、
 * 更新日志最上面一节就是这个版本且译文齐全、类型检查与测试通过。全部通过后改 package.json 的版本号，
 * 提交 release: v2.0.2，打标签 v2.0.2，推送到 GitHub。推送标签后 GitHub 自动打包并建草稿 Release。
 * 之后的步骤见 docs/procedures/release.md；检查项实现 OPS-021。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { check } from './changelog.mjs';

const version = process.argv[2];
const sh = (cmd, opt = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opt }).trim();
const run = (cmd, env) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
const fail = msg => { console.error(`✗ ${msg}`); process.exit(1); };
const ok = msg => console.log(`✓ ${msg}`);

if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) fail('用法：npm run release -- 版本号，例如 npm run release -- 2.0.2');

const current = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
if (cmp(version, current) <= 0) fail(`新版本号 ${version} 要比现在的 ${current} 大`);
ok(`版本号 ${current} → ${version}`);

if (sh('git rev-parse --abbrev-ref HEAD') !== 'main') fail('发版要在 main 上进行，先 git switch main');
if (sh('git status --porcelain')) fail('还有没提交的改动，先提交或收起来');
sh('git fetch --quiet --tags origin');
if (sh('git rev-parse HEAD') !== sh('git rev-parse origin/main')) fail('本地 main 和 GitHub 上的不一致，先 git pull');
if (sh(`git tag --list v${version}`)) fail(`标签 v${version} 已经有了`);
ok('在 main 上，和 GitHub 一致，没有没提交的改动');

const problems = check(version);
if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); fail('先把更新日志写好（src/ui/info.ts 与 src/i18n/table.ts），走 PR 合并后再发版'); }
ok(`更新日志 ${version} 已写好，译文齐全`);

console.log('… 类型检查与测试');
run('npm run typecheck --silent');
run('npm test --silent');
ok('类型检查与测试通过');

run(`npm version ${version} --no-git-tag-version --silent`);
run('git add package.json package-lock.json');
run(`git commit --quiet -m "release: v${version}"`);
run(`git tag -a v${version} -m "弈 ${version}"`);
run('git push --quiet --atomic origin main v' + version, { YI_RELEASE: '1' });
ok(`已推送 release: v${version} 与标签 v${version}`);

console.log(`
接下来：
  1. GitHub 自动打包，大约五分钟：gh run watch $(gh run list --workflow Release -L 1 --json databaseId -q '.[0].databaseId')
  2. 在网页上看一下草稿 Release，没问题就点发布：gh release view v${version} --web
  3. 上线：npm run deploy -- ${version}`);

/**
 * 发版第一步：npm run release -- 2.0.2；紧急修复在 hotfix/* 分支上：npm run release -- 2.0.3 --hotfix
 * 依次检查：所在分支（main，或紧急修复时的 hotfix/*）、没有没提交的改动、和 GitHub 上的分支一致、版本号比现在的大
 * （紧急修复只允许递增修订号）、这个标签还没有、更新日志最上面一节就是这个版本且译文齐全、CI 在这个提交上已成功、类型检查与测试通过。
 * 全部通过后改 package.json 的版本号，提交 release: v2.0.2，打标签 v2.0.2，推送到 GitHub。推送标签后 GitHub 自动打包并建草稿 Release。
 * 之后的步骤见 docs/procedures/release.md；检查项实现 OPS-021、OPS-025、OPS-028，判定规则在 scripts/release-lib.mjs。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { check } from './changelog.mjs';
import { branchProblem, ciProblem, parseArgs, versionProblem } from './release-lib.mjs';

const sh = (cmd, opt = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...opt }).trim();
const run = (cmd, env) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
const fail = msg => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = msg => console.log(`✓ ${msg}`);
const failIf = problem => {
  if (problem) fail(problem);
};

const args = parseArgs(process.argv.slice(2));
if (!args) fail('用法：npm run release -- 版本号，例如 npm run release -- 2.0.2；紧急修复：npm run release -- 2.0.3 --hotfix');
const { version, hotfix } = args;

const current = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
failIf(versionProblem(current, version, hotfix));
ok(`版本号 ${current} → ${version}${hotfix ? '（紧急修复）' : ''}`);

const branch = sh('git rev-parse --abbrev-ref HEAD');
failIf(branchProblem(branch, hotfix));
if (sh('git status --porcelain')) fail('还有没提交的改动，先提交或收起来');
sh('git fetch --quiet --tags origin');
const head = sh('git rev-parse HEAD');
let remote = '';
try {
  remote = sh(`git rev-parse origin/${branch}`, { stdio: ['ignore', 'pipe', 'ignore'] });
} catch {
  /* 远端还没有这个分支：下面按不一致处理 */
}
if (head !== remote) fail(`本地 ${branch} 和 GitHub 上的不一致，先推送或 git pull`);
if (sh(`git tag --list v${version}`)) fail(`标签 v${version} 已经有了`);
ok(`在 ${branch} 上，和 GitHub 一致，没有没提交的改动`);

const problems = check(version);
if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  fail(`先把更新日志写好（src/ui/info.ts 与 src/i18n/table.ts），${hotfix ? '提交并推送' : '走 PR 合并'}后再发版`);
}
ok(`更新日志 ${version} 已写好，译文齐全`);

// 以 CI 的结论为准（OPS-025）：本机通过不代表 CI 通过
failIf(ciProblem(JSON.parse(sh(`gh run list --workflow ci.yml --commit ${head} --limit 20 --json status,conclusion,url`))));
ok(`CI 在 ${head.slice(0, 7)} 上已成功`);

console.log('… 类型检查与测试');
run('npm run typecheck --silent');
run('npm test --silent');
ok('类型检查与测试通过');

run(`npm version ${version} --no-git-tag-version --silent`);
run('git add package.json package-lock.json');
run(`git commit --quiet -m "release: v${version}"`);
run(`git tag -a v${version} -m "弈 ${version}"`);
run(`git push --quiet --atomic origin ${branch} v${version}`, { YI_RELEASE: '1' });
ok(`已推送 release: v${version} 与标签 v${version}`);

console.log(`
接下来：
  1. GitHub 自动打包，大约五分钟：gh run watch $(gh run list --workflow Release -L 1 --json databaseId -q '.[0].databaseId')
  2. 在网页上看一下草稿 Release，没问题就点发布：gh release view v${version} --web
  3. 上线：npm run deploy -- ${version}${
    hotfix ? `\n  4. 24 小时内开 PR 把 ${branch} 合回 main，保持 main 上版本号与更新日志的连续（OPS-028）：gh pr create --base main --head ${branch}` : ''
  }`);

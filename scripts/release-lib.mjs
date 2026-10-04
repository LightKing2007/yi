/**
 * 发版脚本（scripts/release.mjs）的判定规则，不执行任何命令，便于测试（tests/release.test.ts）：
 * 参数、版本号递增（VER-002；紧急修复只允许递增修订号，OPS-028）、所在分支（OPS-021、OPS-028）、CI 结论（OPS-025）。
 */

/** 解析命令行参数：版本号与 --hotfix；不合法时返回 null */
export function parseArgs(argv) {
  const hotfix = argv.includes('--hotfix');
  const rest = argv.filter(arg => arg !== '--hotfix');
  if (rest.length !== 1 || !/^\d+\.\d+\.\d+$/.test(rest[0])) return null;
  return { version: rest[0], hotfix };
}

/** 比较两个版本号：left 大于 right 时为正数，相等时为 0 */
export function compareVersions(leftVersion, rightVersion) {
  const left = leftVersion.split('.').map(Number),
    right = rightVersion.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}

/** 新版本号是否可以发布；不可以时返回原因 */
export function versionProblem(current, next, hotfix) {
  if (compareVersions(next, current) <= 0) return `新版本号 ${next} 要比现在的 ${current} 大`;
  const [major, minor] = current.split('.');
  if (hotfix && !next.startsWith(`${major}.${minor}.`)) return `紧急修复只允许递增修订号：${current} 之后应为 ${major}.${minor}.x（OPS-028）`;
  return null;
}

/** 所在分支是否可以发版；不可以时返回原因 */
export function branchProblem(branch, hotfix) {
  if (hotfix) return /^hotfix\/[\w.-]+$/.test(branch) ? null : `紧急修复要在 hotfix/* 分支上进行（现在是 ${branch}），见 docs/procedures/release.md 第 7 章`;
  return branch === 'main' ? null : `发版要在 main 上进行（现在是 ${branch}），先 git switch main`;
}

/**
 * CI 在该提交上的结论（OPS-025）。runs 为 `gh run list --workflow ci.yml --commit 提交 --json status,conclusion,url` 的结果，
 * 新的在前。以最近一次运行为准：成功才可以发版；还在运行时等它结束；没有运行时不能发版
 */
export function ciProblem(runs) {
  const latest = runs[0];
  if (!latest) return 'CI 还没有在这个提交上运行过：main 上的提交在合并后自动运行，hotfix/* 分支推送后自动运行';
  if (latest.status !== 'completed') return `CI 还在运行，等它结束后再发版：${latest.url}`;
  if (latest.conclusion !== 'success') return `CI 在这个提交上的结论是 ${latest.conclusion}，不能发版：${latest.url}`;
  return null;
}

/** 发版脚本的判定规则（scripts/release-lib.mjs）：参数、版本号递增与紧急修复（OPS-028）、所在分支（OPS-021）、CI 结论（OPS-025） */
import { describe, expect, it } from 'vitest';
import { branchProblem, ciProblem, compareVersions, parseArgs, versionProblem } from '../scripts/release-lib.mjs';

const URL = 'https://github.com/LightKing2007/yi/actions/runs/1';

describe('参数', () => {
  it('版本号必须是 x.y.z，可以带 --hotfix，位置不限', () => {
    expect(parseArgs(['2.0.5'])).toEqual({ version: '2.0.5', hotfix: false });
    expect(parseArgs(['--hotfix', '2.0.6'])).toEqual({ version: '2.0.6', hotfix: true });
    expect(parseArgs([])).toBeNull();
    expect(parseArgs(['v2.0.5'])).toBeNull();
    expect(parseArgs(['2.0.5', '2.0.6'])).toBeNull();
  });
});

describe('版本号', () => {
  it('按数值逐位比较，不按字符串', () => {
    expect(compareVersions('2.0.10', '2.0.9')).toBeGreaterThan(0);
    expect(compareVersions('2.1.0', '2.0.99')).toBeGreaterThan(0);
    expect(compareVersions('2.0.5', '2.0.5')).toBe(0);
  });

  it('新版本号必须大于现在的版本号', () => {
    expect(versionProblem('2.0.4', '2.0.5', false)).toBeNull();
    expect(versionProblem('2.0.4', '2.1.0', false)).toBeNull();
    expect(versionProblem('2.0.4', '2.0.4', false)).toContain('要比现在的 2.0.4 大');
    expect(versionProblem('2.0.4', '2.0.3', true)).toContain('要比现在的 2.0.4 大');
  });

  it('紧急修复只允许递增修订号', () => {
    expect(versionProblem('2.0.4', '2.0.5', true)).toBeNull();
    expect(versionProblem('2.0.4', '2.1.0', true)).toContain('紧急修复只允许递增修订号');
    expect(versionProblem('2.0.4', '3.0.0', true)).toContain('2.0.x');
  });
});

describe('分支', () => {
  it('常规发版只能在 main 上；紧急修复只能在 hotfix/* 上', () => {
    expect(branchProblem('main', false)).toBeNull();
    expect(branchProblem('feat/x', false)).toContain('发版要在 main 上进行');
    expect(branchProblem('hotfix/2.0.5', true)).toBeNull();
    expect(branchProblem('main', true)).toContain('hotfix/* 分支');
    expect(branchProblem('hotfix/', true)).toContain('hotfix/* 分支');
  });
});

describe('CI 结论', () => {
  it('最近一次运行成功才可以发版', () => {
    expect(ciProblem([{ status: 'completed', conclusion: 'success', url: URL }])).toBeNull();
  });

  it('最近一次运行失败、还在运行或没有运行时不能发版，即使更早的一次成功', () => {
    const passed = { status: 'completed', conclusion: 'success', url: URL };
    expect(ciProblem([{ status: 'completed', conclusion: 'failure', url: URL }, passed])).toContain('结论是 failure');
    expect(ciProblem([{ status: 'in_progress', conclusion: '', url: URL }, passed])).toContain('还在运行');
    expect(ciProblem([])).toContain('还没有在这个提交上运行过');
  });
});

/** release-lib.mjs 的类型声明（供 tests/release.test.ts 引用） */
export declare function parseArgs(argv: string[]): { version: string; hotfix: boolean } | null;
export declare function compareVersions(leftVersion: string, rightVersion: string): number;
export declare function versionProblem(current: string, next: string, hotfix: boolean): string | null;
export declare function branchProblem(branch: string, hotfix: boolean): string | null;
export declare function ciProblem(runs: { status: string; conclusion: string; url: string }[]): string | null;

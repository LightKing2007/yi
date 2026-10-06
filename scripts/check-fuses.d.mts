/** scripts/check-fuses.mjs 的类型声明（供 tests/fuses.test.ts 使用） */
/** 配置项在开关序列中的位置 */
export declare const FUSE_INDEX: Record<string, number>;
/** 从二进制中读出开关序列：各开关的字节值；找不到标记串时抛出 */
export declare function readFuses(binary: Uint8Array): number[];
/** 与配置逐项比对：[配置项, 期望, 实际, 是否相符] */
export declare function compareFuses(config: Record<string, boolean>, fuses: number[]): [string, string, string, boolean][];
/** 含开关序列的二进制：macOS 在 Electron Framework 中，其他平台即可执行文件本身 */
export declare function fuseBinary(app: string): string;

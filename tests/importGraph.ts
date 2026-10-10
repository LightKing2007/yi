/**
 * 源码的引用关系（供 layers.test.ts 检查分层，ARC-010 至 ARC-013）：以 TypeScript 的语法树找出每个文件的四种引用形式——
 * `import … from`、`import '…'`（副作用导入）、`export … from`、动态 `import()`，并解析为仓库中的文件或第三方包。
 * 只有类型的引用（`import type`、全部成员都带 `type` 的导入与导出）在编译后会被删除，不计入依赖（ARC-013）。
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

/** 引用的形式 */
export type RefKind = 'import' | 'side-effect' | 'export' | 'dynamic';

/** 源码中的一处引用；spec 为引用的路径或包名，动态 import() 的参数不是字符串字面量时为 null */
export interface Ref {
  kind: RefKind;
  spec: string | null;
  typeOnly: boolean;
  line: number;
}

/** 导入的绑定是否只有类型：`import type`，或命名导入全部带 `type` 且没有默认导入 */
function importTypeOnly(clause: ts.ImportClause | undefined) {
  if (!clause) return false;
  if (clause.isTypeOnly) return true;
  const named = clause.namedBindings;
  return !clause.name && !!named && ts.isNamedImports(named) && named.elements.length > 0 && named.elements.every(el => el.isTypeOnly);
}

/** 导出是否只有类型：`export type … from`，或命名导出全部带 `type` */
function exportTypeOnly(node: ts.ExportDeclaration) {
  if (node.isTypeOnly) return true;
  const named = node.exportClause;
  return !!named && ts.isNamedExports(named) && named.elements.length > 0 && named.elements.every(el => el.isTypeOnly);
}

/** 字符串字面量的值；不是字符串字面量时为 null */
const literal = (node: ts.Node | undefined) => (node && ts.isStringLiteralLike(node) ? node.text : null);

/** 找出一段源码中的全部引用；fileName 只用来决定是否按 TSX 解析 */
export function refsOf(source: string, fileName: string): Ref[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const refs: Ref[] = [];
  const add = (ref: Omit<Ref, 'line'>, node: ts.Node) => refs.push({ ...ref, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node)) {
      add({ kind: node.importClause ? 'import' : 'side-effect', spec: literal(node.moduleSpecifier), typeOnly: importTypeOnly(node.importClause) }, node);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      add({ kind: 'export', spec: literal(node.moduleSpecifier), typeOnly: exportTypeOnly(node) }, node);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      add({ kind: 'dynamic', spec: literal(node.arguments[0]), typeOnly: false }, node);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add({ kind: 'import', spec: literal(node.moduleReference.expression), typeOnly: node.isTypeOnly }, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return refs;
}

/** 引用的目标：仓库中的文件（相对仓库根目录、以 / 分隔），或第三方包 / Node.js 内置模块的名字；解析不了时为 unresolved */
export type Target = { file: string } | { pkg: string } | { unresolved: string };

/** TypeScript 源文件按这些后缀依次尝试 */
const TS_SUFFIXES = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

/** 包名：`@scope/name/sub` 取 `@scope/name`，`name/sub` 取 `name`，Node.js 内置模块保留 `node:` 前缀 */
export function packageOf(spec: string) {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? spec);
}

/** 解析一处引用：相对路径找仓库中的文件，其余按包名 */
export function resolve(root: string, fromFile: string, spec: string): Target {
  if (!spec.startsWith('.')) return { pkg: packageOf(spec) };
  const base = path.resolve(path.dirname(path.join(root, fromFile)), spec);
  for (const suffix of TS_SUFFIXES) {
    const full = base + suffix;
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return { file: path.relative(root, full).split(path.sep).join('/') };
  }
  return { unresolved: spec };
}

/** 递归列出目录下的 TypeScript 源文件（不含 .d.ts），路径相对仓库根目录 */
export function sourceFiles(root: string, dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(root, rel, out);
    else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(rel);
  }
  return out;
}

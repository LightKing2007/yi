/**
 * 违规棘轮（OPS-015、00-general.md 第 4.3.2 条）：统计 01-coding.md 各规则的违规数与例外声明数，与 docs/audits/baseline.json 比较，任一项增加即失败。
 *   node scripts/ratchet.mjs                    统计并与基线比较；有项目减少时提示更新基线
 *   node scripts/ratchet.mjs --base <文件>       另外检查基线本身没有比 <文件>（CI 中为 main 上的基线）高，防止在 PR 中抬高基线
 *   node scripts/ratchet.mjs --update           把当前计数写入基线；任一项比原基线高时拒绝写入
 * 统计来源：ESLint（eslint.config.js）、jscpd（COD-042），以及 ESLint 无法表达的几项（本文件的 custom 部分）。
 * 违规处带有“例外 COD-xxx：原因”声明（00-general.md 第 4.4 节）的，不计入违规，计入该规则的例外数。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const BASELINE = path.join(root, 'docs/audits/baseline.json');

/** 参与统计的源码：仓库中的这些目录与根目录的配置文件 */
const CODE_DIRS = ['src/', 'server/', 'electron/', 'scripts/', 'tests/'];
const CODE_EXT = /\.(ts|tsx|js|mjs|cjs)$/;
/** COD-030、COD-031、COD-032 只针对产品源码 */
const PRODUCT_DIRS = ['src/', 'server/', 'electron/'];
/** COD-032 不计的数据文件 */
const DATA_FILES = ['src/i18n/table.ts', 'src/render/shaders.ts'];
/** COD-003 不计的文字数据：每条必须占一行，由 scripts/changelog.mjs 逐行读取（与 .prettierignore 一致） */
const LINE_DATA_FILES = ['src/i18n/table.ts', 'src/ui/info.ts'];
/** 不检查文本格式（COD-001）的二进制文件 */
const BINARY_EXT = /\.(png|bmp|ico|icns|jpg|jpeg|gif|webp|woff2?|otf|ttf|dmg|exe)$/i;

const LINE_MAX = 160; // COD-003
const IMPORTS_MAX = 15; // COD-041
const COMMENT_RATIO_MIN = 0.1; // COD-032
const REASON_HAN_MIN = 8; // COD-062、00-general.md 第 4.4.2 条：原因不少于 8 个汉字
const REASON_WORDS_MIN = 4; // 00-general.md 第 4.4.2 条：或不少于 4 个英文单词
const DUP_MIN_LINES = 10; // COD-042
const DUP_MIN_TOKENS = 50; // COD-042

/** ESLint 规则 → 对应的 COD 规则编号（用于识别例外声明；no-restricted-syntax 按消息中的编号） */
const RULE_COD = {
  'max-lines-per-function': ['COD-037'],
  complexity: ['COD-038'],
  'max-depth': ['COD-039'],
  'max-params': ['COD-039'],
  'max-lines': ['COD-040'],
  'id-length': ['COD-024'],
  'no-var': ['COD-056'],
  'prefer-const': ['COD-056'],
  eqeqeq: ['COD-057'],
  'no-eval': ['COD-060'],
  'no-implied-eval': ['COD-060'],
  'no-new-func': ['COD-060'],
  'no-empty': ['COD-062'],
  'no-console': ['COD-064'],
  '@typescript-eslint/no-floating-promises': ['COD-061'],
  '@typescript-eslint/only-throw-error': ['COD-063'],
  '@typescript-eslint/no-explicit-any': ['COD-051'],
  '@typescript-eslint/no-non-null-assertion': ['COD-052'],
  '@typescript-eslint/no-magic-numbers': ['COD-065'],
  '@typescript-eslint/ban-ts-comment': ['COD-054'],
  '@typescript-eslint/naming-convention': ['COD-013', 'COD-014', 'COD-015'],
};

const EXCEPTION = /例外 (COD-\d{3})[：:]\s*(.*)$/;
/** 字节顺序标记（COD-001 要求文件不带它） */
const BOM = '\u{FEFF}';

/** 原因是否够长：不少于 8 个汉字，或不少于 4 个英文单词 */
export function reasonLongEnough(reason) {
  const han = (reason.match(/\p{Script=Han}/gu) ?? []).length;
  const words = (reason.match(/[A-Za-z]+/g) ?? []).length;
  return han >= REASON_HAN_MIN || words >= REASON_WORDS_MIN;
}

/** 第 lineNo 行（从 1 起）或其上一行声明了 cods 之一的例外时，返回该规则编号 */
export function declaredException(lines, lineNo, cods) {
  for (const line of [lines[lineNo - 1], lines[lineNo - 2]]) {
    const found = line && EXCEPTION.exec(line);
    if (found && cods.includes(found[1])) return found[1];
  }
  return null;
}

/** 解析源码；同一份文本只解析一次 */
const parsed = new Map();
function parse(fileName, text) {
  const key = fileName + '\0' + text;
  if (!parsed.has(key)) parsed.set(key, ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true));
  return parsed.get(key);
}

/** 语法树的叶子（词法记号），按先后顺序 */
function tokens(source) {
  const out = [];
  const walk = node => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return; // 文档注释也挂在语法树上，不是代码
    const children = node.getChildren(source);
    if (!children.length && node.end > node.getStart(source)) out.push(node); // 空的列表、文件结束符等零宽度节点不算
    for (const child of children) walk(child);
  };
  walk(source);
  return out;
}

/**
 * 源码中的全部注释：[{ text, line }]，line 从 0 起。按语法树取每个记号前后的注释，
 * 不会把字符串、正则表达式里形似注释的内容算进来
 */
export function comments(fileName, text) {
  const source = parse(fileName, text);
  const seen = new Map();
  const add = ranges => {
    for (const range of ranges ?? []) seen.set(range.pos, range);
  };
  for (const token of tokens(source)) {
    add(ts.getLeadingCommentRanges(text, token.pos));
    add(ts.getTrailingCommentRanges(text, token.end));
  }
  add(ts.getLeadingCommentRanges(text, source.endOfFileToken.pos));
  return [...seen.values()]
    .sort((one, two) => one.pos - two.pos)
    .map(range => ({
      text: text.slice(range.pos, range.end),
      line: source.getLineAndCharacterOfPosition(range.pos).line,
      end: source.getLineAndCharacterOfPosition(range.end).line,
    }));
}

/** 统计源码中的例外声明：{ 规则编号: 次数 }，以及原因不合格的声明数（00-general.md 第 4.4.2 条） */
export function countExceptions(files) {
  const byRule = {};
  let malformed = 0;
  for (const [file, text] of files) {
    for (const comment of comments(file, text)) {
      const found = EXCEPTION.exec(comment.text);
      if (!found) continue;
      byRule[found[1]] = (byRule[found[1]] ?? 0) + 1;
      if (!reasonLongEnough(found[2])) malformed++;
    }
  }
  return { byRule, malformed };
}

/** COD-001：带 BOM、含 CR、末尾没有换行或有多个换行 */
export function badTextFormat(text) {
  return text.startsWith(BOM) || text.includes('\r') || (text.length > 0 && (!text.endsWith('\n') || text.endsWith('\n\n')));
}

/** COD-003 是否统计这个文件：按行解析的文字数据除外 */
export const limitsLineLength = file => !LINE_DATA_FILES.includes(file);

/** COD-003：超过 160 个字符的行数（按 Unicode 码点计） */
export const longLines = text => text.split('\n').filter(line => [...line].length > LINE_MAX).length;

/** COD-030：第一行（跳过 #! 行）是不是模块说明注释 */
export const hasModuleComment = text => /^(#![^\n]*\n)?\s*(\/\*\*|\/\/|\/\*)/.test(text);

/** COD-035：不带 Issue 编号的待办注释数 */
export function badTodos(text, fileName) {
  let n = 0;
  for (const comment of comments(fileName, text)) {
    for (const todo of comment.text.matchAll(/\b(TODO|FIXME|XXX|HACK)\b(\(#\d+\):)?/g)) if (todo[1] !== 'TODO' || !todo[2]) n++;
  }
  return n;
}

/** COD-041：import 语句数 */
export const importCount = text => (text.match(/^import\s/gm) ?? []).length;

/** COD-062：不含语句、只有注释且原因不足 8 个汉字的 catch 块数（完全为空的由 ESLint 的 no-empty 统计） */
export function shortCatchReasons(text, fileName) {
  const source = parse(fileName, text);
  let n = 0;
  const visit = node => {
    if (ts.isCatchClause(node) && !node.block.statements.length) {
      const inside = text.slice(node.block.getStart(source) + 1, node.block.end - 1).trim();
      if (inside && !reasonLongEnough(inside)) n++;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return n;
}

/** COD-031：没有 TSDoc 文档注释（以斜杠加两个星号开头）的顶层导出声明数 */
export function undocumentedExports(fileName, text) {
  const source = parse(fileName, text);
  let n = 0;
  for (const statement of source.statements) {
    const exported = ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(mod => mod.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    const comments = ts.getLeadingCommentRanges(text, statement.pos) ?? [];
    if (!comments.some(range => text.startsWith('/**', range.pos))) n++;
  }
  return n;
}

/** COD-032：注释行数与代码行数（同一行既有代码又有注释时，注释按 0.5 行计） */
export function commentLines(fileName, text) {
  const source = parse(fileName, text);
  const lineOf = pos => source.getLineAndCharacterOfPosition(pos).line;
  const codeLines = new Set(),
    commentOnly = new Set();
  for (const token of tokens(source)) for (let line = lineOf(token.getStart(source)); line <= lineOf(token.end); line++) codeLines.add(line);
  for (const comment of comments(fileName, text)) for (let line = comment.line; line <= comment.end; line++) commentOnly.add(line);
  const trailing = [...commentOnly].filter(line => codeLines.has(line)).length;
  return { comment: commentOnly.size - trailing + trailing / 2, code: codeLines.size };
}

/** 产品源码中注释率低于 10% 的目录（src 下按子目录分，COD-032） */
export function lowCommentDirs(files) {
  const totals = new Map();
  for (const [file, text] of files) {
    if (!PRODUCT_DIRS.some(dir => file.startsWith(dir)) || DATA_FILES.includes(file)) continue;
    const parts = file.split('/');
    const dir = parts[0] === 'src' && parts.length > 2 ? `src/${parts[1]}` : parts[0];
    const counted = commentLines(file, text),
      sofar = totals.get(dir) ?? { comment: 0, code: 0 };
    totals.set(dir, { comment: sofar.comment + counted.comment, code: sofar.code + counted.code });
  }
  return [...totals]
    .filter(([, total]) => total.comment / (total.comment + total.code) < COMMENT_RATIO_MIN)
    .map(([dir]) => dir)
    .sort();
}

/** 仓库中受版本控制的文件，以及尚未提交、未被忽略的新文件 */
function trackedFiles() {
  return execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
}

/** ESLint 各规则的违规数；带例外声明的不计入 */
async function eslintCounts(read) {
  const { ESLint } = await import('eslint');
  const results = await new ESLint({ cwd: root }).lintFiles(['.']);
  const counts = {};
  for (const result of results) {
    const lines = read(path.relative(root, result.filePath)).split('\n');
    for (const msg of result.messages) {
      const rule = msg.ruleId ?? 'eslint:parse-error';
      const cods = rule === 'no-restricted-syntax' ? (msg.message.match(/COD-\d{3}/g) ?? []) : (RULE_COD[rule] ?? []);
      if (cods.length && declaredException(lines, msg.line, cods)) continue;
      counts[rule] = (counts[rule] ?? 0) + 1;
    }
  }
  return counts;
}

/** jscpd 找到的重复代码块数（COD-042）；报告写在系统临时目录，用完即删 */
function duplicateBlocks() {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'yi-jscpd-'));
  try {
    const bin = path.join(root, 'node_modules/.bin/jscpd');
    const dirs = CODE_DIRS.map(dir => dir.slice(0, -1));
    execFileSync(bin, [...dirs, '-k', String(DUP_MIN_TOKENS), '-l', String(DUP_MIN_LINES), '-r', 'json,silent', '-o', out], { cwd: root, stdio: 'ignore' });
    return JSON.parse(fs.readFileSync(path.join(out, 'jscpd-report.json'), 'utf8')).statistics.total.clones;
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
}

/** 文件内容的读取（同一文件只读一次） */
function reader() {
  const cache = new Map();
  return file => {
    if (!cache.has(file)) cache.set(file, fs.readFileSync(path.join(root, file), 'utf8'));
    return cache.get(file);
  };
}

/** 统计全部度量：{ 度量名: 违规数 }，按名称排序 */
export async function measure() {
  const read = reader();
  const textFiles = trackedFiles().filter(file => !BINARY_EXT.test(file) && fs.existsSync(path.join(root, file)));
  const isCode = file => CODE_EXT.test(file) && (CODE_DIRS.some(dir => file.startsWith(dir)) || !file.includes('/'));
  const code = textFiles.filter(isCode).map(file => [file, read(file)]);
  const product = code.filter(([file]) => PRODUCT_DIRS.some(dir => file.startsWith(dir)) && !file.endsWith('.d.ts'));
  const sum = (files, count) => files.reduce((total, [file, text]) => total + count(text, file), 0);
  const metrics = {
    'COD-001 文本格式不合规的文件': textFiles.filter(file => badTextFormat(read(file))).length,
    'COD-003 超过 160 字符的行': sum(
      code.filter(([file]) => limitsLineLength(file)),
      longLines,
    ),
    'COD-030 缺少模块说明注释的源文件': product.filter(([, text]) => !hasModuleComment(text)).length,
    'COD-031 缺少文档注释的导出声明': sum(product, (text, file) => undocumentedExports(file, text)),
    'COD-032 注释率低于 10% 的目录': lowCommentDirs(code).length,
    'COD-035 不带 Issue 编号的待办注释': sum(code, badTodos),
    'COD-041 import 超过 15 条的文件': code.filter(([, text]) => importCount(text) > IMPORTS_MAX).length,
    'COD-042 重复代码块': duplicateBlocks(),
    'COD-062 原因不足 8 个汉字的 catch 注释': sum(code, shortCatchReasons),
  };
  for (const [rule, n] of Object.entries(await eslintCounts(read))) metrics[`ESLint ${rule}`] = n;
  const exceptions = countExceptions(code);
  metrics['GEN 原因不合格的例外声明'] = exceptions.malformed;
  for (const [rule, n] of Object.entries(exceptions.byRule)) metrics[`例外 ${rule}`] = n;
  return Object.fromEntries(Object.entries(metrics).sort(([one], [two]) => one.localeCompare(two)));
}

/** 比较两份计数：返回增加了的项与减少了的项，每项为 [度量名, 旧值, 新值]；一方没有的项按 0 计 */
export function compare(before, after) {
  const up = [],
    down = [];
  for (const name of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const old = before[name] ?? 0,
      now = after[name] ?? 0;
    if (now > old) up.push([name, old, now]);
    else if (now < old) down.push([name, old, now]);
  }
  return { up, down };
}

const readBaseline = file => JSON.parse(fs.readFileSync(file, 'utf8')).metrics;
const show = ([name, old, now]) => `${name}：${old} → ${now}`;

/** --update：把当前计数写入基线；任一项比原基线高时拒绝 */
function updateBaseline(baseline, now) {
  const { up } = baseline ? compare(baseline, now) : { up: [] };
  if (up.length) {
    for (const item of up) console.error(`  ${show(item)}`);
    console.error('以上项目比原基线高，严禁以更新基线的方式放过新增违规（00-general.md 第 4.3.2 条）');
    return 1;
  }
  const doc = { note: '违规基线（OPS-015）：由 node scripts/ratchet.mjs --update 生成，只允许减少', metrics: now };
  fs.writeFileSync(BASELINE, JSON.stringify(doc, null, 2) + '\n');
  console.log(`已写入 ${path.relative(root, BASELINE)}，共 ${Object.keys(now).length} 项`);
  return 0;
}

/** 检查：当前计数不超过基线；给了 base 时，基线本身也不得高于 base */
function check(baseline, now, base) {
  const raised = base ? compare(base, baseline).up : [];
  for (const item of raised) console.error(`基线被抬高：${show(item)}`);
  const { up, down } = compare(baseline, now);
  for (const item of up) console.error(`违规增加：${show(item)}`);
  for (const item of down) console.log(`违规减少：${show(item)}`);
  const failed = raised.length > 0 || up.length > 0;
  if (down.length && !failed) console.log('请运行 node scripts/ratchet.mjs --update 更新基线，把减少的部分固定下来');
  if (!failed) console.log(`违规棘轮通过：${Object.keys(now).length} 项均未超过基线`);
  return failed ? 1 : 0;
}

async function main(argv) {
  const now = await measure();
  const baseline = fs.existsSync(BASELINE) ? readBaseline(BASELINE) : null;
  if (argv.includes('--update')) return updateBaseline(baseline, now);
  if (!baseline) {
    console.error('没有基线文件，请先运行 node scripts/ratchet.mjs --update');
    return 1;
  }
  const baseAt = argv.indexOf('--base');
  return check(baseline, now, baseAt >= 0 ? readBaseline(argv[baseAt + 1]) : null);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) process.exitCode = await main(process.argv.slice(2));

/**
 * ESLint 配置：把 docs/standards/01-coding.md 中能自动检查的规则逐条映射为 ESLint 规则，每条注明规则编号（DOC-010）。
 * 存量违规不在此处豁免，由 scripts/ratchet.mjs 计数并与 docs/audits/baseline.json 比较（棘轮，OPS-015）。
 * 01-coding.md 中 ESLint 无法表达的规则（COD-001、COD-003、COD-030、COD-031、COD-032、COD-035、COD-041、COD-042、COD-062 的原因长度）由 ratchet.mjs 另行统计。
 */
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** 魔法数字的例外（COD-065）：0、1、-1 与倍数或除数 2 */
const ALLOWED_NUMBERS = [0, 1, -1, 2];
/** 单字母标识符的白名单（COD-024）：循环计数、坐标与领域缩写；`_` 用于有意不用的参数 */
const SHORT_NAMES = ['i', 'j', 'k', 'n', 'x', 'y', 'z', 'g', 'r', 'p', 'm', 'b', 'st', '_'];
/** Node.js 脚本中用到的全局量（TypeScript 文件由类型检查负责，不需要列出） */
const NODE_GLOBALS = [
  'process',
  'console',
  'URL',
  'Buffer',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'fetch',
  'require',
  '__dirname',
  'TextDecoder',
  'WebSocket',
];
/** 允许使用 console 的位置（COD-064） */
const CONSOLE_ALLOWED = ['scripts/**', 'src/app/scenarios.ts', 'server/log.ts'];

// 例外 COD-055：ESLint 只读取配置文件的默认导出
export default tseslint.config(
  { ignores: ['dist/', 'dist-electron/', 'dist-server/', 'release/', 'node_modules/', '.shots/', 'smoke*/', 'trailer/', '.cache/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error', // COD-061
      '@typescript-eslint/only-throw-error': 'error', // COD-063
      '@typescript-eslint/no-explicit-any': 'error', // COD-051
      '@typescript-eslint/no-non-null-assertion': 'error', // COD-052（只计数，是否附说明由人工审查）
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: ALLOWED_NUMBERS,
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ], // COD-065
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true }], // COD-054
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'variable', filter: { regex: '^__[A-Z_]+__$', match: true }, format: null }, // 构建时注入的常量（vite-env.d.ts）
        { selector: 'typeLike', format: ['PascalCase'] }, // COD-013
        { selector: 'variable', modifiers: ['const', 'global'], format: ['camelCase', 'UPPER_CASE', 'PascalCase'] }, // COD-014、COD-015；PascalCase 用于组件
        { selector: ['function', 'parameter', 'method'], format: ['camelCase', 'PascalCase'], leadingUnderscore: 'allow' }, // COD-014；PascalCase 用于组件
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      complexity: ['error', 15], // COD-038（协议消息分发函数允许 30，以例外声明处理）
      'max-depth': ['error', 4], // COD-039
      'max-params': ['error', 4], // COD-039
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }], // COD-037
      'max-lines': ['error', { max: 400 }], // COD-040
      'id-length': ['error', { min: 2, exceptions: SHORT_NAMES, properties: 'never' }], // COD-024
      'no-var': 'error', // COD-056
      'prefer-const': 'error', // COD-056
      eqeqeq: ['error', 'always', { null: 'ignore' }], // COD-057
      'no-eval': 'error', // COD-060
      'no-implied-eval': 'error', // COD-060
      'no-new-func': 'error', // COD-060
      'no-empty': ['error', { allowEmptyCatch: false }], // COD-062（catch 内只有注释时不算空，原因长度由 ratchet.mjs 检查）
      'no-console': 'error', // COD-064
      '@typescript-eslint/no-unused-expressions': ['error', { allowTernary: true, allowShortCircuit: true }],
      'no-restricted-syntax': [
        'error',
        { selector: 'ExportDefaultDeclaration', message: '严禁 export default，统一使用具名导出（COD-055）' },
        { selector: "ExportNamedDeclaration > VariableDeclaration[kind='let']", message: '严禁导出可变绑定（COD-058）' },
        { selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML)$/]', message: '严禁 innerHTML、outerHTML（COD-060）' },
        { selector: "CallExpression[callee.object.name='document'][callee.property.name='write']", message: '严禁 document.write（COD-060）' },
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: '严禁 dangerouslySetInnerHTML（COD-060）' },
      ],
    },
  },
  {
    // 数据文件（译文表、着色器源码）的行数上限为 1000（COD-040）
    files: ['src/i18n/table.ts', 'src/render/shaders.ts'],
    rules: { 'max-lines': ['error', { max: 1000 }] },
  },
  {
    // @ts-expect-error 只允许在 tests/ 中使用，并必须附原因（COD-054）。
    // 测试断言中的期望值不是 COD-065 所指的时间、上限、阈值等常量，不检查魔法数字
    files: ['tests/**'],
    rules: {
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': 'allow-with-description', 'ts-ignore': true, 'ts-nocheck': true }],
      '@typescript-eslint/no-magic-numbers': 'off',
    },
  },
  {
    files: CONSOLE_ALLOWED,
    rules: { 'no-console': 'off' },
  },
  {
    // 界面组件以单独读取 signal.value 的写法订阅重绘，不是遗漏的表达式
    files: ['src/ui/**'],
    rules: { '@typescript-eslint/no-unused-expressions': 'off' },
  },
  {
    // CommonJS 脚本（Electron 直接运行的 shots.cjs）只能用 require
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // 脚本与配置在 Node.js 中运行；浏览器全局量另见 tsconfig 的 lib
    files: ['scripts/**', '*.config.*'],
    languageOptions: {
      globals: Object.fromEntries(NODE_GLOBALS.map(g => [g, 'readonly'])),
    },
  },
);

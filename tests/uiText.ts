/**
 * 源码中的中文（供 i18n.test.ts 检查 I18N-010）：以 TypeScript 的语法树找出含汉字的字符串字面量、模板字符串与 JSX 文本，注释不计。
 * 日志与异常只给维护者看，不显示在界面上，不必翻译：位于日志函数、`Error` 一类构造的参数中，或位于 `throw` 语句中的，标为诊断信息；
 * 参数中的函数（回调）另起作用域，其中的文字不随外层调用算作诊断信息。
 */
import ts from 'typescript';

/** 一处含汉字的文字 */
export interface HanText {
  /** 字符串字面量与 JSX 文本为其值；含插值的模板字符串为源码原文（含反引号） */
  text: string;
  line: number;
  /** 含插值的模板字符串：内容在运行时才确定，无法作为译文表的键 */
  template: boolean;
  /** 日志、异常等诊断信息 */
  diagnostic: boolean;
}

/** 汉字：CJK 统一表意文字基本区 */
export const HAN = /[一-鿿]/;

/** 只写进日志或异常、不显示在界面上的调用：日志函数、`Promise.reject`，以及名字以 Error 结尾的函数或构造 */
const DIAGNOSTIC_CALLEE = /^(?:logError|logWarn|log|this\.log|opt\.log|console\.\w+|Promise\.reject|\w*Error)$/;

/** node 是否位于诊断信息中：向上找到的第一个调用是日志或异常，或者在 throw 语句中；遇到函数即停止 */
function inDiagnostic(node: ts.Node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isThrowStatement(p)) return true;
    if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && DIAGNOSTIC_CALLEE.test(p.expression.getText())) return true;
    if (ts.isFunctionLike(p)) return false;
  }
  return false;
}

/** 找出一段源码中全部含汉字的文字；fileName 只用来决定是否按 TSX 解析 */
export function hanTextsOf(source: string, fileName: string): HanText[] {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out: HanText[] = [];
  const add = (node: ts.Node, text: string, template: boolean) =>
    out.push({ text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, template, diagnostic: inDiagnostic(node) });
  const visit = (node: ts.Node) => {
    if (ts.isTemplateExpression(node)) {
      // 汉字在模板的固定部分时报告整个模板；插值中的字面量（如 `${T('棋手')}`）照常逐一检查
      const fixed = node.head.text + node.templateSpans.map(span => span.literal.text).join('');
      if (HAN.test(fixed)) add(node, node.getText(sf), true);
    } else if (ts.isStringLiteralLike(node) && HAN.test(node.text)) add(node, node.text, false);
    else if (ts.isJsxText(node) && HAN.test(node.text)) add(node, node.text.trim(), false); // JSX 文本两端的换行与缩进不显示
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

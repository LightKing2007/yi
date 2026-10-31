/** 文书渲染：正文目录与标记结构一致，原始 HTML 和非白名单链接不能成为可执行内容。 */
import { expect, it } from 'vitest';
import { legalMarkdown } from '../server/legalMarkdown';

it('文书标题生成唯一目录锚点，保留段落、加粗、两类列表及站内链接', () => {
  const source = [
    '## 同名标题\r\n\r\n首段**重要约定**。',
    '### 子条款',
    '- 第一项。\n- 第二项。',
    '1. 第一项。\n2. 第二项。',
    '## 同名标题',
    '参见[隐私政策](/privacy-policy)。',
  ].join('\n\n');
  const result = legalMarkdown(source);
  expect(result.headings).toEqual([
    { id: 'section-1', text: '同名标题', level: 2 },
    { id: 'section-2', text: '子条款', level: 3 },
    { id: 'section-3', text: '同名标题', level: 2 },
  ]);
  expect(result.html).toContain('<h3 id="section-2">子条款</h3>');
  expect(result.html).toContain('<p>首段<strong>重要约定</strong>。</p>');
  expect(result.html).toContain('<ul><li>第一项。</li><li>第二项。</li></ul>');
  expect(result.html).toContain('<ol><li>第一项。</li><li>第二项。</li></ol>');
  expect(result.html).toContain('<a href="/privacy-policy">隐私政策</a>');
  expect(legalMarkdown('\r\n\n')).toEqual({ html: '', headings: [] });
});

it('不执行文书中的原始 HTML、危险链接与未闭合标记，只开放固定文书和反馈地址', () => {
  const source = [
    '<img src=x onerror="alert(1)"> **<script>alert(1)</script>**',
    '[危险](javascript:alert(1)) [外站](https://example.com) [伪装](/privacy-policy?next=x)',
    '[反馈](https://github.com/LightKing2007/yi/issues)',
    '**未闭合',
  ].join('\n\n');
  const result = legalMarkdown(source);
  expect(result.html).not.toContain('<img');
  expect(result.html).not.toContain('<script');
  expect(result.html).toContain('&#60;img');
  expect(result.html).not.toContain('href="javascript:');
  expect(result.html).not.toContain('href="https://example.com');
  expect(result.html).not.toContain('href="/privacy-policy?next=x');
  expect(result.html).toContain('<a href="https://github.com/LightKing2007/yi/issues">反馈</a>');
  expect(result.html).toContain('<p>**未闭合</p>');
});

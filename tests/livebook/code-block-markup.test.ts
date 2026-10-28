import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CodeBlockView } from '@/components/livebook/CodeBlockView';
import { CodeExampleBlock } from '@/types/domain';

const block: CodeExampleBlock = {
  id: 'code_1',
  type: 'code_example',
  language: 'TypeScript',
  code: 'const a = 1;\n\nconsole.log(a);',
  highlightLines: [3],
};

const render = () => renderToStaticMarkup(createElement(CodeBlockView, { block }));

describe('Stage 6.1: CodeBlockView markup', () => {
  it('renders valid <pre><code> markup with no table elements (hydration regression)', () => {
    const html = render();
    expect(html).toMatch(/<pre[^>]*><code[^>]*>/);
    expect(html).not.toMatch(/<(table|tbody|tr|td)\b/);
  });

  it('renders every line, including blank ones, in order', () => {
    const html = render();
    expect(html.match(/data-line="/g)).toHaveLength(3);
    const text = html.replace(/<[^>]+>/g, '');
    expect(text.indexOf('const a = 1;')).toBeLessThan(text.indexOf('console.log(a);'));
  });

  it('hides line numbers from assistive technology and marks highlighted lines', () => {
    const html = render();
    expect(html.match(/aria-hidden="true"[^>]*>\d+</g)).toHaveLength(3);
    expect(html).toMatch(/data-line="3" data-highlighted="true"/);
    expect(html).not.toMatch(/data-line="1" data-highlighted/);
  });
});

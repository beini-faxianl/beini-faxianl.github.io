/**
 * rehype 插件：用 Shiki 高亮代码块（亮/暗双主题，CSS 变量切换）。
 *
 * 代码块 meta 支持：
 *   ```ts title="app.ts" showLineNumbers {2,4-6} /word/
 *   以及注释标记：// [!code ++] [!code --] [!code highlight] [!code focus] [!code error] [!code warning] [!code word:xxx]
 */
import { createHighlighter, bundledLanguages, type Highlighter } from 'shiki';
import {
  transformerMetaHighlight,
  transformerMetaWordHighlight,
  transformerNotationDiff,
  transformerNotationErrorLevel,
  transformerNotationFocus,
  transformerNotationHighlight,
  transformerNotationWordHighlight,
} from '@shikijs/transformers';
import type { Element, ElementContent, Root } from 'hast';
import { visit, SKIP } from 'unist-util-visit';
import { toString } from 'hast-util-to-string';
import { fromHtml } from 'hast-util-from-html';
import { siteConfig } from '../../../site.config';
import { icon } from '../icons';

const { lightTheme, darkTheme, collapseLines } = siteConfig.code;

let highlighter: Promise<Highlighter> | undefined;
function getHighlighter() {
  highlighter ??= createHighlighter({ themes: [lightTheme, darkTheme], langs: [] });
  return highlighter;
}

const ALIASES: Record<string, string> = {
  'c++': 'cpp',
  'c#': 'csharp',
  'f#': 'fsharp',
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
  console: 'shellsession',
  ps: 'powershell',
  ps1: 'powershell',
  yml: 'yaml',
  md: 'markdown',
  golang: 'go',
  dockerfile: 'docker',
  plaintext: 'text',
  plain: 'text',
  txt: 'text',
  '': 'text',
};

const LANG_LABELS: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript', ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX', jsx: 'JSX',
  py: 'Python', python: 'Python', rs: 'Rust', rust: 'Rust', go: 'Go', java: 'Java', kotlin: 'Kotlin', swift: 'Swift',
  c: 'C', cpp: 'C++', 'c++': 'C++', csharp: 'C#', 'c#': 'C#', rb: 'Ruby', ruby: 'Ruby', php: 'PHP', sql: 'SQL',
  html: 'HTML', css: 'CSS', scss: 'SCSS', json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML',
  bash: 'Bash', sh: 'Shell', shell: 'Shell', zsh: 'Zsh', powershell: 'PowerShell', ps1: 'PowerShell',
  md: 'Markdown', markdown: 'Markdown', vue: 'Vue', svelte: 'Svelte', astro: 'Astro', lua: 'Lua', r: 'R',
  dart: 'Dart', scala: 'Scala', haskell: 'Haskell', elixir: 'Elixir', dockerfile: 'Dockerfile', docker: 'Dockerfile',
  diff: 'Diff', graphql: 'GraphQL', nginx: 'Nginx', ini: 'INI', text: 'Text', txt: 'Text', latex: 'LaTeX', tex: 'TeX',
};

const transformers = [
  transformerNotationDiff({ matchAlgorithm: 'v3' }),
  transformerNotationHighlight({ matchAlgorithm: 'v3' }),
  transformerNotationFocus({ matchAlgorithm: 'v3' }),
  transformerNotationErrorLevel({ matchAlgorithm: 'v3' }),
  transformerNotationWordHighlight({ matchAlgorithm: 'v3' }),
  transformerMetaHighlight(),
  transformerMetaWordHighlight(),
];

function svg(name: Parameters<typeof icon>[0], size = 16): ElementContent[] {
  return fromHtml(icon(name, size), { fragment: true }).children as ElementContent[];
}

function parseTitle(meta: string): string {
  const m = meta.match(/(?:title|filename|file)\s*[=:]\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
}

export default function rehypeCode() {
  return async (tree: Root) => {
    const targets: { node: Element; code: Element; index: number; parent: Element | Root }[] = [];
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || !parent || index == null) return;
      const code = node.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
      if (!code) return;
      targets.push({ node, code, index, parent: parent as Element | Root });
      return SKIP;
    });
    if (!targets.length) return;

    for (const { code, index, parent } of targets) {
      const classes = ((code.properties?.className as string[]) ?? []).map(String);
      const langClass = classes.find((c) => c.startsWith('language-'));
      const rawLang = langClass ? langClass.slice(9).toLowerCase() : '';
      if (rawLang === 'math') continue; // 交给 rehype-katex
      const meta = String((code.data as { meta?: string } | undefined)?.meta ?? '');
      const source = toString(code).replace(/\n$/, '');

      if (rawLang === 'mermaid') {
        parent.children[index] = {
          type: 'element',
          tagName: 'div',
          properties: { className: ['mermaid-block'] },
          children: [{ type: 'element', tagName: 'pre', properties: { className: ['mermaid'] }, children: [{ type: 'text', value: source }] }],
        };
        continue;
      }

      const hl = await getHighlighter();
      let lang = ALIASES[rawLang] ?? rawLang;
      if (lang !== 'text' && lang !== 'ansi' && !(lang in bundledLanguages)) lang = 'text';
      if (lang !== 'text' && lang !== 'ansi' && !hl.getLoadedLanguages().includes(lang)) {
        try {
          await hl.loadLanguage(lang as keyof typeof bundledLanguages);
        } catch {
          lang = 'text';
        }
      }

      const out = hl.codeToHast(source, {
        lang,
        themes: { light: lightTheme, dark: darkTheme },
        defaultColor: false,
        meta: { __raw: meta },
        transformers,
      });
      const pre = out.children.find((c): c is Element => c.type === 'element' && c.tagName === 'pre');
      if (!pre) continue;

      const lines = source.split('\n').length;
      const showLines = /\b(showLineNumbers|lineNumbers|ln)\b/.test(meta);
      // Shiki 输出的是字符串形式的 class 属性，统一成 className 数组
      const toList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? '').split(/\s+/));
      const existing = [...toList(pre.properties.class), ...toList(pre.properties.className)].filter(Boolean);
      delete pre.properties.class;
      pre.properties.className = [...existing, ...(showLines ? ['has-line-numbers'] : [])];
      delete pre.properties.tabindex;
      pre.properties.tabIndex = 0;

      const title = parseTitle(meta);
      const label = LANG_LABELS[rawLang] ?? (rawLang ? rawLang.toUpperCase() : 'Text');
      const header: Element = {
        type: 'element',
        tagName: 'figcaption',
        properties: { className: ['code-header'] },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['code-title'] },
            children: title ? [...svg('file', 14), { type: 'text', value: title }] : [],
          },
          { type: 'element', tagName: 'span', properties: { className: ['code-lang'] }, children: [{ type: 'text', value: label }] },
          {
            type: 'element',
            tagName: 'button',
            properties: { type: 'button', className: ['code-btn', 'code-wrap'], ariaLabel: '自动换行', title: '自动换行' },
            children: svg('wrap', 15),
          },
          {
            type: 'element',
            tagName: 'button',
            properties: { type: 'button', className: ['code-btn', 'code-copy'], ariaLabel: '复制代码', title: '复制代码' },
            children: svg('copy', 15),
          },
        ],
      };

      parent.children[index] = {
        type: 'element',
        tagName: 'figure',
        properties: {
          className: ['code-block', ...(lines > collapseLines ? ['is-collapsible', 'is-collapsed'] : [])],
          dataLang: rawLang || 'text',
          dataLines: String(lines),
        },
        children: [
          header,
          pre,
          ...(lines > collapseLines
            ? [
                {
                  type: 'element',
                  tagName: 'button',
                  properties: { type: 'button', className: ['code-expand'] },
                  children: [...svg('chevronDown', 15), { type: 'text', value: `展开全部 ${lines} 行` }],
                } satisfies Element,
              ]
            : []),
        ],
      };
    }
  };
}

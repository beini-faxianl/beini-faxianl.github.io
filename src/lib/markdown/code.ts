/**
 * rehype 插件：用 Shiki 高亮代码块（亮/暗双主题，CSS 变量切换）。
 *
 * 代码块首行参数与 Obsidian 插件 Codeblock Customizer 一致，例如：
 *   ```js file:app.js ln:true hl:2,4-6 error:8 hlt:5|print fold
 * 详见 codeblock-params.ts。代码内容本身原样显示，不解析任何注释标记。
 */
import { createHighlighter, bundledLanguages, type DecorationItem, type Highlighter, type ShikiTransformer } from 'shiki';
import type { Element, ElementContent, Root } from 'hast';
import { visit, SKIP } from 'unist-util-visit';
import { toString } from 'hast-util-to-string';
import { fromHtml } from 'hast-util-from-html';
import { siteConfig } from '../../../site.config';
import { icon } from '../icons';
import { parseCodeParams, type CodeParams } from './codeblock-params';

const { lightTheme, darkTheme, collapseLines, lineNumbers: lineNumbersByDefault, highlightColors } = siteConfig.code;

/** Codeblock Customizer 的参数名（写在语言位置时也要识别出来，例如 ``` hl:2） */
const PARAM_RE = /^([A-Za-z][\w-]*)[:=]|^(fold|unfold|exclude)$/i;

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

/** 行高亮：给对应行加 highlighted 类和颜色变量 */
function lineHighlighter(params: CodeParams): ShikiTransformer {
  return {
    name: 'codeblock-customizer-lines',
    line(node, line) {
      const color = params.lineHl.get(line);
      if (!color) return;
      this.addClassToHast(node, 'highlighted');
      node.properties.style = `--hl:${color}`;
    },
  };
}

/** 文本高亮：转换成 Shiki 的 decorations（会正确拆分语法着色的 token） */
function textDecorations(params: CodeParams): DecorationItem[] {
  const out: DecorationItem[] = [];
  for (const [line, ranges] of params.textHl) {
    for (const r of ranges) {
      out.push({
        start: { line: line - 1, character: r.start },
        end: { line: line - 1, character: r.end },
        properties: { class: 'hl-text', style: `--hl:${r.color}` },
        // 总是包一层新 span：否则区间恰好是一个 token 时，样式会覆盖掉它原本的语法颜色
        alwaysWrap: true,
      });
    }
  }
  return out;
}

function svg(name: Parameters<typeof icon>[0], size = 16): ElementContent[] {
  return fromHtml(icon(name, size), { fragment: true }).children as ElementContent[];
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
      let rawLang = langClass ? langClass.slice(9) : '';
      let meta = String((code.data as { meta?: string } | undefined)?.meta ?? '');
      // 没写语言、直接写参数时（``` hl:2），第一个参数会被当成语言
      if (PARAM_RE.test(rawLang)) {
        meta = `${rawLang} ${meta}`;
        rawLang = '';
      }
      rawLang = rawLang.toLowerCase();
      if (rawLang === 'math') continue; // 交给 rehype-katex
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

      const params = parseCodeParams(meta, source, highlightColors);
      const out = hl.codeToHast(source, {
        lang,
        themes: { light: lightTheme, dark: darkTheme },
        defaultColor: false,
        transformers: params.exclude ? [] : [lineHighlighter(params)],
        decorations: params.exclude ? [] : textDecorations(params),
      });
      const pre = out.children.find((c): c is Element => c.type === 'element' && c.tagName === 'pre');
      if (!pre) continue;

      const lines = source.split('\n').length;
      const showLines = params.exclude ? lineNumbersByDefault : (params.lineNumbers ?? lineNumbersByDefault);
      // Shiki 输出的是字符串形式的 class 属性，统一成 className 数组
      const toList = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? '').split(/\s+/));
      const existing = [...toList(pre.properties.class), ...toList(pre.properties.className)].filter(Boolean);
      delete pre.properties.class;
      pre.properties.className = [...existing, ...(showLines ? ['has-line-numbers'] : [])];
      delete pre.properties.tabindex;
      pre.properties.tabIndex = 0;
      // ln:5 —— 行号从 5 开始
      const codeEl = pre.children.find((c): c is Element => c.type === 'element' && c.tagName === 'code');
      if (codeEl && showLines && params.lineStart !== 1) codeEl.properties.style = `counter-reset: line ${params.lineStart - 1}`;

      const title = params.exclude ? undefined : params.title;
      const fold = !params.exclude && params.fold;
      const collapsible = !fold && lines > collapseLines;
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
          ...(fold
            ? [{ type: 'element', tagName: 'span', properties: { className: ['code-fold-hint'] }, children: [{ type: 'text', value: `已折叠 · ${lines} 行` }] } satisfies Element]
            : []),
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
          ...(fold
            ? [
                {
                  type: 'element',
                  tagName: 'button',
                  properties: { type: 'button', className: ['code-btn', 'code-fold'], ariaLabel: '展开代码', ariaExpanded: 'false', title: '展开 / 折叠' },
                  children: svg('chevronDown', 15),
                } satisfies Element,
              ]
            : []),
        ],
      };

      parent.children[index] = {
        type: 'element',
        tagName: 'figure',
        properties: {
          className: ['code-block', ...(fold ? ['is-foldable', 'is-folded'] : []), ...(collapsible ? ['is-collapsible', 'is-collapsed'] : [])],
          dataLang: rawLang || 'text',
          dataLines: String(lines),
        },
        children: [
          header,
          pre,
          ...(collapsible
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

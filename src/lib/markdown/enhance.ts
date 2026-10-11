import type { Element, ElementContent, Root } from 'hast';
import { visit, SKIP } from 'unist-util-visit';
import { toString } from 'hast-util-to-string';

export interface TocItem {
  depth: number;
  id: string;
  text: string;
}

const cls = (node: Element): string[] => ((node.properties?.className as string[]) ?? []).map(String);

/** 任务状态的读屏文字（Obsidian 自定义任务状态） */
const TASK_LABELS: Record<string, string> = {
  ' ': '未完成', x: '已完成', X: '已完成', '/': '进行中', '-': '已取消', '>': '已推迟', '<': '已排期',
  '?': '有疑问', '!': '重要', '*': '星标', '"': '引用', i: '信息', I: '灵感', b: '书签', p: '优点',
  c: '缺点', l: '地点', S: '金额', f: '热门', k: '关键', w: '成果', u: '上升', d: '下降',
};

function firstCheckbox(node: Element): Element | undefined {
  for (const c of node.children) {
    if (c.type !== 'element') continue;
    if (c.tagName === 'input') return c;
    if (c.tagName === 'p') return firstCheckbox(c);
  }
  return undefined;
}

/** rehype 插件：标题锚点 + 目录、图片懒加载与图注、表格滚动容器、外链处理 */
export default function rehypeEnhance(options: { toc: TocItem[] }) {
  return (tree: Root) => {
    visit(tree, 'element', (node, index, parent) => {
      const tag = node.tagName;

      if (/^h[1-6]$/.test(tag) && node.properties.id) {
        const id = String(node.properties.id);
        const depth = Number(tag[1]);
        if (parent?.type === 'root' && depth >= 2 && depth <= 4) {
          options.toc.push({ depth, id, text: toString(node).trim() });
        }
        node.children.push({
          type: 'element',
          tagName: 'a',
          properties: { className: ['heading-anchor'], href: `#${id}`, ariaLabel: '复制本节链接', tabIndex: -1 },
          children: [{ type: 'text', value: '#' }],
        });
        return SKIP;
      }

      if (tag === 'li' && node.properties.dataTask != null) {
        const box = firstCheckbox(node);
        if (box) box.properties.ariaLabel = `任务状态：${TASK_LABELS[String(node.properties.dataTask)] ?? String(node.properties.dataTask)}`;
        return;
      }

      if (tag === 'img') {
        node.properties.loading ??= 'lazy';
        node.properties.decoding ??= 'async';
        return;
      }

      // 只有一张带 title 的图片的段落 → <figure> + <figcaption>
      if (tag === 'p' && parent && index != null) {
        const meaningful = node.children.filter((c) => !(c.type === 'text' && !c.value.trim()));
        const only = meaningful[0];
        if (meaningful.length === 1 && only.type === 'element' && only.tagName === 'img' && only.properties.title) {
          const caption = String(only.properties.title);
          delete only.properties.title;
          only.properties.loading ??= 'lazy';
          only.properties.decoding ??= 'async';
          parent.children[index] = {
            type: 'element',
            tagName: 'figure',
            properties: { className: ['image-figure'] },
            children: [only, { type: 'element', tagName: 'figcaption', properties: {}, children: [{ type: 'text', value: caption }] }],
          };
          return SKIP;
        }
        return;
      }

      if (tag === 'table' && parent && index != null && !(parent.type === 'element' && cls(parent as Element).includes('table-wrap'))) {
        parent.children[index] = {
          type: 'element',
          tagName: 'div',
          properties: { className: ['table-wrap'] },
          children: [node as ElementContent],
        };
        return SKIP;
      }

      if (tag === 'a') {
        const href = String(node.properties.href ?? '');
        if (/^https?:\/\//i.test(href)) {
          node.properties.target = '_blank';
          node.properties.rel = ['noopener', 'noreferrer'];
          if (!cls(node).length) node.properties.className = ['external-link'];
        }
      }
    });
  };
}

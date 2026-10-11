import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import remarkCjkFriendly from 'remark-cjk-friendly';
import remarkCjkFriendlyStrikethrough from 'remark-cjk-friendly-gfm-strikethrough';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeSlug from 'rehype-slug';
import rehypeStringify from 'rehype-stringify';
import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';
import { siteConfig } from '../../../site.config';
import { getVault, onVaultRebuild, type Note, type Vault } from '../vault';
import { stripObsidianComments } from '../utils';
import remarkObsidian, { type ObsidianContext } from './obsidian';
import rehypeCode from './code';
import rehypeEnhance, { type TocItem } from './enhance';

export type { TocItem };

export interface Rendered {
  html: string;
  toc: TocItem[];
}

const cache = new Map<string, Promise<Rendered>>();
onVaultRebuild(() => cache.clear());

/** 渲染一篇笔记（带缓存；开发模式下仓库变化后自动失效） */
export function renderNote(note: Note): Promise<Rendered> {
  const vault = getVault();
  let p = cache.get(note.id);
  if (!p) {
    p = render(vault, note).catch((err) => {
      cache.delete(note.id);
      throw err;
    });
    cache.set(note.id, p);
  }
  return p;
}

async function render(vault: Vault, note: Note): Promise<Rendered> {
  let embedSeq = 0;

  // 被嵌入的笔记：只跑到 mdast（由宿主统一转换为 HTML）
  const parseEmbedded = async (target: Note, ctx: ObsidianContext): Promise<Root> => {
    const prefix = `e${++embedSeq}-`;
    const proc = unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkCjkFriendly)
      .use(remarkCjkFriendlyStrikethrough)
      .use(remarkMath)
      .use(remarkObsidian, { ...ctx, footnotePrefix: prefix });
    const tree = (await proc.run(proc.parse(stripObsidianComments(target.body)))) as Root;
    // 避免与宿主文档的脚注编号冲突
    visit(tree, (n) => {
      if ((n.type === 'footnoteReference' || n.type === 'footnoteDefinition') && !n.identifier.startsWith(prefix)) {
        n.identifier = prefix + n.identifier;
        n.label = n.identifier;
      }
    });
    return tree;
  };

  const ctx: ObsidianContext = { vault, note, depth: 0, stack: [note.id], parseEmbedded };
  const toc: TocItem[] = [];

  // remark-cjk-friendly：让 **加粗**、*斜体*、~~删除线~~ 紧挨中文标点时也能生效（与 Obsidian 行为一致）
  const proc = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkCjkFriendly)
    .use(remarkCjkFriendlyStrikethrough)
    .use(remarkMath)
    .use(remarkObsidian, ctx);
  if (!siteConfig.content.strictLineBreaks) proc.use(remarkBreaks);
  const file = await proc
    .use(remarkRehype, {
      allowDangerousHtml: true,
      footnoteLabel: '脚注',
      footnoteBackLabel: (i: number) => `返回正文（第 ${i + 1} 处引用）`,
      footnoteLabelProperties: { className: ['footnotes-label'] },
    })
    .use(rehypeCode)
    .use(rehypeRaw)
    .use(rehypeKatex, { throwOnError: false, strict: false })
    .use(rehypeSlug)
    .use(rehypeEnhance, { toc })
    .use(rehypeStringify)
    .process(stripObsidianComments(note.body));

  return { html: String(file), toc };
}

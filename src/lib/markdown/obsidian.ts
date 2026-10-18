/**
 * remark 插件：把 Obsidian 特有语法转换为标准 mdast（附带 hName/hProperties 提示）。
 *
 * 支持：[[双链]]、[[笔记#标题|别名]]、[[笔记#^块]]、![[嵌入笔记/章节/块]]、![[图片|300x200]]、
 * 音频/视频/PDF 嵌入、> [!callout]+/-（可折叠、可嵌套）、==高亮==、#标签/嵌套、^[行内脚注]、
 * ^块ID、自定义任务状态 [?] [/] [-] [>] …、![alt|300](url)、指向 .md 的普通链接、```query 搜索块。
 */
import path from 'node:path';
import type { Root } from 'mdast';
import { visit, SKIP } from 'unist-util-visit';
import { toString } from 'mdast-util-to-string';
import { slug as githubSlug } from 'github-slugger';
import { AUDIO_EXT, IMAGE_EXT, PDF_EXT, VIDEO_EXT, imageDims, tagUrl, type Note, type Vault } from '../vault';
import { icon, type IconName } from '../icons';
import { markdownToPlain } from '../utils';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

export interface ObsidianContext {
  vault: Vault;
  note: Note;
  depth: number;
  stack: string[];
  footnotePrefix?: string;
  parseEmbedded: (note: Note, ctx: ObsidianContext) => Promise<Root>;
}

const MAX_EMBED_DEPTH = 3;

const text = (value: string): Node => ({ type: 'text', value });
const el = (type: string, hName: string, className: string[] | undefined, children: Node[], extra: Record<string, unknown> = {}): Node => ({
  type,
  data: { hName, hProperties: { ...(className ? { className } : {}), ...extra } },
  children,
});
const rawHtml = (value: string): Node => ({ type: 'html', value });

function setProps(node: Node, props: Record<string, unknown>) {
  node.data ??= {};
  node.data.hProperties = { ...(node.data.hProperties ?? {}), ...props };
}

/** 与 rehype-slug（github-slugger）一致的标题锚点 */
export function headingAnchor(heading: string): string {
  return githubSlug(heading.trim());
}

function subAnchor(sub: string): string {
  if (!sub) return '';
  if (sub.startsWith('^')) return '#^' + sub.slice(1);
  const last = sub.split('#').filter(Boolean).pop() ?? sub;
  return '#' + headingAnchor(last);
}

interface ParsedTarget {
  file: string;
  sub: string;
  alias: string;
  parts: string[];
}

function parseTarget(raw: string): ParsedTarget {
  const s = raw.replace(/\\\|/g, '|');
  const pipe = s.indexOf('|');
  const head = (pipe >= 0 ? s.slice(0, pipe) : s).replace(/\\$/, '').trim();
  const parts = pipe >= 0 ? s.slice(pipe + 1).split('|').map((t) => t.trim()) : [];
  const hash = head.indexOf('#');
  return {
    file: (hash >= 0 ? head.slice(0, hash) : head).trim(),
    sub: hash >= 0 ? head.slice(hash + 1).trim() : '',
    alias: pipe >= 0 ? s.slice(pipe + 1).trim() : '',
    parts,
  };
}

function isAttachmentPath(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return ext !== '' && ext !== '.md' && /^\.[a-z0-9]{2,5}$/.test(ext);
}

function displayFor(file: string, sub: string): string {
  const name = file ? file.split('/').pop()!.replace(/\.md$/i, '') : '';
  const subText = sub ? sub.split('#').filter(Boolean).join(' › ') : '';
  if (!name) return subText;
  return subText ? `${name} › ${subText}` : name;
}

/* ------------------------------------------------------------------ */
/* Callouts                                                            */
/* ------------------------------------------------------------------ */

const CALLOUT_ALIASES: Record<string, string> = {
  summary: 'abstract',
  tldr: 'abstract',
  hint: 'tip',
  important: 'tip',
  check: 'success',
  done: 'success',
  help: 'question',
  faq: 'question',
  caution: 'warning',
  attention: 'warning',
  fail: 'failure',
  missing: 'failure',
  error: 'danger',
  cite: 'quote',
};
const CALLOUT_BASE = new Set(['note', 'abstract', 'info', 'todo', 'tip', 'success', 'question', 'warning', 'failure', 'danger', 'bug', 'example', 'quote']);

function transformCallout(bq: Node) {
  const first = bq.children[0];
  if (!first || first.type !== 'paragraph') return;
  const t = first.children[0];
  if (!t || t.type !== 'text') return;
  const m = /^\[!([^\]\s]+)\]([+-]?)[ \t]*/.exec(t.value);
  if (!m) return;

  const raw = m[1].toLowerCase();
  const fold = m[2];
  const base = CALLOUT_ALIASES[raw] ?? (CALLOUT_BASE.has(raw) ? raw : 'note');
  t.value = t.value.slice(m[0].length);

  // 第一行剩余部分是标题，其后是正文
  const titleNodes: Node[] = [];
  const restNodes: Node[] = [];
  let inTitle = true;
  for (const c of first.children) {
    if (!inTitle) {
      restNodes.push(c);
      continue;
    }
    if (c.type === 'text') {
      const nl = c.value.indexOf('\n');
      if (nl === -1) titleNodes.push(c);
      else {
        const a = c.value.slice(0, nl);
        const b = c.value.slice(nl + 1);
        if (a) titleNodes.push(text(a));
        if (b) restNodes.push(text(b));
        inTitle = false;
      }
    } else if (c.type === 'break') {
      inTitle = false;
    } else {
      titleNodes.push(c);
    }
  }
  const hasTitle = titleNodes.some((n) => n.type !== 'text' || n.value.trim());
  const titleChildren = hasTitle ? titleNodes : [text(raw.charAt(0).toUpperCase() + raw.slice(1).replace(/-/g, ' '))];

  const body: Node[] = [];
  if (restNodes.some((n) => n.type !== 'text' || n.value.trim())) body.push({ type: 'paragraph', children: restNodes });
  body.push(...bq.children.slice(1));

  const foldable = fold === '+' || fold === '-';
  const iconName = `c-${base}` as IconName;
  const title = el('calloutTitle', foldable ? 'summary' : 'div', ['callout-title'], [
    rawHtml(`<span class="callout-icon">${icon(iconName, 18)}</span>`),
    el('calloutTitleInner', 'span', ['callout-title-inner'], titleChildren),
    ...(foldable ? [rawHtml(`<span class="callout-fold">${icon('chevronDown', 16)}</span>`)] : []),
  ]);

  bq.data = {
    ...(bq.data ?? {}),
    hName: foldable ? 'details' : 'div',
    hProperties: {
      ...(bq.data?.hProperties ?? {}),
      className: ['callout', ...(foldable ? ['is-collapsible'] : [])],
      dataCallout: raw,
      dataCalloutType: base,
      ...(fold === '+' ? { open: true } : {}),
    },
  };
  bq.children = [title, ...(body.length ? [el('calloutContent', 'div', ['callout-content'], body)] : [])];
}

/* ------------------------------------------------------------------ */
/* 跨节点的成对定界符：==高亮==、^[行内脚注]                              */
/* ------------------------------------------------------------------ */

function wrapDelimited(parent: Node, open: string, close: string, build: (kids: Node[]) => Node, flanking: boolean) {
  const kids: Node[] = parent.children;
  for (let i = 0; i < kids.length; i++) {
    const node = kids[i];
    if (node.type !== 'text') continue;
    let start = node.value.indexOf(open);
    while (start !== -1) {
      const next = tryWrap(kids, i, start, open, close, build, flanking);
      if (next !== null) {
        i = next - 1;
        break;
      }
      start = node.value.indexOf(open, start + 1);
    }
  }
}

function tryWrap(kids: Node[], i: number, start: number, open: string, close: string, build: (kids: Node[]) => Node, flanking: boolean): number | null {
  const v: string = kids[i].value;
  const innerStart = start + open.length;
  if (flanking && /^\s/.test(v.charAt(innerStart))) return null;

  // 同一个文本节点内闭合
  let ci = v.indexOf(close, innerStart + 1);
  while (ci !== -1) {
    const inner = v.slice(innerStart, ci);
    if (inner && (!flanking || !/\s$/.test(inner))) {
      const before = v.slice(0, start);
      const after = v.slice(ci + close.length);
      const repl: Node[] = [];
      if (before) repl.push(text(before));
      repl.push(build([text(inner)]));
      if (after) repl.push(text(after));
      kids.splice(i, 1, ...repl);
      return i + repl.length - (after ? 1 : 0);
    }
    ci = v.indexOf(close, ci + 1);
  }

  // 跨越若干兄弟节点（中间可以有加粗、链接等）
  const head = v.slice(innerStart);
  for (let j = i + 1; j < kids.length; j++) {
    const n2 = kids[j];
    if (n2.type !== 'text') continue;
    const cj = n2.value.indexOf(close);
    if (cj === -1) continue;
    const tail = n2.value.slice(0, cj);
    if (flanking && /\s$/.test(tail)) return null;
    const inner: Node[] = [];
    if (head) inner.push(text(head));
    inner.push(...kids.slice(i + 1, j));
    if (tail) inner.push(text(tail));
    const before = v.slice(0, start);
    const after = n2.value.slice(cj + close.length);
    const repl: Node[] = [];
    if (before) repl.push(text(before));
    repl.push(build(inner));
    if (after) repl.push(text(after));
    kids.splice(i, j - i + 1, ...repl);
    return i + repl.length - (after ? 1 : 0);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 主转换                                                              */
/* ------------------------------------------------------------------ */

const WIKI_RE = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
/** 可能出现在双链文字中、会把双链拆散的行内节点 */
const SPLIT_TYPES = new Set(['inlineCode', 'emphasis', 'strong', 'delete', 'mark']);
const plainOf = (n: Node): string => (n.type === 'text' || n.type === 'inlineCode' ? n.value : toString(n));
const TAG_RE = /(^|[\s(（,，;；])#([\p{L}\p{N}_\-/]*[\p{L}_\-][\p{L}\p{N}_\-/]*)/gu;
const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/;

export default function remarkObsidian(ctx: ObsidianContext) {
  return async (tree: Root) => {
    await transform(tree as Node, ctx);
  };
}

async function transform(tree: Node, ctx: ObsidianContext) {
  const { vault, note } = ctx;
  const tasks: Array<() => Promise<void>> = [];
  const footnoteDefs: Node[] = [];
  let inlineCount = 0;

  // 0. 正文开头与标题相同的一级标题（避免标题重复显示）
  if (ctx.depth === 0) {
    const first = tree.children[0];
    if (first?.type === 'heading' && first.depth === 1 && norm(toString(first)) === norm(note.title)) tree.children.shift();
  }

  // 1. Callouts
  visit(tree, 'blockquote', (node: Node) => transformCallout(node));

  // 2. 行内语法
  const makeLink = (raw: string): Node => {
    const { file, sub, alias } = parseTarget(raw);
    const display = alias || displayFor(file, sub);
    if (file && isAttachmentPath(file)) {
      const att = vault.resolveAttachment(file, note);
      if (att) return { type: 'link', url: att.url, children: [text(display)], data: { hProperties: { className: ['attachment-link'] } } };
      return el('wikiMissing', 'span', ['internal-link', 'is-unresolved'], [text(display)], { title: '附件不存在' });
    }
    const target = file ? vault.resolveNote(file, note) : note;
    if (!target) return el('wikiMissing', 'span', ['internal-link', 'is-unresolved'], [text(display)], { title: '这篇笔记还没有写' });
    const sameNote = target === note && ctx.depth === 0;
    return {
      type: 'link',
      url: (sameNote ? '' : target.url) + subAnchor(sub) || target.url,
      children: [text(display)],
      data: { hProperties: { className: ['internal-link'], dataNote: target.slug } },
    };
  };

  const makeEmbed = (raw: string): Node => {
    const { file, sub, parts } = parseTarget(raw);
    if (file && isAttachmentPath(file)) {
      const ext = path.extname(file).toLowerCase();
      const att = vault.resolveAttachment(file, note);
      if (!att) return el('embedMissing', 'span', ['embed-missing'], [text(file)]);
      if (IMAGE_EXT.has(ext)) {
        let width: string | undefined;
        let height: string | undefined;
        let alt = defaultAlt(file);
        for (const p of parts) {
          const m = p.match(/^(\d+)(?:\s*x\s*(\d+))?$/);
          if (m) [width, height] = [m[1], m[2]];
          else if (p) alt = p;
        }
        return { type: 'image', url: att.url, alt, title: null, data: { hProperties: sizeProps(att.file, width, height) } };
      }
      if (AUDIO_EXT.has(ext)) return el('embedMedia', 'audio', ['embed-audio'], [], { controls: true, preload: 'metadata', src: att.url });
      if (VIDEO_EXT.has(ext))
        return el('embedMedia', 'video', ['embed-video'], [], { controls: true, preload: 'metadata', playsInline: true, src: att.url });
      if (PDF_EXT.has(ext))
        return el('embedMedia', 'iframe', ['embed-pdf'], [], { src: att.url + (sub ? '#' + sub : ''), loading: 'lazy', title: att.name });
      return { type: 'link', url: att.url, children: [text(att.name)], data: { hProperties: { className: ['attachment-link'], download: '' } } };
    }

    const target = file ? vault.resolveNote(file, note) : note;
    if (!target) return el('embedMissing', 'span', ['embed-missing'], [text(displayFor(file, sub))]);
    // 防止循环嵌入（同一笔记内嵌入自己的某个章节是允许的，由深度上限兜底）
    if ((ctx.stack.includes(target.id) && !(target === note && sub)) || ctx.depth >= MAX_EMBED_DEPTH) return makeLink(raw);

    const node = el('embedNote', 'div', ['embed-note'], [], { dataEmbed: target.slug });
    tasks.push(async () => {
      const childCtx: ObsidianContext = { ...ctx, note: target, depth: ctx.depth + 1, stack: [...ctx.stack, target.id] };
      const sub_tree = await ctx.parseEmbedded(target, childCtx);
      let nodes: Node[] | null = sub ? extractSub(sub_tree, sub) : sub_tree.children;
      if (!nodes) nodes = [{ type: 'paragraph', children: [text(`未找到 “${sub}”`)] }];
      const label = sub ? `${target.title} › ${sub.split('#').filter(Boolean).join(' › ')}` : target.title;
      node.children = [
        el('embedTitle', 'div', ['embed-title'], [
          {
            type: 'link',
            url: target.url + subAnchor(sub),
            children: [text(label)],
            data: { hProperties: { className: ['internal-link'], dataNote: target.slug } },
          },
        ]),
        el('embedBody', 'div', ['embed-body'], nodes),
      ];
    });
    return node;
  };

  /**
   * 跨节点的双链：链接文字里有 `行内代码`、*强调* 等时（如 [[#`jwk` 参数注入]]），
   * Markdown 会先把它们解析成独立节点，双链被拆散在多个节点里，这里把它们重新拼起来。
   */
  const joinSplitWikilinks = (kids: Node[]) => {
    for (let i = 0; i < kids.length; i++) {
      const c = kids[i];
      if (c.type !== 'text') continue;
      const open = c.value.lastIndexOf('[[');
      if (open === -1 || c.value.indexOf(']]', open + 2) !== -1) continue;
      let j = i + 1;
      let close = -1;
      for (; j < kids.length; j++) {
        const n = kids[j];
        if (n.type === 'text') {
          close = n.value.indexOf(']]');
          if (close !== -1 || n.value.includes('[[')) break;
        } else if (!SPLIT_TYPES.has(n.type)) break;
      }
      if (close === -1 || j >= kids.length) continue;

      const head = c.value.slice(open + 2);
      const middle = kids.slice(i + 1, j);
      const tail = kids[j].value.slice(0, close);
      const plain = head + middle.map(plainOf).join('') + tail;
      if (!plain.trim() || plain.includes('\n')) continue;

      const isEmbed = open > 0 && c.value[open - 1] === '!';
      const before = c.value.slice(0, isEmbed ? open - 1 : open);
      const after = kids[j].value.slice(close + 2);
      const node = isEmbed ? makeEmbed(plain) : makeLink(plain);
      // 没有别名时，保留链接文字里的行内代码等格式
      const hash = head.indexOf('#');
      if (!isEmbed && !parseTarget(plain).alias && hash !== -1 && Array.isArray(node.children)) {
        const file = head.slice(0, hash).trim();
        const lead = (file ? `${file.split('/').pop()!.replace(/\.md$/i, '')} › ` : '') + head.slice(hash + 1);
        node.children = [...(lead ? [text(lead)] : []), ...structuredClone(middle), ...(tail ? [text(tail)] : [])];
      }
      const repl: Node[] = [...(before ? [text(before)] : []), node, ...(after ? [text(after)] : [])];
      kids.splice(i, j - i + 1, ...repl);
      // 继续检查剩下的文字（里面可能还有双链）
      i += repl.length - 1 - (after ? 1 : 0);
    }
  };

  const processChildren = (parent: Node, insideLink: boolean) => {
    const kids: Node[] = parent.children;
    if (!insideLink) {
      joinSplitWikilinks(kids);
      // [[wikilink]] 与 ![[embed]]
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.type !== 'text' || !c.value.includes('[[')) continue;
        const out: Node[] = [];
        let last = 0;
        for (const m of c.value.matchAll(WIKI_RE) as IterableIterator<RegExpMatchArray>) {
          if (m.index! > last) out.push(text(c.value.slice(last, m.index)));
          out.push(m[1] ? makeEmbed(m[2]) : makeLink(m[2]));
          last = m.index! + m[0].length;
        }
        if (!out.length) continue;
        if (last < c.value.length) out.push(text(c.value.slice(last)));
        kids.splice(i, 1, ...out);
        i += out.length - 1;
      }
      // #标签
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.type !== 'text' || !c.value.includes('#')) continue;
        const out: Node[] = [];
        let last = 0;
        for (const m of c.value.matchAll(TAG_RE) as IterableIterator<RegExpMatchArray>) {
          const tag = m[2].replace(/\/+$/, '');
          const at = m.index! + m[1].length;
          if (at > last) out.push(text(c.value.slice(last, at)));
          out.push({ type: 'link', url: tagUrl(tag), children: [text('#' + tag)], data: { hProperties: { className: ['tag'] } } });
          last = at + 1 + m[2].length;
        }
        if (!out.length) continue;
        if (last < c.value.length) out.push(text(c.value.slice(last)));
        kids.splice(i, 1, ...out);
        i += out.length - 1;
      }
    }
    // ==高亮==
    wrapDelimited(parent, '==', '==', (children) => ({ type: 'mark', data: { hName: 'mark' }, children }), true);
    // ^[行内脚注]
    wrapDelimited(
      parent,
      '^[',
      ']',
      (children) => {
        const id = `${ctx.footnotePrefix ?? ''}inline-${++inlineCount}`;
        footnoteDefs.push({ type: 'footnoteDefinition', identifier: id, label: id, children: [{ type: 'paragraph', children }] });
        return { type: 'footnoteReference', identifier: id, label: id };
      },
      false,
    );
  };

  const walk = (node: Node, insideLink: boolean) => {
    if (!Array.isArray(node.children)) return;
    const inLink = insideLink || node.type === 'link' || node.type === 'linkReference';
    processChildren(node, inLink);
    for (const c of node.children) walk(c, inLink);
  };
  walk(tree, false);
  tree.children.push(...footnoteDefs);

  // 3. 块 ID：段落/列表项末尾的 ^id，或单独一行的 ^id（作用于上一个块）
  visit(tree, 'paragraph', (node: Node, index, parent: Node) => {
    const last = node.children[node.children.length - 1];
    if (last?.type !== 'text') return;
    const m = last.value.match(BLOCK_ID_RE);
    if (!m) return;
    const id = m[1];
    if (node.children.length === 1 && last.value.trim() === '^' + id && parent && index != null && index > 0) {
      setBlockId(parent.children[index - 1], id);
      parent.children.splice(index, 1);
      return [SKIP, index];
    }
    last.value = last.value.slice(0, m.index);
    setBlockId(parent?.type === 'listItem' && parent.children[0] === node ? parent : node, id);
  });

  // 4. 任务列表（含自定义状态）
  visit(tree, 'listItem', (node: Node) => {
    if (typeof node.checked === 'boolean') {
      setProps(node, { dataTask: node.checked ? 'x' : ' ' });
      return;
    }
    const p = node.children[0];
    const t = p?.type === 'paragraph' ? p.children[0] : null;
    if (t?.type !== 'text') return;
    const m = t.value.match(/^\[([^\]\s\\])\][ \t]+/);
    if (!m) return;
    t.value = t.value.slice(m[0].length);
    node.checked = true;
    setProps(node, { dataTask: m[1] });
  });

  // 5. 图片尺寸 ![alt|300](url)、相对路径的图片和链接
  visit(tree, 'image', (node: Node) => {
    let width: string | undefined;
    let height: string | undefined;
    const m = String(node.alt ?? '').match(/^(.*?)\|\s*(\d+)(?:\s*x\s*(\d+))?\s*$/);
    if (m) {
      node.alt = m[1];
      [width, height] = [m[2], m[3]];
    }
    if (!/^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(node.url)) {
      const att = vault.resolveAttachment(node.url.split('#')[0], note);
      if (att) {
        node.url = att.url;
        setProps(node, sizeProps(att.file, width, height));
        return;
      }
    }
    if (width) setProps(node, { width, height });
  });
  visit(tree, 'link', (node: Node) => {
    const url: string = node.url;
    if (!url || /^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(url)) return;
    const [p, hash = ''] = url.split('#');
    let decoded = p;
    try {
      decoded = decodeURIComponent(p);
    } catch {
      /* keep */
    }
    if (/\.md$/i.test(decoded) || !path.extname(decoded)) {
      const target = vault.resolveNote(decoded, note);
      if (target) {
        node.url = target.url + subAnchor(hash ? safeDecode(hash) : '');
        setProps(node, { className: ['internal-link'], dataNote: target.slug });
      }
    } else {
      const att = vault.resolveAttachment(decoded, note);
      if (att) node.url = att.url;
    }
  });

  // 6. ```query 搜索块
  visit(tree, 'code', (node: Node, index, parent: Node) => {
    if (node.lang !== 'query' || !parent || index == null) return;
    parent.children[index] = buildQuery(node.value, vault);
    return SKIP;
  });

  // 7. 嵌入的笔记（异步解析）
  await Promise.all(tasks.map((t) => t()));

  // 8. 笔记嵌入是块级元素：把它们从段落里提出来
  liftEmbeds(tree);
}

/** 图片尺寸：优先使用用户指定的宽高，缺失的部分按图片固有比例补齐 */
function sizeProps(file: string, width?: string, height?: string): Record<string, string | undefined> {
  const dims = imageDims(file);
  if (!dims) return { width, height };
  if (!width && !height) return { width: String(dims.width), height: String(dims.height) };
  if (width && !height) return { width, height: String(Math.round((Number(width) * dims.height) / dims.width)) };
  return { width, height };
}

/** 默认的替代文字：文件名；但 Obsidian 粘贴图片的自动文件名（Pasted image 2024…）没有意义，留空 */
function defaultAlt(file: string): string {
  const name = path.basename(file, path.extname(file));
  return /^(pasted image|screenshot|截图|屏幕截图|image)[\s_-]*\d*/i.test(name) ? '' : name;
}

function safeDecode(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function norm(s: string) {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

function setBlockId(node: Node, id: string) {
  if (!node) return;
  node.data ??= {};
  node.data.blockId = id;
  setProps(node, { id: '^' + id });
}

function extractSub(tree: Node, sub: string): Node[] | null {
  if (sub.startsWith('^')) {
    const id = sub.slice(1);
    let found: Node = null;
    visit(tree, (n: Node) => {
      if (found) return SKIP;
      if (n.data?.blockId === id) {
        found = n;
        return SKIP;
      }
    });
    if (!found) return null;
    const f: Node = found;
    if (f.type === 'listItem') return [{ type: 'list', ordered: false, spread: false, children: [f] }];
    return [f];
  }
  const want = headingAnchor(sub.split('#').filter(Boolean).pop() ?? sub);
  const kids: Node[] = tree.children;
  const idx = kids.findIndex((n) => n.type === 'heading' && headingAnchor(toString(n)) === want);
  if (idx < 0) return null;
  const depth = kids[idx].depth;
  let end = idx + 1;
  while (end < kids.length && !(kids[end].type === 'heading' && kids[end].depth <= depth)) end++;
  return kids.slice(idx, end);
}

function liftEmbeds(parent: Node) {
  const kids: Node[] = parent.children;
  if (!Array.isArray(kids)) return;
  for (let i = 0; i < kids.length; i++) {
    const c = kids[i];
    if (c.type === 'paragraph' && c.children.some((k: Node) => k.type === 'embedNote')) {
      const groups: Node[] = [];
      let cur: Node[] = [];
      const flush = () => {
        const meaningful = cur.some((k) => k.type !== 'break' && !(k.type === 'text' && !k.value.trim()));
        if (meaningful) {
          const first = cur[0];
          const lastN = cur[cur.length - 1];
          if (first?.type === 'text') first.value = first.value.replace(/^\s+/, '');
          if (lastN?.type === 'text') lastN.value = lastN.value.replace(/\s+$/, '');
          groups.push({ type: 'paragraph', children: cur });
        }
        cur = [];
      };
      for (const k of c.children) {
        if (k.type === 'embedNote') {
          flush();
          groups.push(k);
        } else cur.push(k);
      }
      flush();
      kids.splice(i, 1, ...groups);
      i += groups.length - 1;
    } else if (c.type !== 'embedNote' && Array.isArray(c.children)) {
      liftEmbeds(c);
    }
  }
}

/* ------------------------------------------------------------------ */
/* ```query``` —— Obsidian 的“嵌入搜索结果”                              */
/* ------------------------------------------------------------------ */

function buildQuery(query: string, vault: Vault): Node {
  const tokens = query.match(/-?(?:\w+:)?(?:"[^"]*"|\S+)/g) ?? [];
  const tests = tokens.map((tok) => {
    const neg = tok.startsWith('-');
    const t = neg ? tok.slice(1) : tok;
    const m = t.match(/^(\w+):(.*)$/);
    const op = m ? m[1].toLowerCase() : 'content';
    const val = (m ? m[2] : t).replace(/^"|"$/g, '').toLowerCase();
    const fn = (n: Note): boolean => {
      switch (op) {
        case 'tag':
          return n.tags.some((x) => {
            const v = val.replace(/^#/, '');
            const tl = x.toLowerCase();
            return tl === v || tl.startsWith(v + '/');
          });
        case 'path':
          return n.id.toLowerCase().includes(val);
        case 'file':
          return n.name.toLowerCase().includes(val);
        case 'title':
          return n.title.toLowerCase().includes(val);
        default:
          return n.title.toLowerCase().includes(val) || markdownToPlain(n.body, true).toLowerCase().includes(val);
      }
    };
    return (n: Note) => (neg ? !fn(n) : fn(n));
  });
  const results = tokens.length ? vault.posts.filter((n) => tests.every((t) => t(n))) : [];
  return el('queryEmbed', 'div', ['query-embed'], [
    el('queryHeader', 'div', ['query-header'], [
      rawHtml(icon('search', 15)),
      el('queryText', 'span', ['query-text'], [text(query.trim())]),
      el('queryCount', 'span', ['query-count'], [text(`${results.length} 个结果`)]),
    ]),
    results.length
      ? {
          type: 'list',
          ordered: false,
          spread: false,
          children: results.map((n) => ({
            type: 'listItem',
            spread: false,
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'link', url: n.url, children: [text(n.title)], data: { hProperties: { className: ['internal-link'], dataNote: n.slug } } }],
              },
            ],
          })),
        }
      : el('queryEmpty', 'p', ['query-empty'], [text('没有匹配的笔记')]),
  ]);
}

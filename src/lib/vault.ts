import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { imageSize } from 'image-size';
import { siteConfig } from '../../site.config';
import {
  countWords,
  excerpt,
  markdownToPlain,
  parseDate,
  readingMinutes,
  slugify,
  stripObsidianComments,
  withBase,
} from './utils';

export const VAULT_ROOT = path.resolve(process.env.VAULT_DIR || siteConfig.content.dir);
const IS_DEV = import.meta.env.DEV;

export const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.avif', '.ico']);
export const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.ogg', '.3gp', '.flac', '.aac']);
export const VIDEO_EXT = new Set(['.mp4', '.webm', '.ogv', '.mov', '.mkv']);
export const PDF_EXT = new Set(['.pdf']);

export interface Note {
  /** 相对仓库根目录的路径（不含扩展名，posix 分隔符） */
  id: string;
  file: string;
  /** 文件名（不含扩展名） */
  name: string;
  slug: string;
  url: string;
  kind: 'post' | 'page';
  title: string;
  frontmatter: Record<string, unknown>;
  /** 去掉 frontmatter 后的正文 */
  body: string;
  /** 顶级分类名称，例如「技术」 */
  category: string;
  /** 完整分类路径，例如 ['技术', '前端'] */
  categoryPath: string[];
  /** 完整分类路径的 slug，例如 '技术/前端' */
  categorySlug: string;
  /** 自身及所有上级分类的 slug（用于筛选），例如 ['技术', '技术/前端'] */
  categorySlugs: string[];
  /** 展示用，例如「技术 › 前端」 */
  categoryLabel: string;
  tags: string[];
  aliases: string[];
  date: Date;
  updated?: Date;
  draft: boolean;
  /** 首页置顶（frontmatter: pinned） */
  pinned: boolean;
  /** 在哪些分类中置顶（分类 slug；frontmatter: categoryPinned） */
  pinnedIn: string[];
  /** 摘要：frontmatter 中的 description，或自动截取的正文开头 */
  description: string;
  /** 仅当 frontmatter 明确写了 description / summary 时存在，作为文章副标题展示 */
  lede?: string;
  cover?: string;
  cssclasses: string[];
  words: number;
  minutes: number;
  /** 引用到的其它笔记 id */
  links: string[];
}

export interface Attachment {
  file: string;
  /** 相对路径（posix） */
  rel: string;
  name: string;
  ext: string;
  /** 输出路径（attachments/ 之后的部分） */
  outPath: string;
  url: string;
}

export interface TagInfo {
  name: string;
  slug: string;
  url: string;
  posts: Note[];
}

export interface CategoryInfo {
  /** 本级名称 */
  name: string;
  /** 完整路径，例如 ['技术', '前端'] */
  path: string[];
  /** 展示用，例如「技术 › 前端」 */
  label: string;
  /** 例如 '技术/前端' */
  slug: string;
  url: string;
  /** 0 = 顶级分类 */
  depth: number;
  /** 本分类及所有子分类下的文章：先是本分类的置顶文章，其余按时间倒序 */
  posts: Note[];
  /** 在本分类中置顶的文章（时间倒序） */
  pinned: Note[];
  /** 直接属于本分类的文章 */
  directPosts: Note[];
  children: CategoryInfo[];
  parent?: CategoryInfo;
}

export class Vault {
  notes: Note[] = [];
  posts: Note[] = [];
  pages: Note[] = [];
  attachments: Attachment[] = [];
  byId = new Map<string, Note>();
  private byPath = new Map<string, Note>();
  private byName = new Map<string, Note[]>();
  private byAlias = new Map<string, Note>();
  private attByPath = new Map<string, Attachment>();
  private attByName = new Map<string, Attachment[]>();
  private backlinkMap = new Map<string, Note[]>();

  constructor(notes: Note[], attachments: Attachment[]) {
    this.notes = notes;
    this.attachments = attachments;
    for (const n of notes) {
      this.byId.set(n.id, n);
      this.byPath.set(key(n.id), n);
      push(this.byName, key(n.name), n);
      for (const a of n.aliases) if (!this.byAlias.has(key(a))) this.byAlias.set(key(a), n);
    }
    for (const a of attachments) {
      this.attByPath.set(key(a.rel), a);
      push(this.attByName, key(a.name), a);
    }
    // 解析出链关系（需要所有笔记都已索引）
    for (const n of notes) {
      const targets = new Set<string>();
      for (const raw of extractLinkTargets(n.body)) {
        const t = this.resolveNote(raw, n);
        if (t && t.id !== n.id) targets.add(t.id);
      }
      n.links = [...targets];
      for (const t of targets) push(this.backlinkMap, t, n);
    }
    this.posts = notes
      .filter((n) => n.kind === 'post')
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || +b.date - +a.date);
    this.pages = notes.filter((n) => n.kind === 'page');
  }

  /** 按时间倒序（不考虑置顶） */
  get chronological(): Note[] {
    return [...this.posts].sort((a, b) => +b.date - +a.date);
  }

  /** 按 Obsidian 的规则解析 [[链接]] 目标 */
  resolveNote(target: string, from?: Note): Note | undefined {
    let t = safeDecode(target.trim()).replace(/\\/g, '/').replace(/^\.\//, '');
    t = t.replace(/\.md$/i, '');
    if (!t) return from;
    const k = key(t);
    const exact = this.byPath.get(k.replace(/^\//, ''));
    if (exact) return exact;
    if (from && t.includes('/')) {
      const rel = this.byPath.get(key(path.posix.normalize(path.posix.join(path.posix.dirname(from.id), t))));
      if (rel) return rel;
    }
    const base = k.split('/').pop()!;
    let cands = this.byName.get(base) ?? [];
    if (k.includes('/')) cands = cands.filter((c) => key(c.id).endsWith(k));
    if (cands.length === 1) return cands[0];
    if (cands.length > 1) {
      const dir = from ? path.posix.dirname(from.id) : '';
      return cands.find((c) => path.posix.dirname(c.id) === dir) ?? [...cands].sort((a, b) => a.id.length - b.id.length)[0];
    }
    return this.byAlias.get(k);
  }

  resolveAttachment(target: string, from?: Note): Attachment | undefined {
    const t = safeDecode(target.trim()).replace(/\\/g, '/').replace(/^\.\//, '');
    if (!t) return undefined;
    const k = key(t);
    const exact = this.attByPath.get(k.replace(/^\//, ''));
    if (exact) return exact;
    if (from) {
      const rel = this.attByPath.get(key(path.posix.normalize(path.posix.join(path.posix.dirname(from.id), t))));
      if (rel) return rel;
    }
    const base = k.split('/').pop()!;
    let cands = this.attByName.get(base) ?? [];
    if (k.includes('/')) cands = cands.filter((c) => key(c.rel).endsWith(k));
    if (cands.length > 1 && from) {
      const dir = path.posix.dirname(from.id);
      return cands.find((c) => path.posix.dirname(c.rel) === dir) ?? cands[0];
    }
    return cands[0];
  }

  /** 封面图：支持 [[双链]]、相对路径、网址；返回尺寸，以及是否为位图（社交分享卡片不支持 SVG） */
  cover(note: Note): { url: string; width?: number; height?: number; raster: boolean } | undefined {
    if (!note.cover) return undefined;
    const raw = note.cover.replace(/^!?\[\[|\]\]$/g, '').split('|')[0].trim();
    if (/^https?:\/\//i.test(raw)) return { url: raw, raster: !/\.svg(\?|#|$)/i.test(raw) };
    const att = this.resolveAttachment(raw, note);
    if (!att) return undefined;
    const d = imageDims(att.file);
    return { url: att.url, width: d?.width, height: d?.height, raster: att.ext !== '.svg' };
  }

  backlinks(note: Note): Note[] {
    return (this.backlinkMap.get(note.id) ?? []).filter((n) => n.kind === 'post');
  }

  private catRoots?: CategoryInfo[];
  private catBySlug = new Map<string, CategoryInfo>();

  /** 顶级分类（每个分类带 children 子分类树） */
  categories(): CategoryInfo[] {
    if (this.catRoots) return this.catRoots;
    const roots: CategoryInfo[] = [];
    for (const p of this.chronological) {
      let parent: CategoryInfo | undefined;
      p.categoryPath.forEach((name, i) => {
        const slug = p.categorySlugs[i];
        let c = this.catBySlug.get(slug);
        if (!c) {
          const path = p.categoryPath.slice(0, i + 1);
          c = {
            name,
            path,
            label: path.join(' › '),
            slug,
            url: withBase(`/categories/${slug}/`),
            depth: i,
            posts: [],
            pinned: [],
            directPosts: [],
            children: [],
            parent,
          };
          this.catBySlug.set(slug, c);
          (parent ? parent.children : roots).push(c);
        }
        c.posts.push(p);
        if (i === p.categoryPath.length - 1) c.directPosts.push(p);
        parent = c;
      });
    }
    const sort = (list: CategoryInfo[]) => {
      list.sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name, 'zh'));
      list.forEach((c) => {
        // 本分类的置顶文章排在最前面
        c.pinned = c.posts.filter((p) => p.pinnedIn.includes(c.slug));
        if (c.pinned.length) c.posts = [...c.pinned, ...c.posts.filter((p) => !c.pinned.includes(p))];
        sort(c.children);
      });
    };
    sort(roots);
    this.catRoots = roots;
    return roots;
  }

  /** 所有层级的分类（深度优先） */
  allCategories(): CategoryInfo[] {
    const out: CategoryInfo[] = [];
    const walk = (list: CategoryInfo[]) => list.forEach((c) => (out.push(c), walk(c.children)));
    walk(this.categories());
    return out;
  }

  category(slug: string): CategoryInfo | undefined {
    this.categories();
    return this.catBySlug.get(slug);
  }

  /** 文章所在分类的面包屑：[技术, 技术 › 前端] */
  categoryTrail(note: Note): CategoryInfo[] {
    return note.categorySlugs.map((s) => this.category(s)).filter((c): c is CategoryInfo => !!c);
  }

  tags(): TagInfo[] {
    const map = new Map<string, TagInfo>();
    for (const p of this.chronological) {
      for (const t of p.tags) {
        // 嵌套标签 a/b 同时计入 a
        const parts = t.split('/');
        for (let i = 1; i <= parts.length; i++) {
          const name = parts.slice(0, i).join('/');
          const k = name.toLowerCase();
          let info = map.get(k);
          if (!info) {
            info = { name, slug: tagSlug(name), url: tagUrl(name), posts: [] };
            map.set(k, info);
          }
          if (!info.posts.includes(p)) info.posts.push(p);
        }
      }
    }
    return [...map.values()].sort((a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name, 'zh'));
  }

  /** 相邻文章（按时间） */
  neighbors(note: Note): { prev?: Note; next?: Note } {
    const list = this.chronological;
    const i = list.indexOf(note);
    if (i === -1) return {};
    return { prev: list[i + 1], next: list[i - 1] };
  }

  /** 相关文章：共享标签 / 互相链接 / 同分类 */
  related(note: Note, limit = 3): Note[] {
    const scores = new Map<Note, number>();
    const tagSet = new Set(note.tags.map((t) => t.toLowerCase()));
    for (const p of this.posts) {
      if (p === note) continue;
      let s = 0;
      for (const t of p.tags) if (tagSet.has(t.toLowerCase())) s += 3;
      if (note.links.includes(p.id) || p.links.includes(note.id)) s += 4;
      if (p.categorySlug === note.categorySlug) s += 2;
      else if (p.category === note.category) s += 1;
      if (s > 0) scores.set(p, s);
    }
    return [...scores.entries()]
      .sort((a, b) => b[1] - a[1] || +b[0].date - +a[0].date)
      .slice(0, limit)
      .map(([p]) => p);
  }
}

const dimsCache = new Map<string, { width: number; height: number } | null>();

/** 读取图片的固有尺寸（用于设置 width/height，避免图片加载时页面跳动） */
export function imageDims(file: string): { width: number; height: number } | undefined {
  let key = file;
  try {
    key += ':' + fs.statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
  if (!dimsCache.has(key)) {
    let dims: { width: number; height: number } | null = null;
    try {
      const r = imageSize(fs.readFileSync(file));
      if (r.width && r.height) {
        // EXIF 方向为 5–8 时浏览器会旋转显示，宽高需要互换
        const rotated = r.orientation != null && r.orientation >= 5;
        dims = rotated ? { width: r.height, height: r.width } : { width: r.width, height: r.height };
      }
    } catch {
      /* 无法识别的格式 */
    }
    dimsCache.set(key, dims);
  }
  return dimsCache.get(key) ?? undefined;
}

export function tagSlug(tag: string): string {
  return tag
    .split('/')
    .map((p) => slugify(p))
    .join('/');
}

export function tagUrl(tag: string): string {
  return withBase(`/tags/${tagSlug(tag)}/`);
}

function key(s: string): string {
  return s.normalize('NFC').toLowerCase();
}

function push<K, V>(map: Map<K, V[]>, k: K, v: V) {
  const arr = map.get(k);
  if (arr) arr.push(v);
  else map.set(k, [v]);
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** 从正文中提取 [[链接]] / ![[嵌入]] / [x](note.md) 的目标 */
export function extractLinkTargets(body: string): string[] {
  const clean = removeCode(body);
  const out: string[] = [];
  for (const m of clean.matchAll(/!?\[\[([^\[\]\n|#^]*)(?:[#^|][^\]\n]*)?\]\]/g)) {
    if (m[1].trim() && !isAttachmentLike(m[1])) out.push(m[1]);
  }
  for (const m of clean.matchAll(/\]\(\s*<?([^)>\s]+?\.md)(?:#[^)>]*)?>?\s*\)/gi)) {
    if (!/^[a-z]+:/i.test(m[1])) out.push(m[1]);
  }
  return out;
}

function isAttachmentLike(t: string): boolean {
  const ext = path.extname(t.trim()).toLowerCase();
  return ext !== '' && ext !== '.md' && /^\.[a-z0-9]{2,5}$/.test(ext);
}

function removeCode(s: string): string {
  return stripObsidianComments(s)
    .replace(/^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[ \t]*$/gm, '')
    .replace(/`[^`\n]+`/g, '');
}

const TAG_RE = /(?<=^|[\s(（,，;；])#([\p{L}\p{N}_\-/]*[\p{L}_\-][\p{L}\p{N}_\-/]*)/gu;

export function extractInlineTags(body: string): string[] {
  const clean = removeCode(body).replace(/^#{1,6}\s/gm, '').replace(/\$\$[\s\S]*?\$\$/g, '');
  const out: string[] = [];
  for (const m of clean.matchAll(TAG_RE)) out.push(m[1].replace(/\/+$/, ''));
  return out;
}

function toList(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.flatMap(toList);
  if (typeof v === 'string')
    return v
      .split(/[,，\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  return [String(v)];
}

/**
 * 分类路径：
 * - frontmatter `category: 技术/前端` 或 `categories: [技术, 前端]`（与 Hexo 一致，数组表示层级）
 * - 否则取文件所在的文件夹层级：content/技术/前端/x.md → ['技术', '前端']
 * - 根目录下的文章归入 defaultCategory
 */
function resolveCategoryPath(fm: Record<string, unknown>, id: string): string[] {
  const clean = (s: unknown) => String(s).replace(/^\[\[|\]\]$/g, '').trim();
  const raw = fm.categories ?? fm.category;
  let segs: string[];
  if (Array.isArray(raw)) segs = raw.map(clean);
  else if (raw != null && String(raw).trim()) segs = clean(raw).split(/\s*(?:\/|›|>)\s*/);
  else segs = id.split('/').slice(0, -1);
  segs = segs.map((s) => s.trim()).filter(Boolean);
  const depth = siteConfig.content.categoryDepth;
  if (depth > 0) segs = segs.slice(0, depth);
  return segs.length ? segs : [siteConfig.content.defaultCategory];
}

/**
 * 分类置顶：
 * - categoryPinned: true            → 在文章所属的分类中置顶
 * - categoryPinned: Web 安全         → 在上级分类「Web 安全」中置顶（可写分类名或完整路径 Web 安全/JWT）
 * - categoryPinned: [JWT, Web 安全]  → 同时在多个分类中置顶
 * 只能是文章所属的分类或它的上级分类。
 */
function resolveCategoryPins(raw: unknown, slugs: string[], id: string): string[] {
  if (raw == null || raw === false) return [];
  const own = slugs[slugs.length - 1];
  const out = new Set<string>();
  for (const value of Array.isArray(raw) ? raw : [raw]) {
    if (value === true || value === 'true') {
      out.add(own);
      continue;
    }
    const v = String(value).replace(/^\[\[|\]\]$/g, '').trim();
    if (!v) continue;
    const path = v.split(/\s*(?:\/|›|>)\s*/).filter(Boolean).map(slugify).join('/');
    const hit = slugs.find((s) => s === path) ?? slugs.find((s) => s.split('/').pop() === path);
    if (hit) out.add(hit);
    else console.warn(`[vault] ${id}：categoryPinned 中的「${v}」不是这篇文章所属的分类或其上级分类，已忽略`);
  }
  return [...out];
}

function parseFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const src = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const m = src.match(/^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return { data: {}, body: src };
  let data: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(m[1]);
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>;
  } catch (e) {
    console.warn(`[vault] frontmatter 解析失败：${(e as Error).message}`);
  }
  return { data, body: src.slice(m[0].length) };
}

function walk(dir: string, rel = '', out: { notes: string[]; files: string[] } = { notes: [], files: [] }) {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  const exclude = new Set(siteConfig.content.excludeDirs);
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    const abs = path.join(dir, e.name);
    let isDir = e.isDirectory();
    let isFile = e.isFile();
    if (e.isSymbolicLink()) {
      try {
        const st = fs.statSync(abs);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        continue;
      }
    }
    if (isDir) {
      if (e.name === 'node_modules') continue;
      // 被排除的目录里的附件依然可以被引用，但其中的笔记不会发布
      const before = out.notes.length;
      walk(abs, r, out);
      if (e.name.startsWith('_') || exclude.has(e.name)) out.notes.length = before;
    } else if (isFile) {
      if (e.name.toLowerCase().endsWith('.md')) out.notes.push(r);
      else if (!e.name.endsWith('.canvas')) out.files.push(r);
    }
  }
  return out;
}

function buildVault(): Vault {
  const { notes: noteFiles, files } = walk(VAULT_ROOT);
  const pagesConfig = siteConfig.content.pages;
  const usedSlugs = new Set<string>();
  const notes: Note[] = [];

  for (const rel of noteFiles.sort()) {
    const file = path.join(VAULT_ROOT, rel);
    const raw = fs.readFileSync(file, 'utf8');
    const { data: fm, body } = parseFrontmatter(raw);
    const id = rel.replace(/\.md$/i, '');
    const name = path.posix.basename(id);
    const draft = fm.draft === true || fm.publish === false || fm.published === false;
    if (draft && !IS_DEV) continue;

    const pageRoute = pagesConfig[id];
    const kind: Note['kind'] = pageRoute ? 'page' : 'post';

    const h1 = body.match(/^\s*#\s+(.+?)\s*#*\s*$/m);
    const firstBlockIsH1 = h1 && body.slice(0, h1.index).trim() === '';
    const title = String(fm.title ?? (firstBlockIsH1 ? h1![1] : name)).trim();

    let slug = slugify(String(fm.slug ?? fm.permalink ?? name));
    if (usedSlugs.has(slug)) {
      const dir = path.posix.dirname(id);
      slug = slugify(`${dir === '.' ? '' : dir.split('/').pop() + '-'}${slug}`);
      let i = 2;
      while (usedSlugs.has(slug)) slug = `${slug}-${i++}`;
    }
    usedSlugs.add(slug);

    const categoryPath = resolveCategoryPath(fm, id);
    const categorySlugs = categoryPath.map((_, i) => categoryPath.slice(0, i + 1).map(slugify).join('/'));

    const fmTags = toList(fm.tags ?? fm.tag).map((t) => t.replace(/^#/, ''));
    const tags = dedupeCaseInsensitive([...fmTags, ...extractInlineTags(body)]);

    let date = parseDate(fm.date ?? fm.created ?? fm.published_at ?? fm.pubDate);
    const stat = fs.statSync(file);
    if (!date) date = stat.birthtime && +stat.birthtime > 0 ? stat.birthtime : stat.mtime;
    const updated = parseDate(fm.updated ?? fm.modified ?? fm.lastmod ?? fm.updated_at);

    const plain = markdownToPlain(body);
    notes.push({
      id,
      file,
      name,
      slug,
      url: pageRoute ? withBase(pageRoute) : withBase(`/posts/${slug}/`),
      kind,
      title,
      frontmatter: fm,
      body,
      category: categoryPath[0],
      categoryPath,
      categorySlug: categorySlugs[categorySlugs.length - 1],
      categorySlugs,
      categoryLabel: categoryPath.join(' › '),
      tags,
      aliases: toList(fm.aliases ?? fm.alias),
      date,
      updated: updated && +updated !== +date ? updated : undefined,
      draft,
      pinned: fm.pinned === true || fm.pin === true || fm.sticky === true,
      pinnedIn: resolveCategoryPins(fm.categoryPinned, categorySlugs, id),
      description: String(fm.description ?? fm.summary ?? fm.excerpt ?? excerpt(body)).trim(),
      lede: String(fm.description ?? fm.summary ?? '').trim() || undefined,
      cover: typeof (fm.cover ?? fm.image ?? fm.banner) === 'string' ? String(fm.cover ?? fm.image ?? fm.banner) : undefined,
      cssclasses: toList(fm.cssclasses ?? fm.cssclass),
      words: countWords(plain),
      minutes: readingMinutes(plain),
      links: [],
    });
  }

  const attachments: Attachment[] = files.map((rel) => {
    const outPath = rel.replace(/\s+/g, '-');
    return {
      file: path.join(VAULT_ROOT, rel),
      rel,
      name: path.posix.basename(rel),
      ext: path.extname(rel).toLowerCase(),
      outPath,
      url: withBase('/attachments/' + outPath.split('/').map(encodeURIComponent).join('/')),
    };
  });

  return new Vault(notes, attachments);
}

function dedupeCaseInsensitive(list: string[]): string[] {
  const seen = new Set<string>();
  return list.filter((t) => {
    const k = t.toLowerCase();
    if (!t || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ---------- 缓存：构建时只扫描一次；开发时文件变化后重建 ---------- */

let cache: { vault: Vault; version: number; signature: string; checkedAt: number } | undefined;
const listeners = new Set<() => void>();

/** 注册在仓库重建时调用的回调（用于清空渲染缓存） */
export function onVaultRebuild(fn: () => void) {
  listeners.add(fn);
}

function signature(): string {
  const { notes, files } = walk(VAULT_ROOT);
  return [...notes, ...files]
    .map((r) => {
      try {
        return r + ':' + fs.statSync(path.join(VAULT_ROOT, r)).mtimeMs;
      } catch {
        return r;
      }
    })
    .join('|');
}

export function getVault(): Vault {
  const version = (globalThis as { __VAULT_VERSION__?: number }).__VAULT_VERSION__ ?? 0;
  if (cache && !IS_DEV) return cache.vault;
  if (cache && IS_DEV) {
    if (cache.version === version && Date.now() - cache.checkedAt < 1500) return cache.vault;
    const sig = signature();
    if (sig === cache.signature) {
      cache.version = version;
      cache.checkedAt = Date.now();
      return cache.vault;
    }
  }
  const vault = buildVault();
  cache = { vault, version, signature: IS_DEV ? signature() : '', checkedAt: Date.now() };
  for (const fn of listeners) fn();
  return vault;
}

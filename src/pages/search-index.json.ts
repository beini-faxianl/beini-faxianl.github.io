import type { APIRoute } from 'astro';
import { getVault } from '../lib/vault';
import { markdownToPlain } from '../lib/utils';

/** 全文搜索索引：包含每篇文章的完整纯文本（含代码），在客户端做子串匹配，中英文都适用 */
export const GET: APIRoute = () => {
  const vault = getVault();
  const posts = [...vault.chronological, ...vault.pages].map((p) => ({
    t: p.title,
    u: p.url,
    c: p.kind === 'page' ? '页面' : p.categoryLabel,
    k: p.kind,
    g: p.tags,
    d: p.date.toISOString(),
    e: p.description,
    x: markdownToPlain(p.body, true),
  }));
  const tags = vault.tags().map((t) => ({ name: t.name, count: t.posts.length }));
  return new Response(JSON.stringify({ posts, tags }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};

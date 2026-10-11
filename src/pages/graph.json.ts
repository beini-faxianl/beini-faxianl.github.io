import type { APIRoute } from 'astro';
import { getVault } from '../lib/vault';

/** 关系图谱数据：文章为节点，[[双链]] 为边 */
export const GET: APIRoute = () => {
  const vault = getVault();
  const categories = vault.categories().map((c) => c.name);
  const nodes = vault.posts.map((p) => ({
    id: p.slug,
    title: p.title,
    url: p.url,
    category: p.category,
    group: categories.indexOf(p.category),
  }));
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const links: { source: string; target: string }[] = [];
  for (const p of vault.posts) {
    for (const id of p.links) {
      const t = vault.byId.get(id);
      if (!t || !ids.has(t.slug)) continue;
      const key = [p.slug, t.slug].sort().join('→');
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ source: p.slug, target: t.slug });
    }
  }
  return new Response(JSON.stringify({ nodes, links, categories }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};

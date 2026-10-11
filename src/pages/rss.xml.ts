import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { siteConfig } from '../../site.config';
import { getVault } from '../lib/vault';
import { renderNote } from '../lib/markdown';

export async function GET(context: APIContext) {
  const vault = getVault();
  const site = context.site ?? new URL(siteConfig.url);
  const absolutize = (html: string) => html.replace(/(href|src)="\/(?!\/)/g, `$1="${site.origin}/`);

  const items = await Promise.all(
    vault.chronological.slice(0, 30).map(async (p) => ({
      title: p.title,
      link: new URL(p.url, site).href,
      pubDate: p.date,
      description: p.description,
      categories: [...p.categoryPath, ...p.tags],
      content: absolutize((await renderNote(p)).html),
    })),
  );

  return rss({
    title: siteConfig.title,
    description: siteConfig.description,
    site,
    items,
    customData: `<language>${siteConfig.lang.toLowerCase()}</language>`,
  });
}

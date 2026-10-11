import type { APIRoute } from 'astro';
import { siteConfig } from '../../site.config';
import { withBase } from '../lib/utils';

/** Web App Manifest：添加到主屏幕时使用的名称、图标与颜色 */
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify({
      name: siteConfig.title,
      short_name: siteConfig.title,
      description: siteConfig.description,
      lang: siteConfig.lang,
      start_url: withBase('/'),
      scope: withBase('/'),
      display: 'standalone',
      background_color: '#faf9f5',
      theme_color: '#faf9f5',
      icons: [
        { src: withBase('/icon-192.png'), sizes: '192x192', type: 'image/png' },
        { src: withBase('/icon-512.png'), sizes: '512x512', type: 'image/png' },
        { src: withBase('/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        { src: withBase('/favicon.svg'), sizes: 'any', type: 'image/svg+xml' },
      ],
    }),
    { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } },
  );

import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import path from 'node:path';
import type { Plugin } from 'vite';
import { siteConfig } from './site.config';

const contentDir = path.resolve(process.env.VAULT_DIR || siteConfig.content.dir);

/**
 * 开发模式下监听 Obsidian 仓库：文章改动后刷新浏览器。
 * vault.ts 通过 globalThis 上的版本号判断是否需要重新扫描。
 */
function vaultWatcher(): Plugin {
  return {
    name: 'vault-watcher',
    configureServer(server) {
      server.watcher.add(contentDir);
      const onChange = (file: string) => {
        if (!path.resolve(file).startsWith(contentDir)) return;
        const g = globalThis as { __VAULT_VERSION__?: number };
        g.__VAULT_VERSION__ = (g.__VAULT_VERSION__ ?? 0) + 1;
        // 让 Astro 清空 getStaticPaths() 缓存，否则运行中新增的笔记 / 图片会 404，直到重启
        for (const [name, env] of Object.entries(server.environments)) {
          if (name !== 'client') env.hot.send('astro:content-changed', {});
        }
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('change', onChange);
      server.watcher.on('add', onChange);
      server.watcher.on('unlink', onChange);
    },
  };
}

export default defineConfig({
  // 环境变量优先：GitHub Actions 工作流会自动注入 Pages 的域名与子路径
  site: process.env.SITE_URL || siteConfig.url,
  base: process.env.BASE_PATH || siteConfig.base,
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  devToolbar: { enabled: false },
  vite: {
    plugins: [vaultWatcher()],
    // 这些库只在用到时才动态加载（如含图表的页面才加载 Mermaid）。
    // 开发模式下若不预构建，Vite 会在运行中途才优化它们，导致版本号失配、模块加载失败（504）。
    optimizeDeps: {
      include: ['mermaid', 'd3-force', 'perfect-freehand'],
    },
    // Mermaid 体积较大，但只在含图表的页面按需加载
    build: { chunkSizeWarningLimit: 3000 },
  },
});

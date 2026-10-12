/**
 * 站点配置 —— 个性化你的博客只需要修改这个文件。
 */
export const siteConfig = {
  /** 站点标题（显示在页眉、浏览器标签、RSS） */
  title: '拾光',
  /** 一句话描述（SEO 与 RSS） */
  description: '记录思考、技术与生活的个人博客。',
  /** 作者 */
  author: '谁把我灯关了',
  /** 作者一句话简介（显示在关于页、文章末尾的作者卡片） */
  bio: '网安小白，幻想着成为一名大佬。',
  /**
   * 头像：放在 public/ 目录下的图片路径（如 '/avatar.jpg'）或图片网址。
   * 留空则使用名字的第一个字作为头像。
   */
  avatar: '/me.png',
  /** 语言 */
  lang: 'zh-CN',
  /**
   * 正式部署的域名（用于 RSS、sitemap、canonical 链接）。
   * 例如 GitHub Pages：'https://username.github.io'
   */
  url: 'https://example.com',
  /**
   * 部署在子路径时填写，如 GitHub Pages 项目站点 '/blog'；部署在根域名时保持 '/'。
   * 也可以通过环境变量 BASE_PATH 覆盖。
   */
  base: '/',

  /** 首页 Hero 区域 */
  hero: {
    /** 用 [[双中括号]] 包裹的词语会显示品牌色下划线 */
    headline: '夫君子之行，静以修身，俭以养德。非淡泊无以明志，非宁静无以致远。',
    intro:
      '(｡･∀･)ﾉﾞ嗨，这里是我的数字花园，欢迎随意逛逛。',
  },

  /** 社交链接（留空则不显示） */
  social: {
    github: 'https://github.com/beini-faxianl',
    email: '1436319009@qq.com',
    twitter: '',
  },

  /** 顶部导航 */
  nav: [
    { label: '文章', href: '/' },
    { label: '分类', href: '/categories/' },
    { label: '标签', href: '/tags/' },
    { label: '归档', href: '/archive/' },
    { label: '图谱', href: '/graph/' },
    { label: '关于', href: '/about/' },
  ],

  /** 内容（Obsidian 仓库）设置 */
  content: {
    /**
     * Obsidian 仓库目录：相对项目根目录的路径，或绝对路径（例如 'D:/Obsidian/我的仓库/博客'）。
     * 也可以用环境变量 VAULT_DIR 临时指定。
     */
    dir: 'content',
    /** 不发布的目录（任何以 . 或 _ 开头的目录也会被忽略） */
    excludeDirs: ['templates', 'Templates', '模板'],
    /** 渲染为独立页面（而非文章）的笔记：文件名 -> 路由 */
    pages: { about: '/about/' } as Record<string, string>,
    /**
     * 分类 = 文章所在的文件夹层级：content/技术/前端/x.md → 技术 › 前端（父分类包含子分类的文章）。
     * 也可在 frontmatter 中用 `category: 技术/前端` 指定。根目录下的文章归入 defaultCategory。
     */
    defaultCategory: '未分类',
    /** 分类最多取几层文件夹（0 = 不限制）。例如设为 2，则 技术/前端/框架/x.md 归入 技术 › 前端 */
    categoryDepth: 0,
    /** Obsidian 默认把单个换行渲染为换行（关闭了“严格换行”）。如果你开启了严格换行，改为 true */
    strictLineBreaks: false,
  },

  /** 代码高亮主题（任意 Shiki 主题名） */
  code: {
    lightTheme: 'vitesse-light',
    darkTheme: 'vitesse-dark',
    /** 超过多少行的代码块默认折叠 */
    collapseLines: 28,
    /** 是否默认显示行号（单个代码块可用 ln:true / ln:false 覆盖） */
    lineNumbers: false,
    /**
     * 代码块的自定义高亮颜色（对应 Codeblock Customizer 插件的 Alternative highlight colors）。
     * 用法：```js info:2 warn:4-6 error:8```；名称后加 t 表示文本高亮，如 errort:5|foo。
     * 默认的 hl: / hlt: 使用主题色。可增删颜色名，值为任意 CSS 颜色。
     */
    highlightColors: {
      info: '#6a9bcc',
      warn: '#f0ac54',
      error: '#de6262',
    } as Record<string, string>,
  },

  /** 每页显示的文章数（首页“加载更多”） */
  pageSize: 12,

  /** 文章版权声明，显示在每篇文章末尾；不需要时设为 null */
  license: {
    name: 'CC BY-NC-SA 4.0',
    url: 'https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans',
  } as { name: string; url: string } | null,

  /** 文章最后更新超过多少天后，在开头提示“内容可能已过时”（0 = 不提示） */
  outdatedDays: 365,

  /**
   * 额外插入到每个页面 <head> 中的 HTML，例如网站统计代码（Umami、Plausible、Google Analytics 等）。
   * 示例：'<script defer src="https://cloud.umami.is/script.js" data-website-id="xxxx"></script>'
   */
  head: '',

  /**
   * Giscus 评论（基于 GitHub Discussions）。到 https://giscus.app 生成参数后填入，
   * repo 留空则不显示评论区。
   */
  giscus: {
    repo: '',
    repoId: '',
    category: '',
    categoryId: '',
    mapping: 'pathname',
    lang: 'zh-CN',
  },
};

export type SiteConfig = typeof siteConfig;

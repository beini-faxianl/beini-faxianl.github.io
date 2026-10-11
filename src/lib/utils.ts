/** 拼接站点 base 路径（支持部署在子路径，如 GitHub Pages 项目站点） */
export function withBase(p: string): string {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(p)) return p;
  const base = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '');
  return base + (p.startsWith('/') ? p : '/' + p);
}

/** 生成 URL 友好的 slug：保留中文等 Unicode 字母，去掉 URL 中有特殊含义的字符 */
export function slugify(input: string): string {
  const s = input
    .normalize('NFC')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/[?#%\\/:*"<>|'`^{}[\]&=+@!$,;~()（）【】《》「」『』，。？！：；、]+/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return s || 'untitled';
}

/** 解析 frontmatter 中的日期。没有时区的日期按 UTC 解析，展示时也用 UTC，保证“写什么显示什么”。 */
export function parseDate(v: unknown): Date | undefined {
  if (v instanceof Date) return isNaN(+v) ? undefined : v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) {
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0)));
  }
  const d = new Date(s);
  return isNaN(+d) ? undefined : d;
}

const pad = (n: number) => String(n).padStart(2, '0');

export function formatDate(d: Date, style: 'full' | 'short' | 'month-day' | 'iso' = 'full'): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  switch (style) {
    case 'iso':
      return `${y}-${pad(m)}-${pad(day)}`;
    case 'short':
      return `${y}.${pad(m)}.${pad(day)}`;
    case 'month-day':
      return `${pad(m)}-${pad(day)}`;
    default:
      return `${y} 年 ${m} 月 ${day} 日`;
  }
}

const CJK_RE = /[㐀-鿿豈-﫿぀-ヿ가-힯]/g;

/** 统计字数：中日韩字符按字计，其它按单词计 */
export function countWords(text: string): number {
  const cjk = (text.match(CJK_RE) || []).length;
  const latin = text.replace(CJK_RE, ' ').match(/[A-Za-z0-9À-ɏ]+(?:['’-][A-Za-z0-9À-ɏ]+)*/g) || [];
  return cjk + latin.length;
}

/** 阅读时长（分钟）：中文约 400 字/分钟，英文约 220 词/分钟 */
export function readingMinutes(text: string): number {
  const cjk = (text.match(CJK_RE) || []).length;
  const latin = (text.replace(CJK_RE, ' ').match(/[A-Za-z0-9]+/g) || []).length;
  return Math.max(1, Math.round(cjk / 400 + latin / 220));
}

export function formatCount(n: number): string {
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, '') + ' 万';
  return n.toLocaleString('zh-CN');
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** 去掉 Obsidian 注释 %%…%%（跳过代码块与行内代码） */
export function stripObsidianComments(src: string): string {
  const lines = src.split('\n');
  const out: string[] = [];
  let fence: string | null = null;
  let inComment = false;

  for (const line of lines) {
    if (!inComment) {
      const fm = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (fence) {
        if (fm && fm[1][0] === fence[0] && fm[1].length >= fence.length && line.trim() === fm[1]) fence = null;
        out.push(line);
        continue;
      }
      if (fm) {
        fence = fm[1];
        out.push(line);
        continue;
      }
    }

    let result = '';
    let touched = inComment;
    let i = 0;
    while (i < line.length) {
      if (inComment) {
        const end = line.indexOf('%%', i);
        if (end === -1) {
          i = line.length;
        } else {
          inComment = false;
          i = end + 2;
        }
        continue;
      }
      const ch = line[i];
      if (ch === '`') {
        // 行内代码：找到同样长度的反引号串
        let n = 1;
        while (line[i + n] === '`') n++;
        const tick = '`'.repeat(n);
        const close = line.indexOf(tick, i + n);
        if (close !== -1) {
          result += line.slice(i, close + n);
          i = close + n;
          continue;
        }
        result += line.slice(i, i + n);
        i += n;
        continue;
      }
      if (ch === '%' && line[i + 1] === '%') {
        inComment = true;
        touched = true;
        i += 2;
        continue;
      }
      result += ch;
      i++;
    }
    // 整行都在注释里 → 删除这一行，避免产生多余空行
    if (touched && !result.trim()) continue;
    out.push(result);
  }
  return out.join('\n');
}

/**
 * 快速把 Obsidian Markdown 转为纯文本（用于摘要、字数统计、全文搜索索引）。
 * keepCode=true 时保留代码块内容（搜索需要），否则移除（摘要不需要）。
 */
export function markdownToPlain(md: string, keepCode = false): string {
  let s = stripObsidianComments(md);
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/^( {0,3})(`{3,}|~{3,})[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm, (_m, _i, _f, code: string) =>
    keepCode ? '\n' + code + '\n' : '\n',
  );
  s = s.replace(/\$\$([\s\S]*?)\$\$/g, (_m, tex: string) => (keepCode ? tex : ' '));
  s = s
    .replace(/^\s*>+\s*\[![^\]]+\][+-]?\s*/gm, '') // callout 头
    .replace(/^\s*>+ ?/gm, '') // 引用
    .replace(/^#{1,6}\s+/gm, '') // 标题
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[.\]\s+)?/gm, '') // 列表、任务
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '') // 表格分隔行
    .replace(/\|/g, ' ')
    .replace(/^\[\^[^\]]+\]:\s*/gm, '') // 脚注定义
    .replace(/!\[\[[^\]]*\]\]/g, '') // 嵌入
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2') // [[a|b]]
    .replace(/\[\[([^\]]+)\]\]/g, (_m, t: string) => t.replace(/#\^?/, ' › ').split('/').pop()!)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接
    .replace(/\^\[([^\]]*)\]/g, '（$1）') // 行内脚注
    .replace(/\[\^[^\]]+\]/g, '') // 脚注引用
    .replace(/\s\^[A-Za-z0-9-]+$/gm, '') // 块 ID
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__|~~|==|\*)/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\$([^$\n]+)\$/g, '$1')
    .replace(/^-{3,}$/gm, '');
  return s.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
}

export function excerpt(md: string, max = 140): string {
  const plain = markdownToPlain(md).replace(/\n+/g, ' ');
  if (plain.length <= max) return plain;
  let cut = plain.slice(0, max);
  // 尽量在最后一个标点处截断（仅当不会损失太多内容时）
  const m = cut.match(/^[\s\S]*[\s,，。.、;；:：!！?？]/);
  if (m && m[0].length > max * 0.7) cut = m[0].replace(/[\s,，、;；:：]+$/, '');
  return cut + '…';
}

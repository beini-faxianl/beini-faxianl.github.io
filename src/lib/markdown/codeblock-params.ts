/**
 * 解析代码块首行的参数，语法与 Obsidian 插件 Codeblock Customizer 一致：
 *
 *   ```js file:"app.js" ln:true hl:1,3-5,foo,7|bar info:2 warn:4-6 error:8 hlt:5|print fold
 *
 * - hl:      行高亮：行号 5、范围 5-7、含某个词的行 test、指定行中含某个词 5|test / 5-7|test
 * - <颜色名>: 用自定义颜色做行高亮（颜色名在 site.config.ts 的 code.highlightColors 中定义，如 info / warn / error）
 * - hlt:     文本高亮：test、整行 5、5|print、6-7|print、:xyz（行首到 xyz）、abc:（abc 到行尾）、abc:xyz，
 *            以及第几处 5[2,5-8,-1]|test（负数从末尾数起）
 * - <颜色名>t: 用自定义颜色做文本高亮，如 errort:5|foo
 * - file: / title:  代码块标题（含空格时加引号：file:"long name.cpp"；两者都写时以 file 为准）
 * - fold:    默认折叠
 * - ln:      ln:true / ln:false 显示或隐藏行号，ln:5 从 5 开始编号
 * - exclude: 不对这个代码块应用任何参数
 * 参数名与值之间可以用 : 或 =。
 */

export interface TextRange {
  start: number;
  end: number;
  color: string;
}

export interface CodeParams {
  exclude: boolean;
  title?: string;
  fold: boolean;
  /** undefined 表示使用全局默认 */
  lineNumbers?: boolean;
  lineStart: number;
  /** 行号（从 1 开始） → 高亮颜色 */
  lineHl: Map<number, string>;
  /** 行号（从 1 开始） → 需要高亮的文字区间 */
  textHl: Map<number, TextRange[]>;
}

/** 默认高亮色（品牌陶土色） */
export const DEFAULT_HL = 'var(--accent)';

interface Token {
  name: string;
  value?: string;
}

/** 把参数字符串切成 name[:=]value，支持带引号与转义的值 */
export function tokenize(meta: string): Token[] {
  const out: Token[] = [];
  const re = /([A-Za-z][\w-]*)(?:[:=]("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S*))?/g;
  for (const m of meta.matchAll(re)) {
    // 只接受位于开头或空白之后的参数名，避免把值里的片段误认为参数
    if (m.index! > 0 && !/\s/.test(meta[m.index! - 1])) continue;
    let value = m[2];
    if (value != null && /^(["']).*\1$/s.test(value)) value = value.slice(1, -1).replace(/\\(["'\\])/g, '$1');
    out.push({ name: m[1], value });
  }
  return out;
}

/** 按逗号切分，但忽略方括号内的逗号（用于 hlt 的 [2,5-8] 写法） */
function splitItems(value: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '[') depth++;
    if (ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      items.push(cur);
      cur = '';
    } else cur += ch;
  }
  items.push(cur);
  return items.map((s) => s.trim()).filter(Boolean);
}

function lineRange(spec: string, total: number): number[] {
  const m = spec.match(/^(\d+)(?:-(\d+))?$/);
  if (!m) return [];
  const a = Math.max(1, Number(m[1]));
  const b = Math.min(total, Number(m[2] ?? m[1]));
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

function allLines(total: number): number[] {
  return Array.from({ length: total }, (_, i) => i + 1);
}

/** 行高亮：5、5-7、test、5|test、5-7|test */
function applyLineSpec(value: string, lines: string[], color: string, target: Map<number, string>) {
  for (const item of splitItems(value)) {
    const withWord = item.match(/^(\d+(?:-\d+)?)\|(.+)$/);
    let picked: number[];
    if (withWord) picked = lineRange(withWord[1], lines.length).filter((n) => lines[n - 1].includes(withWord[2]));
    else if (/^\d+(?:-\d+)?$/.test(item)) picked = lineRange(item, lines.length);
    else picked = allLines(lines.length).filter((n) => lines[n - 1].includes(item));
    for (const n of picked) target.set(n, color);
  }
}

/** 某一行中某个模式的所有命中区间：test、:xyz、abc:、abc:xyz */
function matchPattern(line: string, pattern: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const sep = pattern.indexOf(':');
  if (sep === -1) {
    if (!pattern) return out;
    let i = line.indexOf(pattern);
    while (i !== -1) {
      out.push([i, i + pattern.length]);
      i = line.indexOf(pattern, i + pattern.length);
    }
    return out;
  }
  const from = pattern.slice(0, sep);
  const to = pattern.slice(sep + 1);
  if (!from && !to) return out;
  if (!from) {
    const j = line.indexOf(to);
    if (j !== -1) out.push([0, j + to.length]);
    return out;
  }
  let i = line.indexOf(from);
  while (i !== -1) {
    if (!to) {
      out.push([i, line.length]);
      break;
    }
    const j = line.indexOf(to, i + from.length);
    if (j === -1) break;
    out.push([i, j + to.length]);
    i = line.indexOf(from, j + to.length);
  }
  return out;
}

/** 第几处命中：[2,5-8,-1]（从 1 开始，负数从末尾数起） */
function pickOccurrences<T>(list: T[], spec: string | undefined): T[] {
  if (!spec) return list;
  const keep = new Set<number>();
  for (const part of spec.split(',').map((s) => s.trim())) {
    const m = part.match(/^(-?\d+)(?:-(-?\d+))?$/);
    if (!m) continue;
    const norm = (n: number) => (n < 0 ? list.length + n + 1 : n);
    const a = norm(Number(m[1]));
    const b = norm(Number(m[2] ?? m[1]));
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) keep.add(i);
  }
  return list.filter((_, i) => keep.has(i + 1));
}

/** 文本高亮：test、5、5|print、6-7|print、5[2,-1]|test、:xyz、abc:、abc:xyz */
function applyTextSpec(value: string, lines: string[], color: string, target: Map<number, TextRange[]>) {
  const add = (n: number, start: number, end: number) => {
    if (end <= start) return;
    const list = target.get(n) ?? [];
    list.push({ start, end, color });
    target.set(n, list);
  };
  for (const item of splitItems(value)) {
    const m = item.match(/^(\d+(?:-\d+)?)(?:\[([^\]]*)\])?(?:\|(.*))?$/);
    if (m && m[3] == null && m[2] == null) {
      // hlt:5 —— 整行文字（跳过行首缩进）
      for (const n of lineRange(m[1], lines.length)) {
        const line = lines[n - 1];
        add(n, line.length - line.trimStart().length, line.trimEnd().length);
      }
      continue;
    }
    const nums = m ? lineRange(m[1], lines.length) : allLines(lines.length);
    const pattern = m ? (m[3] ?? '') : item;
    for (const n of nums) {
      for (const [s, e] of pickOccurrences(matchPattern(lines[n - 1], pattern), m?.[2])) add(n, s, e);
    }
  }
}

/** 合并同一行中重叠的区间（Shiki 的 decorations 不允许交叉） */
export function mergeRanges(list: TextRange[]): TextRange[] {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  const out: TextRange[] = [];
  for (const r of sorted) {
    const last = out[out.length - 1];
    if (last && r.start < last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export function parseCodeParams(meta: string, source: string, colors: Record<string, string>): CodeParams {
  const lines = source.split('\n');
  const params: CodeParams = { exclude: false, fold: false, lineStart: 1, lineHl: new Map(), textHl: new Map() };
  const tokens = tokenize(meta);
  if (tokens.some((t) => t.name.toLowerCase() === 'exclude')) return { ...params, exclude: true };

  let file: string | undefined;
  let title: string | undefined;
  for (const { name, value } of tokens) {
    const key = name.toLowerCase();
    if (key === 'file' || key === 'filename') file = value;
    else if (key === 'title') title = value;
    else if (key === 'fold') params.fold = true;
    else if (key === 'ln') {
      if (value === 'false') params.lineNumbers = false;
      else if (value === 'true' || value === undefined || value === '') params.lineNumbers = true;
      else if (/^\d+/.test(value)) {
        params.lineNumbers = true;
        params.lineStart = Number(value.match(/^\d+/)![0]);
      }
    } else if (key === 'showlinenumbers' || key === 'linenumbers') params.lineNumbers = true;
    else if (!value) continue;
    else if (key === 'hl') applyLineSpec(value, lines, DEFAULT_HL, params.lineHl);
    else if (key === 'hlt') applyTextSpec(value, lines, DEFAULT_HL, params.textHl);
    else if (colors[name]) applyLineSpec(value, lines, colors[name], params.lineHl);
    else if (name.endsWith('t') && colors[name.slice(0, -1)]) applyTextSpec(value, lines, colors[name.slice(0, -1)], params.textHl);
  }
  params.title = file || title || undefined;
  for (const [n, list] of params.textHl) params.textHl.set(n, mergeRanges(list));
  return params;
}

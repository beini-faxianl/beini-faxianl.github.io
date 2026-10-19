import { icon } from '../lib/icons';

interface Doc {
  /** title */ t: string;
  /** url */ u: string;
  /** category */ c: string;
  /** tags */ g: string[];
  /** date (iso) */ d: string;
  /** excerpt */ e: string;
  /** full plain text */ x: string;
  /** kind: post | page */ k?: string;
}
interface Prepared extends Doc {
  tl: string;
  xl: string;
  cl: string;
  gl: string[];
}
interface Result {
  doc: Prepared;
  score: number;
  hit: number;
  hitTerm: string;
}

let docs: Prepared[] | null = null;
let loading: Promise<Prepared[]> | null = null;
let tagsCache: { name: string; count: number }[] = [];

function load(url: string): Promise<Prepared[]> {
  loading ??= fetch(url)
    .then((r) => r.json())
    .then((data: { posts: Doc[]; tags: { name: string; count: number }[] }) => {
      tagsCache = data.tags ?? [];
      docs = data.posts.map((d) => ({
        ...d,
        tl: d.t.toLowerCase(),
        xl: d.x.toLowerCase(),
        cl: d.c.toLowerCase(),
        gl: d.g.map((g) => g.toLowerCase()),
      }));
      return docs;
    })
    .catch((err) => {
      loading = null;
      throw err;
    });
  return loading;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseQuery(q: string) {
  const parts = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return {
    tags: parts.filter((p) => p.startsWith('#') && p.length > 1).map((p) => p.slice(1)),
    terms: parts.filter((p) => !p.startsWith('#')),
  };
}

function count(hay: string, needle: string, max = 20) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1 && n < max) {
    n++;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

export function runSearch(all: Prepared[], q: string): Result[] {
  const { tags, terms } = parseQuery(q);
  if (!tags.length && !terms.length) return [];
  const out: Result[] = [];
  for (const doc of all) {
    if (tags.length && !tags.every((t) => doc.gl.some((g) => g === t || g.startsWith(t + '/') || g.includes(t)))) continue;
    let score = tags.length * 12;
    let hit = -1;
    let hitTerm = '';
    let ok = true;
    for (const term of terms) {
      const it = doc.tl.indexOf(term);
      const ig = doc.gl.some((g) => g.includes(term));
      const ic = doc.cl.includes(term);
      const ix = doc.xl.indexOf(term);
      if (it < 0 && !ig && !ic && ix < 0) {
        ok = false;
        break;
      }
      if (it >= 0) score += 40 + (it === 0 ? 15 : 0) + (doc.tl === term ? 30 : 0);
      if (ig) score += 14;
      if (ic) score += 8;
      if (ix >= 0) {
        score += 6 + Math.min(14, count(doc.xl, term));
        if (hit < 0 || ix < hit) {
          hit = ix;
          hitTerm = term;
        }
      }
    }
    if (ok) out.push({ doc, score, hit, hitTerm });
  }
  return out.sort((a, b) => b.score - a.score || b.doc.d.localeCompare(a.doc.d)).slice(0, 40);
}

function highlight(text: string, terms: string[]) {
  const safe = escapeHtml(text);
  const ts = terms.filter(Boolean).map((t) => escapeRe(escapeHtml(t)));
  if (!ts.length) return safe;
  return safe.replace(new RegExp(`(${ts.join('|')})`, 'gi'), '<mark>$1</mark>');
}

function snippet(r: Result, terms: string[]) {
  if (r.hit < 0) return highlight(r.doc.e, terms);
  const x = r.doc.x;
  const start = Math.max(0, r.hit - 36);
  const end = Math.min(x.length, r.hit + r.hitTerm.length + 90);
  const text = (start > 0 ? '…' : '') + x.slice(start, end).replace(/\s+/g, ' ') + (end < x.length ? '…' : '');
  return highlight(text, terms);
}

function formatDate(iso: string) {
  return iso.slice(0, 10).replace(/-/g, '.');
}

/** 最近搜索（仅保存在本机） */
const recentQueries = {
  key: 'recent-searches',
  get(): string[] {
    try {
      const v = JSON.parse(localStorage.getItem(this.key) ?? '[]');
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 6) : [];
    } catch {
      return [];
    }
  },
  add(q: string) {
    const query = q.trim();
    if (!query) return;
    try {
      localStorage.setItem(this.key, JSON.stringify([query, ...this.get().filter((x) => x !== query)].slice(0, 6)));
    } catch {
      /* ignore */
    }
  },
  clear() {
    try {
      localStorage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  },
};

export function initSearch() {
  const modal = document.querySelector<HTMLElement>('[data-search-modal]');
  if (!modal) return;
  const input = modal.querySelector<HTMLInputElement>('[data-search-input]')!;
  const body = modal.querySelector<HTMLElement>('[data-search-results]')!;
  const stat = modal.querySelector<HTMLElement>('[data-search-stat]')!;
  const url = modal.dataset.indexUrl!;
  let selected = 0;
  let lastFocus: Element | null = null;
  let timer: number | undefined;

  const items = () => [...body.querySelectorAll<HTMLAnchorElement>('.search-result')];
  const select = (i: number) => {
    const list = items();
    if (!list.length) return;
    selected = (i + list.length) % list.length;
    list.forEach((el, k) => el.setAttribute('aria-selected', String(k === selected)));
    list[selected].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', list[selected].id);
  };

  const renderEmpty = () => {
    if (!docs) return;
    const recent = docs
      .filter((d) => d.k !== 'page')
      .sort((a, b) => b.d.localeCompare(a.d))
      .slice(0, 5);
    const tags = tagsCache.slice(0, 14);
    const history = recentQueries.get();
    body.innerHTML =
      (history.length
        ? `<div class="search-group-label">最近搜索<button type="button" class="search-clear" data-clear-history>清除</button></div><div class="search-tags">${history
            .map((q) => `<button type="button" class="chip" data-query="${escapeHtml(q)}" title="${escapeHtml(q)}">${icon('clock', 13)}<span class="chip-label">${escapeHtml(q)}</span></button>`)
            .join('')}</div>`
        : '') +
      `<div class="search-group-label">最近更新</div>` +
      recent
        .map(
          (d, i) => `<a class="search-result" role="option" id="sr-${i}" href="${d.u}">
            <div class="search-result-title"><span>${escapeHtml(d.t)}</span><span class="arrow">${icon('enter', 15)}</span></div>
            <div class="search-result-meta">${escapeHtml(d.c)} · ${formatDate(d.d)}</div></a>`,
        )
        .join('') +
      (tags.length
        ? `<div class="search-group-label">标签</div><div class="search-tags">${tags
            .map((t) => `<button type="button" class="chip" data-tag="${escapeHtml(t.name)}" title="#${escapeHtml(t.name)}"><span class="chip-label">#${escapeHtml(t.name)}</span> <span class="count">${t.count}</span></button>`)
            .join('')}</div>`
        : '');
    stat.textContent = `共 ${docs.length} 篇文章`;
    select(0);
  };

  const render = () => {
    if (!docs) return;
    const q = input.value;
    if (!q.trim()) return renderEmpty();
    const results = runSearch(docs, q);
    const { terms, tags } = parseQuery(q);
    if (!results.length) {
      body.innerHTML = `<div class="search-empty">没有找到与 “${escapeHtml(q.trim())}” 相关的内容</div>`;
      stat.textContent = '';
      return;
    }
    const hl = terms.length ? `?hl=${encodeURIComponent(terms.join(' '))}` : '';
    body.innerHTML = results
      .map((r, i) => {
        const d = r.doc;
        const tagHtml = d.g
          .slice(0, 4)
          .map((g) => `#${highlight(g, [...terms, ...tags])}`)
          .join(' ');
        return `<a class="search-result" role="option" id="sr-${i}" href="${d.u}${hl}">
          <div class="search-result-title"><span>${highlight(d.t, terms)}</span><span class="arrow">${icon('enter', 15)}</span></div>
          <div class="search-result-meta">${highlight(d.c, terms)} · ${formatDate(d.d)}${tagHtml ? ' · ' + tagHtml : ''}</div>
          <div class="search-result-snippet">${snippet(r, terms)}</div></a>`;
      })
      .join('');
    stat.textContent = `${results.length} 个结果`;
    select(0);
  };

  const open = async (initial?: string) => {
    if (!modal.hidden) return;
    lastFocus = document.activeElement;
    modal.hidden = false;
    document.documentElement.style.overflow = 'hidden';
    if (initial != null) input.value = initial;
    input.focus();
    input.select();
    if (!docs) {
      body.innerHTML = `<div class="search-empty">正在加载索引…</div>`;
      try {
        await load(url);
      } catch {
        body.innerHTML = `<div class="search-empty">搜索索引加载失败，请稍后重试</div>`;
        return;
      }
    }
    render();
  };
  const close = () => {
    if (modal.hidden) return;
    modal.hidden = true;
    document.documentElement.style.overflow = '';
    (lastFocus as HTMLElement | null)?.focus?.();
  };

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(render, 60);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      select(selected + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      select(selected - 1);
    } else if (e.key === 'Enter') {
      const el = items()[selected];
      if (!el) return;
      e.preventDefault();
      recentQueries.add(input.value);
      if (e.metaKey || e.ctrlKey) window.open(el.href, '_blank');
      else location.href = el.href;
    }
  });
  body.addEventListener('mousemove', (e) => {
    const a = (e.target as HTMLElement).closest('.search-result');
    if (a) {
      const i = items().indexOf(a as HTMLAnchorElement);
      if (i !== selected && i >= 0) {
        selected = i;
        items().forEach((el, k) => el.setAttribute('aria-selected', String(k === i)));
      }
    }
  });
  body.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const chip = t.closest<HTMLElement>('[data-tag], [data-query]');
    if (chip) {
      input.value = chip.dataset.query ?? `#${chip.dataset.tag} `;
      input.focus();
      render();
      return;
    }
    if (t.closest('[data-clear-history]')) {
      recentQueries.clear();
      renderEmpty();
      input.focus();
      return;
    }
    if (t.closest('.search-result')) recentQueries.add(input.value);
  });
  modal.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-search-close]')) close();
  });
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const typing = target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (modal.hidden) open();
      else close();
    } else if (e.key === '/' && !typing && modal.hidden) {
      e.preventDefault();
      open();
    } else if (e.key === 'Escape' && !modal.hidden) {
      e.preventDefault();
      close();
    }
  });
  document.addEventListener('click', (e) => {
    const trigger = (e.target as HTMLElement).closest<HTMLElement>('[data-search-open]');
    if (trigger) {
      e.preventDefault();
      open(trigger.dataset.searchQuery);
    }
  });
  // 鼠标悬停在搜索按钮上时预加载索引
  document.querySelector('[data-search-open]')?.addEventListener('pointerenter', () => load(url).catch(() => {}), { once: true });
}

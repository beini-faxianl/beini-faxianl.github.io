import { icon } from '../lib/icons';
import { toast } from './toast';
import { isDark, onBeforeThemeChange } from './theme';

const prose = document.querySelector<HTMLElement>('[data-prose]');

/* ---------------- 代码块：复制 / 换行 / 展开 ---------------- */
document.addEventListener('click', async (e) => {
  const target = e.target as HTMLElement;
  const block = target.closest<HTMLElement>('.code-block');
  if (!block) return;

  const copyBtn = target.closest<HTMLButtonElement>('.code-copy');
  if (copyBtn) {
    const code = block.querySelector('pre code');
    const lines = [...(code?.querySelectorAll<HTMLElement>('.line') ?? [])];
    const text = lines.length ? lines.map((l) => l.textContent ?? '').join('\n') : (code?.textContent ?? '');
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.innerHTML = icon('check', 15);
      copyBtn.classList.add('is-done');
      setTimeout(() => {
        copyBtn.innerHTML = icon('copy', 15);
        copyBtn.classList.remove('is-done');
      }, 1600);
    } catch {
      toast('复制失败，请手动选择文本');
    }
    return;
  }
  if (target.closest('.code-wrap')) {
    block.classList.toggle('is-wrapped');
    return;
  }
  if (target.closest('.code-expand')) {
    block.classList.remove('is-collapsed');
    return;
  }
  // fold 参数：点击标题栏（或折叠按钮）展开 / 收起
  if (block.classList.contains('is-foldable') && target.closest('.code-header')) {
    const folded = block.classList.toggle('is-folded');
    const btn = block.querySelector<HTMLButtonElement>('.code-fold');
    btn?.setAttribute('aria-expanded', String(!folded));
    btn?.setAttribute('aria-label', folded ? '展开代码' : '折叠代码');
  }
});

/* ---------------- 标题锚点：点击复制链接 ---------------- */
document.addEventListener('click', async (e) => {
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('.heading-anchor');
  if (!a) return;
  e.preventDefault();
  const url = new URL(a.href);
  history.replaceState(null, '', url.hash);
  a.parentElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    await navigator.clipboard.writeText(url.href);
    toast('本节链接已复制');
  } catch {
    /* ignore */
  }
});

/* ---------------- 图片灯箱 ---------------- */
function openLightbox(img: HTMLImageElement) {
  const rect = img.getBoundingClientRect();
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', img.alt || '图片预览');
  const backdrop = document.createElement('div');
  backdrop.className = 'lightbox-backdrop';
  const big = document.createElement('img');
  big.className = 'lightbox-img';
  big.src = img.currentSrc || img.src;
  big.alt = img.alt;
  box.append(backdrop, big);
  const caption = img.closest('figure')?.querySelector('figcaption')?.textContent || (img.alt && !/\.\w{2,4}$/.test(img.alt) ? img.alt : '');
  if (caption) {
    const cap = document.createElement('div');
    cap.className = 'lightbox-caption';
    cap.textContent = caption;
    box.append(cap);
  }

  // 目标尺寸：适配视口，保持比例；SVG 等没有自然尺寸时放大显示
  const ratio = rect.width / rect.height || 1;
  const natW = img.naturalWidth || rect.width * 2;
  const maxW = innerWidth * 0.92;
  const maxH = innerHeight * 0.88;
  let w = Math.min(Math.max(natW, rect.width * 1.6), maxW);
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  const left = (innerWidth - w) / 2;
  const top = (innerHeight - h) / 2;
  Object.assign(big.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${h}px` });

  document.body.append(box);
  img.style.visibility = 'hidden';
  const from = `translate(${rect.left - left}px, ${rect.top - top}px) scale(${rect.width / w}, ${rect.height / h})`;
  const opts = { duration: 380, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' };
  big.animate([{ transform: from }, { transform: 'none' }], opts);
  requestAnimationFrame(() => box.classList.add('is-open'));

  const close = () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('scroll', close);
    box.classList.remove('is-open');
    const r = img.getBoundingClientRect();
    const to = `translate(${r.left - left}px, ${r.top - top}px) scale(${r.width / w}, ${r.height / h})`;
    big.animate([{ transform: 'none' }, { transform: to }], { ...opts, duration: 300, fill: 'forwards' }).finished.then(() => {
      img.style.visibility = '';
      box.remove();
    });
  };
  const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && close();
  box.addEventListener('click', close);
  window.addEventListener('keydown', onKey);
  window.addEventListener('scroll', close, { passive: true, once: true });
}

prose?.addEventListener('click', (e) => {
  const img = (e.target as HTMLElement).closest<HTMLImageElement>('img');
  if (!img || img.closest('a') || document.documentElement.classList.contains('is-annotating')) return;
  openLightbox(img);
});

/* ---------------- Mermaid（按需加载；浅色、深色各渲染一份，切换主题时由 CSS 直接切换） ---------------- */
const mermaidEls = [...document.querySelectorAll<HTMLElement>('pre.mermaid')];
if (mermaidEls.length) {
  mermaidEls.forEach((el) => (el.dataset.source = el.textContent ?? ''));
  let seq = 0;
  const showError = (el: HTMLElement, message: string) => {
    el.dataset.failed = '';
    el.textContent = el.dataset.source ?? '';
    el.classList.remove('is-rendered');
    const note = document.createElement('div');
    note.className = 'mermaid-error';
    note.textContent = message;
    el.parentElement?.querySelector('.mermaid-error')?.remove();
    el.before(note);
  };
  const done: Partial<Record<'light' | 'dark', Promise<void>>> = {};
  let queue: Promise<void> = Promise.resolve();
  // mermaid.initialize 是全局配置，两套主题必须依次渲染
  const renderTheme = (dark: boolean): Promise<void> => {
    const key = dark ? 'dark' : 'light';
    done[key] ??= queue = queue.then(() => renderWith(dark));
    return done[key]!;
  };
  const renderWith = async (dark: boolean) => {
    let mermaid: typeof import('mermaid').default;
    try {
      mermaid = (await import('mermaid')).default;
    } catch (err) {
      console.warn('[mermaid] 加载失败', err);
      mermaidEls.forEach((el) => showError(el, '图表组件加载失败，请刷新页面重试'));
      return;
    }
    const sans = getComputedStyle(document.documentElement).getPropertyValue('--font-sans');
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily: sans,
      themeVariables: dark
        ? {
            darkMode: true,
            background: '#1e1e1c',
            primaryColor: '#2b2b29',
            primaryTextColor: '#faf9f5',
            primaryBorderColor: '#87867f',
            secondaryColor: '#3d3d3a',
            tertiaryColor: '#262624',
            lineColor: '#b0aea5',
            textColor: '#e8e6dc',
            mainBkg: '#2b2b29',
            nodeBorder: '#87867f',
            clusterBkg: '#262624',
            edgeLabelBackground: '#1e1e1c',
            actorBkg: '#2b2b29',
            actorBorder: '#87867f',
            actorTextColor: '#faf9f5',
            signalColor: '#e8e6dc',
            signalTextColor: '#faf9f5',
            noteBkgColor: '#3d3d3a',
            noteTextColor: '#faf9f5',
            noteBorderColor: '#d97757',
            labelBoxBkgColor: '#2b2b29',
            fontSize: '14px',
          }
        : {
            background: '#f0eee6',
            primaryColor: '#faf9f5',
            primaryTextColor: '#141413',
            primaryBorderColor: '#3d3d3a',
            secondaryColor: '#ebdbbc',
            tertiaryColor: '#e8e6dc',
            lineColor: '#5e5d59',
            textColor: '#141413',
            mainBkg: '#faf9f5',
            nodeBorder: '#3d3d3a',
            clusterBkg: '#e8e6dc',
            edgeLabelBackground: '#f0eee6',
            actorBkg: '#faf9f5',
            actorBorder: '#3d3d3a',
            signalColor: '#3d3d3a',
            signalTextColor: '#141413',
            noteBkgColor: '#ebdbbc',
            noteTextColor: '#141413',
            noteBorderColor: '#d97757',
            fontSize: '14px',
          },
    });
    const key = dark ? 'dark' : 'light';
    for (const el of mermaidEls) {
      if (el.hasAttribute('data-failed')) continue;
      try {
        const { svg } = await mermaid.render(`mermaid-${key}-${++seq}`, el.dataset.source ?? '');
        if (!el.classList.contains('is-rendered')) {
          el.textContent = '';
          el.classList.add('is-rendered');
        }
        const box = document.createElement('div');
        box.className = 'mermaid-svg';
        box.dataset.mermaidTheme = key;
        box.innerHTML = svg;
        el.querySelector(`[data-mermaid-theme="${key}"]`)?.remove();
        el.append(box);
      } catch (err) {
        console.warn('[mermaid]', err);
        // 语法错误时显示原始代码与错误信息，方便排查
        showError(el, `图表语法有误：${String((err as Error)?.message ?? err).split('\n')[0]}`);
      }
    }
  };
  // 切换主题前确保对应配色已渲染好（通常早已在空闲时完成）
  let started = false;
  onBeforeThemeChange((dark) => (started ? renderTheme(dark) : undefined));
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((en) => en.isIntersecting)) return;
      io.disconnect();
      started = true;
      const current = isDark();
      renderTheme(current).then(() => {
        const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 300));
        idle(() => renderTheme(!current));
      });
    },
    { rootMargin: '600px' },
  );
  mermaidEls.forEach((el) => io.observe(el));
}

/* ---------------- 悬停预览：内部链接 & 脚注 ---------------- */
const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
if (canHover) {
  const pop = document.createElement('div');
  pop.className = 'preview-popover';
  pop.setAttribute('role', 'tooltip');
  document.body.append(pop);
  const cache = new Map<string, Promise<Document | null>>();
  let showTimer: number | undefined;
  let hideTimer: number | undefined;
  let current: HTMLElement | null = null;

  const fetchDoc = (url: string) => {
    let p = cache.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => (r.ok ? r.text() : Promise.reject()))
        .then((html) => new DOMParser().parseFromString(html, 'text/html'))
        .catch(() => null);
      cache.set(url, p);
    }
    return p;
  };

  const place = (anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth;
    const ph = pop.offsetHeight;
    let left = Math.min(Math.max(16, r.left + r.width / 2 - pw / 2), innerWidth - pw - 16);
    let top = r.bottom + 10;
    if (top + ph > innerHeight - 16 && r.top - ph - 10 > 16) top = r.top - ph - 10;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };

  const hide = () => {
    pop.classList.remove('is-visible');
    current = null;
  };

  const show = async (link: HTMLAnchorElement) => {
    current = link;
    const isFootnote = link.hasAttribute('data-footnote-ref');
    pop.classList.toggle('is-footnote', isFootnote);
    if (isFootnote) {
      const id = decodeURIComponent(link.hash.slice(1));
      const li = document.getElementById(id);
      if (!li) return;
      const clone = li.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('[data-footnote-backref]').forEach((b) => b.remove());
      pop.innerHTML = `<div class="prose">${clone.innerHTML}</div>`;
    } else {
      pop.innerHTML = `<div class="preview-loading">加载中…</div>`;
      pop.classList.add('is-visible');
      place(link);
      const url = new URL(link.href);
      const doc = await fetchDoc(url.pathname);
      if (current !== link) return;
      const body = doc?.querySelector('[data-prose]');
      if (!doc || !body) {
        hide();
        return;
      }
      const title = doc.querySelector('.article-title')?.textContent ?? doc.title;
      const meta = doc.querySelector('.article-meta time')?.textContent ?? '';
      let nodes: Element[] = [...body.children];
      const hash = decodeURIComponent(url.hash.slice(1));
      if (hash) {
        const start = body.querySelector(`[id="${CSS.escape(hash)}"]`);
        const top = start?.closest('[data-prose] > *') ?? start;
        const idx = top ? nodes.indexOf(top) : -1;
        if (idx >= 0) nodes = nodes.slice(idx);
      }
      const frag = document.createElement('div');
      frag.className = 'prose';
      let chars = 0;
      for (const n of nodes) {
        frag.append(n.cloneNode(true));
        chars += (n.textContent ?? '').length;
        if (chars > 900 || frag.children.length >= 6) break;
      }
      pop.innerHTML = `<div class="preview-title"></div>${meta ? `<div class="preview-meta">${meta}</div>` : ''}`;
      pop.querySelector('.preview-title')!.textContent = title;
      pop.append(frag);
    }
    pop.classList.add('is-visible');
    pop.scrollTop = 0;
    place(link);
  };

  document.addEventListener('pointerover', (e) => {
    const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a.internal-link, a[data-footnote-ref]');
    if (!link || pop.contains(link) || document.documentElement.classList.contains('is-annotating')) return;
    clearTimeout(hideTimer);
    if (link === current) return;
    clearTimeout(showTimer);
    showTimer = window.setTimeout(() => show(link), link.hasAttribute('data-footnote-ref') ? 120 : 380);
  });
  document.addEventListener('pointerout', (e) => {
    const from = e.target as HTMLElement;
    const to = e.relatedTarget as Node | null;
    const fromLink = from.closest('a.internal-link, a[data-footnote-ref]');
    if (!fromLink && !pop.contains(from)) return;
    // 在链接与预览框之间（或预览框内部）移动时不关闭
    if (to && (pop.contains(to) || (fromLink && fromLink.contains(to)))) return;
    clearTimeout(showTimer);
    hideTimer = window.setTimeout(hide, 220);
  });
  pop.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  window.addEventListener('scroll', () => current && !pop.matches(':hover') && hide(), { passive: true });
}

/* ---------------- 从搜索结果进入时，高亮命中的关键词 ---------------- */
const params = new URLSearchParams(location.search);
const hl = params.get('hl');
if (hl && prose) {
  const terms = hl.toLowerCase().split(/\s+/).filter(Boolean);
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('.katex, .mermaid, script, style, .heading-anchor') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const text = (node.nodeValue ?? '').toLowerCase();
    for (const term of terms) {
      let i = text.indexOf(term);
      while (i !== -1) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + term.length);
        ranges.push(r);
        i = text.indexOf(term, i + term.length);
      }
    }
  }
  const url = new URL(location.href);
  url.searchParams.delete('hl');
  history.replaceState(null, '', url);
  if (ranges.length) {
    ranges.sort((a, b) => a.compareBoundaryPoints(Range.START_TO_START, b));
    const supportsHighlight = 'highlights' in CSS && typeof (window as unknown as { Highlight?: unknown }).Highlight === 'function';
    let clear: () => void;
    if (supportsHighlight) {
      const HighlightCtor = (window as unknown as { Highlight: new (...r: Range[]) => unknown }).Highlight;
      const registry = (CSS as unknown as { highlights: Map<string, unknown> }).highlights;
      registry.set('search-hit', new HighlightCtor(...ranges));
      clear = () => registry.delete('search-hit');
    } else {
      const marks: HTMLElement[] = [];
      for (const r of [...ranges].reverse()) {
        const m = document.createElement('mark');
        m.className = 'search-hit';
        try {
          r.surroundContents(m);
          marks.push(m);
        } catch {
          /* 跨节点的 range 忽略 */
        }
      }
      clear = () => marks.forEach((m) => m.replaceWith(...m.childNodes));
    }
    const first = ranges[0].getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + first.top - innerHeight / 3, behavior: 'smooth' });
    toast(`已高亮 ${ranges.length} 处“${hl}”`, { action: '清除', onAction: () => clear(), duration: 5000 });
  }
}

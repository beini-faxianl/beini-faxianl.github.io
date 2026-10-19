import { store, toast } from './toast';
import { getThemeMode, setThemeMode, type ThemeMode } from './theme';
import { initAnnotations } from './annotate';

const root = document.documentElement;

/* ======================= 阅读设置 ======================= */

const DEFAULTS = {
  // 与 tokens.css 一致：手机上默认 17px
  fontSize: window.matchMedia('(max-width: 640px)').matches ? 17 : 18,
  lineHeight: 1.85,
  letterSpacing: 0.01,
  paraSpacing: 1.15,
  width: 720,
  contrast: 90,
  font: 'serif' as 'serif' | 'han-sans' | 'sans' | 'kai',
  justify: false,
  indent: false,
};
type Settings = typeof DEFAULTS;
type NumKey = 'fontSize' | 'lineHeight' | 'letterSpacing' | 'paraSpacing' | 'width' | 'contrast';

const VARS: Record<NumKey, [string, string]> = {
  fontSize: ['--reader-font-size', 'px'],
  lineHeight: ['--reader-line-height', ''],
  letterSpacing: ['--reader-letter-spacing', 'em'],
  paraSpacing: ['--reader-para-spacing', 'em'],
  width: ['--reader-width', 'px'],
  contrast: ['--reader-contrast', '%'],
};
const FORMAT: Record<NumKey, (v: number) => string> = {
  fontSize: (v) => `${v}px`,
  lineHeight: (v) => v.toFixed(2),
  letterSpacing: (v) => `${v.toFixed(2)}em`,
  paraSpacing: (v) => `${v.toFixed(2)}em`,
  width: (v) => `${v}px`,
  contrast: (v) => `${v}%`,
};

let settings: Settings = { ...DEFAULTS, ...store.get<Partial<Settings>>('reader-settings', {}) };

/**
 * 可选字体只在选中时才加载（楷体：霞鹜文楷；思源黑体：Noto Sans SC）。
 * 以字符串形式导入再注入 <style>，否则构建时这些含上百条 @font-face 的样式
 * 会被当作页面样式提前加载、阻塞首屏渲染。字体文件本身也只下载页面用到的分片。
 */
const FONT_LOADERS: Partial<Record<Settings['font'], () => Promise<{ default: string }>>> = {
  kai: () => import('lxgw-wenkai-screen-webfont/lxgwwenkaigbscreen.css?inline'),
  'han-sans': () => import('@fontsource-variable/noto-sans-sc/index.css?inline'),
};
const loadedFonts = new Set<string>();
function ensureFont() {
  const key = settings.font;
  const load = FONT_LOADERS[key];
  if (!load || loadedFonts.has(key)) return;
  loadedFonts.add(key);
  load()
    .then(({ default: css }) => {
      const style = document.createElement('style');
      style.dataset.font = key;
      style.textContent = css;
      document.head.append(style);
    })
    .catch(() => loadedFonts.delete(key));
}

function applySettings() {
  (Object.keys(VARS) as NumKey[]).forEach((k) => {
    const [name, unit] = VARS[k];
    if (settings[k] === DEFAULTS[k]) root.style.removeProperty(name);
    else root.style.setProperty(name, settings[k] + unit);
  });
  if (settings.font === 'serif') delete root.dataset.readerFont;
  else root.dataset.readerFont = settings.font;
  root.toggleAttribute('data-reader-justify', settings.justify);
  root.toggleAttribute('data-reader-indent', settings.indent);
  ensureFont();
  window.dispatchEvent(new Event('readerchange'));
}

let saveTimer: number | undefined;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const diff: Partial<Settings> = {};
    (Object.keys(DEFAULTS) as (keyof Settings)[]).forEach((k) => {
      if (settings[k] !== DEFAULTS[k]) (diff as Record<string, unknown>)[k] = settings[k];
    });
    if (Object.keys(diff).length) store.set('reader-settings', diff);
    else store.remove('reader-settings');
  }, 200);
}

ensureFont();

const panel = document.querySelector<HTMLElement>('[data-reader-panel]');
const dock = document.querySelector<HTMLElement>('[data-reader-dock]');
const settingsBtn = dock?.querySelector<HTMLButtonElement>('[data-dock="settings"]');

function syncPanel() {
  if (!panel) return;
  panel.querySelectorAll<HTMLInputElement>('input[data-setting]').forEach((input) => {
    const k = input.dataset.setting as NumKey;
    const out = panel.querySelector<HTMLOutputElement>(`[data-output="${k}"]`);
    if (k === 'width') {
      // 屏幕本身比最小宽度还窄时，宽度设置没有意义
      const roomy = innerWidth >= 560;
      input.disabled = !roomy;
      input.max = String(Math.max(560, Math.min(1200, Math.floor((innerWidth - 32) / 10) * 10)));
      if (!roomy) {
        input.style.setProperty('--pct', '100%');
        if (out) out.textContent = '自适应';
        return;
      }
    }
    input.value = String(settings[k]);
    const range = Number(input.max) - Number(input.min) || 1;
    const pct = ((Number(input.value) - Number(input.min)) / range) * 100;
    input.style.setProperty('--pct', `${Math.max(0, Math.min(100, pct))}%`);
    if (out) out.textContent = FORMAT[k](settings[k]);
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-font]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.font === settings.font)));
  const mode = getThemeMode();
  panel.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  panel.querySelectorAll<HTMLInputElement>('[data-toggle]').forEach((i) => (i.checked = Boolean(settings[i.dataset.toggle as 'justify' | 'indent'])));
}

function setPanelOpen(open: boolean) {
  if (!panel || !settingsBtn) return;
  panel.hidden = !open;
  settingsBtn.setAttribute('aria-expanded', String(open));
  if (open) syncPanel();
}

if (panel) {
  panel.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.dataset.setting) {
      const k = input.dataset.setting as NumKey;
      settings[k] = Number(input.value);
    } else if (input.dataset.toggle) {
      settings[input.dataset.toggle as 'justify' | 'indent'] = input.checked;
    } else return;
    applySettings();
    syncPanel();
    saveSettings();
  });
  panel.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const fontBtn = t.closest<HTMLButtonElement>('[data-font]');
    if (fontBtn) {
      settings.font = fontBtn.dataset.font as Settings['font'];
      applySettings();
      syncPanel();
      saveSettings();
      return;
    }
    const modeBtn = t.closest<HTMLButtonElement>('[data-mode]');
    if (modeBtn) {
      const r = modeBtn.getBoundingClientRect();
      setThemeMode(modeBtn.dataset.mode as ThemeMode, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
      syncPanel();
      return;
    }
    if (t.closest('[data-reader-reset]')) {
      settings = { ...DEFAULTS };
      applySettings();
      syncPanel();
      saveSettings();
      toast('已恢复默认阅读设置');
    }
  });
  window.addEventListener('thememodechange', syncPanel);
  document.addEventListener('pointerdown', (e) => {
    if (!panel.hidden && !panel.contains(e.target as Node) && !settingsBtn?.contains(e.target as Node)) setPanelOpen(false);
  });
}

/* ======================= 目录 / 进度 ======================= */

const article = document.querySelector<HTMLElement>('[data-article-content]');
const aside = document.querySelector<HTMLElement>('[data-article-aside]');
const progressBar = document.querySelector<HTMLElement>('[data-reading-progress]');
const progressRing = document.querySelector<SVGCircleElement>('[data-progress-ring]');
const progressTexts = document.querySelectorAll<HTMLElement>('[data-progress-text]');
const tocLinks = [...document.querySelectorAll<HTMLAnchorElement>('[data-toc-link]')];
const headings = tocLinks.map((a) => document.getElementById(a.dataset.tocLink!)).filter((h): h is HTMLElement => !!h);
const tocList = document.querySelector<HTMLElement>('.toc-list');
const slug = document.querySelector<HTMLElement>('[data-article]')?.dataset.slug ?? location.pathname;
const POS_KEY = `read-pos:${slug}`;
let lastSave = 0;

let activeId = '';
function onScroll() {
  if (!article) return;
  const rect = article.getBoundingClientRect();
  const total = rect.height - innerHeight * 0.6;
  const progress = Math.max(0, Math.min(1, -rect.top / Math.max(1, total)));
  progressBar?.style.setProperty('--progress', String(progress));
  progressRing?.style.setProperty('stroke-dashoffset', String(100 - progress * 100));
  progressTexts.forEach((t) => (t.textContent = `${Math.round(progress * 100)}%`));

  const offset = 110;
  let current = headings[0]?.id ?? '';
  for (const h of headings) {
    if (h.getBoundingClientRect().top - offset <= 0) current = h.id;
    else break;
  }
  if (headings[0] && headings[0].getBoundingClientRect().top - offset > 0) current = '';
  if (current !== activeId) {
    activeId = current;
    let passed = true;
    for (const a of tocLinks) {
      const isActive = a.dataset.tocLink === current;
      if (isActive) passed = false;
      a.classList.toggle('is-active', isActive);
      a.classList.toggle('is-read', passed && current !== '');
    }
    const act = tocLinks.find((a) => a.dataset.tocLink === current);
    if (act && tocList) {
      const lr = tocList.getBoundingClientRect();
      const ar = act.getBoundingClientRect();
      if (ar.top < lr.top || ar.bottom > lr.bottom) tocList.scrollTop += ar.top - lr.top - lr.height / 2;
    }
  }
  savePosition(progress);
}

let ticking = false;
window.addEventListener(
  'scroll',
  () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      onScroll();
      ticking = false;
    });
  },
  { passive: true },
);
window.addEventListener('resize', onScroll);
onScroll();

const narrow = window.matchMedia('(max-width: 1279px)');
function toggleToc(force?: boolean) {
  if (!aside) return;
  if (narrow.matches) {
    const open = force ?? !aside.classList.contains('is-open');
    aside.classList.toggle('is-open', open);
  } else {
    aside.classList.toggle('is-collapsed', force === undefined ? undefined : !force);
  }
}
aside?.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('[data-toc-close]') || t === aside) toggleToc(false);
  else if (t.closest('[data-toc-link]') && narrow.matches) toggleToc(false);
  if (t.closest('[data-scroll-top]')) {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
});

/* ======================= 阅读位置记忆 ======================= */

function savePosition(progress: number) {
  const now = Date.now();
  if (now - lastSave < 800) return;
  lastSave = now;
  if (progress > 0.96) store.remove(POS_KEY);
  else if (progress > 0.04) store.set(POS_KEY, { y: window.scrollY, p: progress, at: now });
}
{
  const saved = store.get<{ y: number; p: number; at: number } | null>(POS_KEY, null);
  const fresh = saved && Date.now() - saved.at < 1000 * 60 * 60 * 24 * 60;
  if (saved && fresh && !location.hash && !location.search.includes('hl=') && saved.p > 0.06 && window.scrollY < 200) {
    lastSave = Date.now() + 2000; // 先别覆盖记录
    toast(`上次读到 ${Math.round(saved.p * 100)}%`, {
      action: '继续阅读',
      duration: 7000,
      onAction: () => window.scrollTo({ top: saved.y, behavior: 'smooth' }),
    });
  }
}

/* ======================= 专注模式 / 回到顶部 / 快捷键 ======================= */

const focusBtn = dock?.querySelector<HTMLButtonElement>('[data-dock="focus"]');
function setFocus(on: boolean) {
  root.toggleAttribute('data-focus-mode', on);
  focusBtn?.setAttribute('aria-pressed', String(on));
  if (on) toast('专注模式已开启 · 按 F 或 Esc 退出', { duration: 2000 });
}

const annot = initAnnotations();

dock?.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-dock]');
  if (!btn) return;
  switch (btn.dataset.dock) {
    case 'toc':
      toggleToc();
      break;
    case 'settings':
      setPanelOpen(panel?.hidden ?? false);
      break;
    case 'annotate':
      annot?.toggle();
      break;
    case 'focus':
      setFocus(!root.hasAttribute('data-focus-mode'));
      break;
    case 'top':
      window.scrollTo({ top: 0, behavior: 'smooth' });
      break;
  }
});

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector('[data-search-modal]:not([hidden])')) return;
  if (annot?.isActive()) return; // 批注模式有自己的快捷键
  const k = e.key.toLowerCase();
  if (k === 'f') setFocus(!root.hasAttribute('data-focus-mode'));
  else if (k === 'a') annot?.toggle(true);
  else if (k === 't') toggleToc();
  else if (e.key === 'Escape') {
    if (panel && !panel.hidden) setPanelOpen(false);
    else if (aside?.classList.contains('is-open')) toggleToc(false);
    else if (root.hasAttribute('data-focus-mode')) setFocus(false);
  }
});

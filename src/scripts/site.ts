import { getThemeMode, isDark, setThemeMode } from './theme';
import { initSearch } from './search';

// —— 主题切换 ——
document.querySelectorAll<HTMLButtonElement>('[data-theme-toggle]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const r = btn.getBoundingClientRect();
    const next = isDark() ? 'light' : 'dark';
    // 如果新主题恰好等于系统主题，就回到“跟随系统”
    const sys = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    setThemeMode(next === sys && getThemeMode() !== 'system' ? 'system' : next, { x: r.left + r.width / 2, y: r.top + r.height / 2 });
  });
});

// —— Mac 上显示 ⌘ ——
if (/Mac|iPhone|iPad/.test(navigator.userAgent)) {
  document.querySelectorAll('[data-mod-key]').forEach((k) => (k.textContent = '⌘'));
}

// —— 页眉：滚动描边；阅读页向下滚动时自动隐藏 ——
const header = document.querySelector<HTMLElement>('[data-header]');
if (header) {
  const autoHide = document.body.hasAttribute('data-autohide-header');
  let lastY = window.scrollY;
  let ticking = false;
  const update = () => {
    const y = window.scrollY;
    header.classList.toggle('is-scrolled', y > 8);
    if (autoHide) {
      const menuOpen = document.querySelector('[data-nav]')?.classList.contains('is-open');
      if (y > 320 && y > lastY + 4 && !menuOpen) header.classList.add('is-hidden');
      else if (y < lastY - 4 || y < 320) header.classList.remove('is-hidden');
    }
    lastY = y;
    ticking = false;
  };
  window.addEventListener(
    'scroll',
    () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    },
    { passive: true },
  );
  update();
}

// —— 移动端菜单 ——
const menuBtn = document.querySelector<HTMLButtonElement>('[data-menu-toggle]');
const nav = document.querySelector<HTMLElement>('[data-nav]');
if (menuBtn && nav) {
  const setOpen = (open: boolean) => {
    nav.classList.toggle('is-open', open);
    menuBtn.setAttribute('aria-expanded', String(open));
  };
  menuBtn.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  document.addEventListener('click', (e) => {
    if (!nav.contains(e.target as Node) && !menuBtn.contains(e.target as Node)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));
}

// —— 快捷键帮助（按 ? 打开） ——
const shortcuts = document.querySelector<HTMLDialogElement>('[data-shortcuts]');
if (shortcuts) {
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key !== '?' || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (document.documentElement.classList.contains('is-annotating') || document.querySelector('[data-search-modal]:not([hidden])')) return;
    e.preventDefault();
    if (shortcuts.open) shortcuts.close();
    else openShortcuts();
  });
  shortcuts.addEventListener('click', (e) => {
    // 点击遮罩或关闭按钮
    if (e.target === shortcuts || (e.target as HTMLElement).closest('[data-shortcuts-close]')) shortcuts.close();
  });
  document.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-shortcuts-open]')) openShortcuts();
  });
}
function openShortcuts() {
  if (!shortcuts) return;
  shortcuts.showModal();
  shortcuts.focus(); // 焦点放在对话框本身，避免关闭按钮一打开就出现焦点框
}

// —— 跨页过渡：点击的文章标题“飞”到新页面的标题位置（Chrome / Edge / Safari 新版本） ——
let lastLink: HTMLAnchorElement | null = null;
document.addEventListener('click', (e) => (lastLink = (e.target as HTMLElement).closest?.('a') ?? null), true);
type SwapEvent = Event & { viewTransition?: { finished: Promise<void> } | null; activation?: { entry?: { url: string } } | null };
window.addEventListener('pageswap', (e) => {
  const ev = e as SwapEvent;
  const url = ev.activation?.entry?.url;
  if (!ev.viewTransition || !url || !lastLink) return;
  if (new URL(lastLink.href, location.href).pathname !== new URL(url).pathname) return;
  const title = lastLink.querySelector<HTMLElement>('[data-vt-title]');
  if (!title) return;
  title.style.viewTransitionName = 'post-title';
  ev.viewTransition.finished.finally(() => (title.style.viewTransitionName = ''));
});

initSearch();

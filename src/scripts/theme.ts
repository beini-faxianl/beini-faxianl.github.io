export type ThemeMode = 'light' | 'dark' | 'system';

const mq = window.matchMedia('(prefers-color-scheme: dark)');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;

/** 主题切换动画参数 */
const DURATION = 640;
const EASING = 'cubic-bezier(0.45, 0, 0.2, 1)';
/** 扩散边缘的柔化宽度（px） */
const FEATHER = 64;
/** 无 View Transitions 时整体淡入淡出的时长 */
const FADE_MS = 360;

export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem('theme');
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignore */
  }
  return 'system';
}

export function isDark(): boolean {
  return root.dataset.theme === 'dark';
}

/* ---------- 切换前的准备工作（例如预先渲染另一套配色的 Mermaid 图） ---------- */
type Hook = (dark: boolean) => unknown;
const hooks = new Set<Hook>();
export function onBeforeThemeChange(fn: Hook) {
  hooks.add(fn);
}
function prepare(dark: boolean) {
  if (!hooks.size) return Promise.resolve();
  const all = Promise.allSettled([...hooks].map((h) => h(dark)));
  return Promise.race([all, new Promise((r) => setTimeout(r, 1000))]);
}

function apply(dark: boolean) {
  if (isDark() === dark) return;
  root.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141413' : '#faf9f5');
  window.dispatchEvent(new CustomEvent('themechange', { detail: { dark } }));
}

/** 不带动画、但也不让各元素自己的 transition 参差不齐地播放 */
function applyInstant(dark: boolean) {
  root.classList.add('theme-switching');
  apply(dark);
  void getComputedStyle(root).color; // 强制样式计算，让新颜色立即生效
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
}

/** 浏览器不支持 View Transitions 时：所有颜色统一、同步地淡入淡出 */
function applyFade(dark: boolean) {
  root.classList.add('theme-fading');
  apply(dark);
  setTimeout(() => root.classList.remove('theme-fading'), FADE_MS + 60);
}

type ViewTransition = { ready: Promise<void>; finished: Promise<void> };
let token = 0;

/**
 * 切换主题。传入起点坐标时：
 * - 切到深色：深色从按钮处柔和地扩散开
 * - 切回浅色：深色向按钮处收拢退去
 */
export async function setThemeMode(mode: ThemeMode, origin?: { x: number; y: number }) {
  try {
    localStorage.setItem('theme', mode);
  } catch {
    /* ignore */
  }
  const dark = mode === 'dark' || (mode === 'system' && mq.matches);
  window.dispatchEvent(new CustomEvent('thememodechange', { detail: { mode } }));
  if (isDark() === dark) return;

  const doc = document as Document & { startViewTransition?: (cb: () => void) => ViewTransition };
  if (reduced.matches) return applyInstant(dark);

  await prepare(dark);
  if (!origin || !doc.startViewTransition) return applyFade(dark);

  const my = ++token;
  const { x, y } = origin;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + FEATHER;
  root.style.setProperty('--vt-x', `${x}px`);
  root.style.setProperty('--vt-y', `${y}px`);
  root.style.setProperty('--vt-feather', `${FEATHER}px`);
  root.dataset.themeDir = dark ? 'to-dark' : 'to-light';
  root.classList.add('theme-switching');

  const vt = doc.startViewTransition(() => apply(dark));
  vt.ready
    .then(() => {
      // 深色层始终在上方：变暗时新画面扩散，变亮时旧画面收拢
      root.animate(
        { '--vt-r': dark ? ['0px', `${radius}px`] : [`${radius}px`, '0px'] },
        { duration: DURATION, easing: EASING, fill: 'both', pseudoElement: dark ? '::view-transition-new(root)' : '::view-transition-old(root)' },
      );
    })
    .catch(() => {});
  vt.finished.finally(() => {
    if (my !== token) return;
    root.classList.remove('theme-switching');
    delete root.dataset.themeDir;
  });
}

mq.addEventListener('change', () => {
  if (getThemeMode() === 'system') applyInstant(mq.matches);
});

// 其它标签页修改了主题
window.addEventListener('storage', (e) => {
  if (e.key === 'theme') {
    const mode = getThemeMode();
    applyInstant(mode === 'dark' || (mode === 'system' && mq.matches));
  }
});

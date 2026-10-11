export function toast(message: string, opts: { action?: string; onAction?: () => void; duration?: number } = {}) {
  const host = document.querySelector<HTMLElement>('[data-toast-host]');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'toast';
  const span = document.createElement('span');
  span.textContent = message;
  el.append(span);
  let timer: number | undefined;
  const close = () => {
    clearTimeout(timer);
    el.classList.add('is-leaving');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  };
  if (opts.action) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = opts.action;
    btn.addEventListener('click', () => {
      opts.onAction?.();
      close();
    });
    el.append(btn);
  }
  host.append(el);
  timer = window.setTimeout(close, opts.duration ?? 2600);
  return close;
}

/** localStorage 包装：隐私模式或被禁用时静默失败 */
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

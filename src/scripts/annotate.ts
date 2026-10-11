/**
 * 文章批注：笔、荧光笔、激光笔、橡皮擦，撤销 / 重做 / 一键清除。
 *
 * 锚定策略：每一笔落笔结束后，找到笔迹中心下方的那个字符（段落序号 + 字符偏移 + 文本指纹），
 * 坐标相对于该字符保存，并记录当时的字高。之后调整字号、行距、页面宽度导致文字重排时，
 * 批注会跟随那个字移动并按字高等比缩放——圈住的词依然被圈住。
 * 画在页边空白处（下方没有文字）的笔迹则退回到“跟随段落”。
 * 批注保存在本机浏览器（localStorage），按文章区分。
 */
import { getStroke } from 'perfect-freehand';
import { store, toast } from './toast';

type Tool = 'pen' | 'highlighter' | 'laser' | 'eraser';
type InkTool = 'pen' | 'highlighter';
type Pt = [number, number, number];

interface Stroke {
  id: string;
  tool: InkTool;
  color: string;
  size: number;
  /** 是否模拟笔压（鼠标/手指）；数位笔使用真实压感 */
  sim: boolean;
  anchor: number;
  fp: string;
  pts: Pt[];
  /** 文字锚点：段落内的字符偏移；pts 相对于该字符左上角 */
  off?: number;
  /** 落笔时该字符的高度（用于等比缩放） */
  fs?: number;
  /** 落笔时字符相对段落左上角的位置（字符找不到时的退路） */
  ox?: number;
  oy?: number;
}
interface Placement {
  tx: number;
  ty: number;
  k: number;
}
type Action = { kind: 'add' | 'remove'; strokes: Stroke[] };

const COLORS: Record<string, string> = {
  clay: 'var(--clay)',
  ink: 'var(--fg)',
  sky: 'var(--sky)',
  olive: 'var(--olive)',
  pencil: 'var(--pencil)',
  fig: 'var(--fig)',
};
const SIZES: Record<InkTool, number[]> = { pen: [2.5, 4, 7], highlighter: [14, 20, 30] };
const ERASER_R = 12;
const LASER_LIFE = 700;
const SVG_NS = 'http://www.w3.org/2000/svg';

interface Prefs {
  tool: Tool;
  color: Record<InkTool, string>;
  size: Record<InkTool, number>;
}

const svgEl = <K extends keyof SVGElementTagNameMap>(tag: K, cls?: string) => {
  const el = document.createElementNS(SVG_NS, tag);
  if (cls) el.setAttribute('class', cls);
  return el;
};

/** perfect-freehand 输出的轮廓 → SVG path */
function toPath(points: number[][]): string {
  const len = points.length;
  if (len < 2) return '';
  const r = (n: number) => Math.round(n * 100) / 100;
  let d = `M${r(points[0][0])},${r(points[0][1])} Q`;
  for (let i = 0; i < len; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % len];
    d += `${r(x0)},${r(y0)} ${r((x0 + x1) / 2)},${r((y0 + y1) / 2)} `;
  }
  return d + 'Z';
}

function strokeOutline(s: Pick<Stroke, 'tool' | 'size' | 'sim' | 'pts'>, done = true) {
  const pts = s.pts.length === 1 ? [s.pts[0], [s.pts[0][0] + 0.1, s.pts[0][1] + 0.1, s.pts[0][2]] as Pt] : s.pts;
  return s.tool === 'highlighter'
    ? getStroke(pts, { size: s.size, thinning: 0, smoothing: 0.6, streamline: 0.45, simulatePressure: false, last: done, start: { cap: true }, end: { cap: true } })
    : getStroke(pts, { size: s.size, thinning: 0.55, smoothing: 0.55, streamline: 0.4, simulatePressure: s.sim, last: done });
}

function distToSegment(px: number, py: number, a: Pt, b: Pt) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = dx * dx + dy * dy;
  let t = len ? ((px - a[0]) * dx + (py - a[1]) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

export function initAnnotations() {
  const container = document.querySelector<HTMLElement>('[data-article-content]');
  const prose = container?.querySelector<HTMLElement>('[data-prose]');
  const toolbar = document.querySelector<HTMLElement>('[data-annot-toolbar]');
  const dockBtn = document.querySelector<HTMLButtonElement>('[data-dock="annotate"]');
  const badge = document.querySelector<HTMLElement>('[data-annot-count]');
  if (!container || !prose || !toolbar) return null;

  const slug = document.querySelector<HTMLElement>('[data-article]')?.dataset.slug ?? location.pathname;
  const KEY = `annotations:${slug}`;
  const root = document.documentElement;

  /* ---------- DOM ---------- */
  const hiLayer = svgEl('svg', 'annot-layer annot-hi');
  const inkLayer = svgEl('svg', 'annot-layer annot-ink');
  const laserPath = svgEl('path', 'annot-laser-trail');
  const cursor = svgEl('circle', 'annot-cursor');
  for (const l of [hiLayer, inkLayer]) l.setAttribute('aria-hidden', 'true');
  inkLayer.append(laserPath, cursor);
  const capture = document.createElement('div');
  capture.className = 'annot-capture';
  container.append(hiLayer, inkLayer, capture);

  /* ---------- 状态 ---------- */
  let strokes: Stroke[] = store.get<Stroke[]>(KEY, []);
  const undoStack: Action[] = [];
  const redoStack: Action[] = [];
  const prefs: Prefs = {
    tool: 'pen',
    color: { pen: 'clay', highlighter: 'pencil' },
    size: { pen: 1, highlighter: 1 },
    ...store.get<Partial<Prefs>>('annot-prefs', {}),
  };
  let active = false;
  const els = new Map<string, SVGPathElement>();
  const fpCache = new WeakMap<Element, string>();

  const blocks = () => [...prose.children] as HTMLElement[];
  const fingerprint = (el: Element) => {
    let fp = fpCache.get(el);
    if (fp === undefined) {
      fp = (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) || el.tagName;
      fpCache.set(el, fp);
    }
    return fp;
  };

  /** 每个段落相对容器的位置 */
  function measure() {
    const cr = container!.getBoundingClientRect();
    const list = blocks();
    const rects = list.map((b) => b.getBoundingClientRect());
    return { list, left: cr.left, top: cr.top, tops: rects.map((r) => r.top - cr.top), bottoms: rects.map((r) => r.bottom - cr.top) };
  }
  type Measure = ReturnType<typeof measure>;

  function anchorFor(y: number) {
    const m = measure();
    let i = m.bottoms.findIndex((b) => b >= y);
    if (i === -1) i = m.list.length - 1;
    if (i === -1) return { index: -1, top: 0, fp: '' };
    return { index: i, top: m.tops[i], fp: fingerprint(m.list[i]) };
  }
  function blockIndexOf(s: Stroke, m: Measure) {
    if (s.anchor < 0 || !m.list.length) return -1;
    const at = m.list[s.anchor];
    if (at && fingerprint(at) === s.fp) return s.anchor;
    const j = m.list.findIndex((b) => fingerprint(b) === s.fp);
    return j >= 0 ? j : Math.min(s.anchor, m.list.length - 1);
  }

  /* ---------- 文字锚点 ---------- */
  function charRect(block: Element, off: number): DOMRect | null {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let acc = 0;
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      const len = t.data.length;
      if (off < acc + len) {
        const r = document.createRange();
        const i = off - acc;
        r.setStart(t, i);
        r.setEnd(t, Math.min(len, i + 1));
        const rect = r.getClientRects()[0] ?? r.getBoundingClientRect();
        return rect && rect.height ? rect : null;
      }
      acc += len;
    }
    return null;
  }
  function offsetOf(block: Element, node: Node, offset: number): number | null {
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let acc = 0;
    while (walker.nextNode()) {
      if (walker.currentNode === node) return acc + offset;
      acc += (walker.currentNode as Text).data.length;
    }
    return null;
  }
  function caretAt(x: number, y: number): { node: Node; offset: number } | null {
    const d = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    capture.style.visibility = 'hidden';
    try {
      if (d.caretPositionFromPoint) {
        const p = d.caretPositionFromPoint(x, y);
        if (p) return { node: p.offsetNode, offset: p.offset };
      }
      if (d.caretRangeFromPoint) {
        const r = d.caretRangeFromPoint(x, y);
        if (r) return { node: r.startContainer, offset: r.startOffset };
      }
      return null;
    } finally {
      capture.style.visibility = '';
    }
  }

  /** 把刚画完的一笔从“相对段落”转换为“相对字符” */
  function anchorToText(s: Stroke, blockTop: number) {
    const xs = s.pts.map((p) => p[0]);
    const ys = s.pts.map((p) => p[1] + blockTop);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const cr = container!.getBoundingClientRect();
    const hit = caretAt(cr.left + cx, cr.top + cy);
    if (!hit || hit.node.nodeType !== Node.TEXT_NODE) return;
    const list = blocks();
    const bi = list.findIndex((b) => b.contains(hit.node));
    if (bi < 0) return;
    const block = list[bi];
    let off = offsetOf(block, hit.node, hit.offset);
    if (off == null) return;
    let rect = charRect(block, off);
    if (!rect && off > 0) rect = charRect(block, --off);
    if (!rect) return;
    const rx = rect.left - cr.left;
    const ry = rect.top - cr.top;
    // 字符离笔迹太远（例如画在页边），不使用文字锚点
    if (Math.hypot(rx - cx, ry - cy) > 260) return;
    const bTop = block.getBoundingClientRect().top - cr.top;
    s.pts = s.pts.map(([x, y, p]) => [x - rx, y + blockTop - ry, p]);
    s.anchor = bi;
    s.fp = fingerprint(block);
    s.off = off;
    s.fs = rect.height;
    s.ox = rx;
    s.oy = ry - bTop;
  }

  function placement(s: Stroke, m: Measure): Placement {
    const bi = blockIndexOf(s, m);
    const blockTop = bi >= 0 ? m.tops[bi] : 0;
    if (s.off == null) return { tx: 0, ty: blockTop, k: 1 };
    const rect = bi >= 0 ? charRect(m.list[bi], s.off) : null;
    if (rect && s.fs) {
      const k = Math.max(0.5, Math.min(2.5, rect.height / s.fs));
      return { tx: rect.left - m.left, ty: rect.top - m.top, k };
    }
    return { tx: s.ox ?? 0, ty: blockTop + (s.oy ?? 0), k: 1 };
  }

  /* ---------- 渲染 ---------- */
  function ensureEl(s: Stroke) {
    let el = els.get(s.id);
    if (!el) {
      el = svgEl('path');
      el.setAttribute('d', toPath(strokeOutline(s)));
      el.style.fill = COLORS[s.color] ?? s.color;
      (s.tool === 'highlighter' ? hiLayer : inkLayer).insertBefore(el, s.tool === 'highlighter' ? null : laserPath);
      els.set(s.id, el);
    }
    return el;
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  function layout() {
    const m = measure();
    for (const s of strokes) {
      const p = placement(s, m);
      ensureEl(s).setAttribute('transform', `translate(${r1(p.tx)} ${r1(p.ty)})${p.k !== 1 ? ` scale(${Math.round(p.k * 1000) / 1000})` : ''}`);
    }
    for (const [id, el] of els) {
      if (!strokes.some((s) => s.id === id)) {
        el.remove();
        els.delete(id);
      }
    }
    if (badge) {
      badge.hidden = strokes.length === 0;
      badge.textContent = strokes.length > 99 ? '99+' : String(strokes.length);
    }
  }
  let layoutQueued = false;
  const queueLayout = () => {
    if (layoutQueued) return;
    layoutQueued = true;
    requestAnimationFrame(() => {
      layoutQueued = false;
      layout();
    });
  };
  new ResizeObserver(queueLayout).observe(prose);
  window.addEventListener('readerchange', queueLayout);
  document.fonts?.ready.then(queueLayout);
  layout();

  let saveTimer: number | undefined;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      const round = (n: number) => Math.round(n * 10) / 10;
      if (!strokes.length) store.remove(KEY);
      else store.set(KEY, strokes.map((s) => ({ ...s, pts: s.pts.map(([x, y, p]) => [round(x), round(y), Math.round(p * 100) / 100]) })));
    }, 300);
  }
  function commit(action: Action) {
    undoStack.push(action);
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    save();
    layout();
    syncToolbar();
  }
  function applyAction(a: Action, reverse: boolean) {
    const adding = (a.kind === 'add') !== reverse;
    if (adding) strokes.push(...a.strokes.filter((s) => !strokes.includes(s)));
    else strokes = strokes.filter((s) => !a.strokes.includes(s));
  }
  function undo() {
    const a = undoStack.pop();
    if (!a) return;
    applyAction(a, true);
    redoStack.push(a);
    save();
    layout();
    syncToolbar();
  }
  function redo() {
    const a = redoStack.pop();
    if (!a) return;
    applyAction(a, false);
    undoStack.push(a);
    save();
    layout();
    syncToolbar();
  }
  function clearAll() {
    if (!strokes.length) {
      toast('这篇文章还没有批注');
      return;
    }
    const removed = [...strokes];
    strokes = [];
    commit({ kind: 'remove', strokes: removed });
    toast(`已清除 ${removed.length} 处批注`, { action: '撤销', onAction: undo, duration: 5000 });
  }

  /* ---------- 输入 ---------- */
  let drawing: { stroke: Stroke; el: SVGPathElement; top: number } | null = null;
  let erasing: Stroke[] | null = null;
  let laser: { x: number; y: number; t: number }[] = [];
  let laserRaf = 0;
  let penSeen = false;
  const touches = new Map<number, number>();

  const local = (e: PointerEvent) => {
    const r = container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const pressure = (e: PointerEvent) => (e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 0.5);

  let eraseCache: Map<Stroke, Placement> | null = null;
  function eraseAt(x: number, y: number) {
    if (!eraseCache) {
      const m = measure();
      eraseCache = new Map(strokes.map((s) => [s, placement(s, m)]));
    }
    const hit: Stroke[] = [];
    for (const s of strokes) {
      const p = eraseCache.get(s) ?? { tx: 0, ty: 0, k: 1 };
      const lx = (x - p.tx) / p.k;
      const ly = (y - p.ty) / p.k;
      const r = ERASER_R / p.k + s.size / 2;
      const pts = s.pts;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)];
        if (distToSegment(lx, ly, a, pts[i]) <= r) {
          hit.push(s);
          break;
        }
      }
    }
    if (hit.length) {
      strokes = strokes.filter((s) => !hit.includes(s));
      erasing?.push(...hit);
      layout();
    }
  }

  function laserFrame() {
    const now = performance.now();
    laser = laser.filter((p) => now - p.t < LASER_LIFE);
    if (laser.length) {
      const outline = getStroke(
        laser.map((p) => [p.x, p.y, 0.5]),
        { size: 8, thinning: 0.6, smoothing: 0.5, streamline: 0.35, simulatePressure: false, start: { taper: laser.length * 3 }, last: false },
      );
      laserPath.setAttribute('d', toPath(outline));
      laserRaf = requestAnimationFrame(laserFrame);
    } else {
      laserPath.setAttribute('d', '');
      laserRaf = 0;
    }
  }

  function moveCursor(x: number, y: number) {
    cursor.setAttribute('cx', String(x));
    cursor.setAttribute('cy', String(y));
  }

  capture.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.pointerType === 'pen') penSeen = true;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, e.clientY);
      // 双指（或已识别到手写笔时的单指）用于滚动页面
      if (touches.size > 1 || penSeen) {
        if (drawing) {
          drawing.el.remove();
          drawing = null;
        }
        return;
      }
    }
    e.preventDefault();
    try {
      capture.setPointerCapture(e.pointerId);
    } catch {
      /* 指针已失效时忽略 */
    }
    const { x, y } = local(e);
    moveCursor(x, y);
    const tool = prefs.tool;
    if (tool === 'pen' || tool === 'highlighter') {
      const a = anchorFor(y);
      const stroke: Stroke = {
        id: Math.random().toString(36).slice(2, 10),
        tool,
        color: prefs.color[tool],
        size: SIZES[tool][prefs.size[tool]],
        sim: e.pointerType !== 'pen',
        anchor: a.index,
        fp: a.fp,
        pts: [[x, y - a.top, pressure(e)]],
      };
      const el = svgEl('path');
      el.style.fill = COLORS[stroke.color];
      el.setAttribute('transform', `translate(0 ${a.top})`);
      (tool === 'highlighter' ? hiLayer : inkLayer).insertBefore(el, tool === 'highlighter' ? null : laserPath);
      el.setAttribute('d', toPath(strokeOutline(stroke, false)));
      drawing = { stroke, el, top: a.top };
    } else if (tool === 'eraser') {
      erasing = [];
      eraseCache = null;
      eraseAt(x, y);
    } else if (tool === 'laser') {
      laser.push({ x, y, t: performance.now() });
      if (!laserRaf) laserRaf = requestAnimationFrame(laserFrame);
    }
  });

  capture.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && touches.has(e.pointerId) && (touches.size > 1 || penSeen)) {
      const prev = touches.get(e.pointerId)!;
      window.scrollBy(0, (prev - e.clientY) / (touches.size > 1 ? touches.size : 1));
      touches.set(e.pointerId, e.clientY);
      return;
    }
    const { x, y } = local(e);
    moveCursor(x, y);
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
    if (drawing) {
      const s = drawing.stroke;
      if (e.shiftKey) {
        // 按住 Shift 画直线
        s.pts = [s.pts[0], [x, y - drawing.top, pressure(e)]];
      } else {
        for (const ev of events.length ? events : [e]) {
          const p = local(ev);
          s.pts.push([p.x, p.y - drawing.top, pressure(ev)]);
        }
      }
      drawing.el.setAttribute('d', toPath(strokeOutline(s, false)));
    } else if (erasing) {
      eraseAt(x, y);
    } else if (prefs.tool === 'laser' && e.buttons) {
      for (const ev of events.length ? events : [e]) {
        const p = local(ev);
        laser.push({ x: p.x, y: p.y, t: performance.now() });
      }
      if (!laserRaf) laserRaf = requestAnimationFrame(laserFrame);
    }
  });

  const end = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    if (drawing) {
      const { stroke, el, top } = drawing;
      drawing = null;
      el.remove();
      anchorToText(stroke, top);
      strokes.push(stroke);
      commit({ kind: 'add', strokes: [stroke] });
    } else if (erasing) {
      const removed = erasing;
      erasing = null;
      eraseCache = null;
      if (removed.length) commit({ kind: 'remove', strokes: removed });
    }
  };
  capture.addEventListener('pointerup', end);
  capture.addEventListener('pointercancel', end);
  capture.addEventListener('pointerleave', () => cursor.classList.remove('is-visible'));
  capture.addEventListener('pointerenter', () => cursor.classList.add('is-visible'));

  /* ---------- 工具栏 ---------- */
  function syncToolbar() {
    toolbar!.dataset.tool = prefs.tool;
    toolbar!.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === prefs.tool)));
    const ink: InkTool | null = prefs.tool === 'pen' || prefs.tool === 'highlighter' ? prefs.tool : null;
    toolbar!.querySelectorAll<HTMLButtonElement>('[data-color]').forEach((b) => {
      b.setAttribute('aria-pressed', String(!!ink && b.dataset.color === prefs.color[ink]));
      b.disabled = !ink;
    });
    toolbar!.querySelectorAll<HTMLButtonElement>('[data-size]').forEach((b) => {
      b.setAttribute('aria-pressed', String(!!ink && Number(b.dataset.size) === prefs.size[ink]));
      b.disabled = !ink;
    });
    toolbar!.querySelector<HTMLButtonElement>('[data-annot="undo"]')!.disabled = !undoStack.length;
    toolbar!.querySelector<HTMLButtonElement>('[data-annot="redo"]')!.disabled = !redoStack.length;
    capture.dataset.tool = prefs.tool;
    cursor.setAttribute('r', prefs.tool === 'eraser' ? String(ERASER_R) : '5');
    cursor.dataset.tool = prefs.tool;
    store.set('annot-prefs', prefs);
  }

  function setTool(tool: Tool) {
    prefs.tool = tool;
    syncToolbar();
  }

  toolbar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool as Tool);
    else if (b.dataset.color) {
      const ink = prefs.tool === 'highlighter' ? 'highlighter' : 'pen';
      prefs.color[ink] = b.dataset.color;
      if (prefs.tool !== ink) prefs.tool = ink;
      syncToolbar();
    } else if (b.dataset.size) {
      const ink = prefs.tool === 'highlighter' ? 'highlighter' : 'pen';
      prefs.size[ink] = Number(b.dataset.size);
      syncToolbar();
    } else if (b.dataset.annot === 'undo') undo();
    else if (b.dataset.annot === 'redo') redo();
    else if (b.dataset.annot === 'clear') clearAll();
    else if (b.dataset.annot === 'close') setActive(false);
  });

  let hinted = false;
  function setActive(on: boolean) {
    active = on;
    root.classList.toggle('is-annotating', on);
    toolbar!.hidden = !on;
    dockBtn?.setAttribute('aria-pressed', String(on));
    if (on) {
      syncToolbar();
      if (!hinted && !store.get('annot-hinted', false)) {
        hinted = true;
        store.set('annot-hinted', true);
        toast('在文章上直接书写即可 · 双指滚动 · Esc 退出', { duration: 3600 });
      }
    } else {
      drawing?.el.remove();
      drawing = null;
      erasing = null;
    }
  }

  document.addEventListener('keydown', (e) => {
    if (!active) return;
    const t = e.target as HTMLElement;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && k === 'y') {
      e.preventDefault();
      redo();
    } else if (!mod && !e.altKey) {
      const map: Record<string, Tool> = { p: 'pen', h: 'highlighter', l: 'laser', e: 'eraser' };
      if (map[k]) setTool(map[k]);
      else if (/^[1-6]$/.test(k)) {
        const btn = toolbar.querySelectorAll<HTMLButtonElement>('[data-color]')[Number(k) - 1];
        btn?.click();
      } else if (e.key === 'Escape' || k === 'a') setActive(false);
    }
  });

  syncToolbar();

  return {
    toggle: (force?: boolean) => setActive(force ?? !active),
    isActive: () => active,
  };
}

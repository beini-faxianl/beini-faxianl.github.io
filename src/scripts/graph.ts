import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from 'd3-force';
import { CATEGORY_PALETTE as PALETTE } from './graph-colors';

interface GNode extends SimulationNodeDatum {
  id: string;
  title: string;
  url: string;
  category: string;
  group: number;
  degree: number;
}
interface GLink {
  source: string | GNode;
  target: string | GNode;
}
interface GraphData {
  nodes: GNode[];
  links: GLink[];
  categories: string[];
}

let dataPromise: Promise<GraphData> | null = null;
function loadData(url: string) {
  dataPromise ??= fetch(url).then((r) => r.json());
  return dataPromise;
}

export async function mountGraph(canvas: HTMLCanvasElement, opts: { url: string; focus?: string; depth?: number; onEmpty?: () => void }) {
  const raw = await loadData(opts.url);
  let nodes: GNode[] = raw.nodes.map((n) => ({ ...n, degree: 0 }));
  let links: GLink[] = raw.links.map((l) => ({ ...l }));

  // 局部图谱：只保留与当前文章距离 depth 以内的节点
  if (opts.focus) {
    const depth = opts.depth ?? 2;
    const adj = new Map<string, Set<string>>();
    for (const l of links) {
      const s = l.source as string;
      const t = l.target as string;
      if (!adj.has(s)) adj.set(s, new Set());
      if (!adj.has(t)) adj.set(t, new Set());
      adj.get(s)!.add(t);
      adj.get(t)!.add(s);
    }
    const keep = new Set([opts.focus]);
    let frontier = [opts.focus];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const id of frontier) for (const n of adj.get(id) ?? []) if (!keep.has(n)) (keep.add(n), next.push(n));
      frontier = next;
    }
    nodes = nodes.filter((n) => keep.has(n.id));
    links = links.filter((l) => keep.has(l.source as string) && keep.has(l.target as string));
    if (nodes.length <= 1) {
      opts.onEmpty?.();
      return;
    }
  }
  if (!nodes.length) {
    opts.onEmpty?.();
    return;
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const l of links) {
    byId.get(l.source as string)!.degree++;
    byId.get(l.target as string)!.degree++;
  }
  const neighbors = new Map<string, Set<string>>(nodes.map((n) => [n.id, new Set()]));
  for (const l of links) {
    neighbors.get(l.source as string)!.add(l.target as string);
    neighbors.get(l.target as string)!.add(l.source as string);
  }

  const ctx = canvas.getContext('2d')!;
  let width = 0;
  let height = 0;
  let dpr = 1;
  const view = { k: 1, x: 0, y: 0 };
  let hover: GNode | null = null;
  let dragNode: GNode | null = null;
  let colors = readColors();

  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    const v = (n: string) => cs.getPropertyValue(n).trim();
    return {
      bg: v('--bg'),
      fg: v('--fg'),
      muted: v('--fg-muted'),
      faint: v('--fg-faint'),
      link: v('--graph-link'),
      accent: v('--accent'),
      font: v('--font-sans'),
      palette: PALETTE.map((p) => v(p)),
    };
  }
  const radius = (n: GNode) => 4 + Math.sqrt(n.degree) * 2.4 + (n.id === opts.focus ? 3 : 0);

  // 按画布比例分配向心力：又宽又矮的画布（如文末的局部图谱）让节点横向铺开
  const box = canvas.getBoundingClientRect();
  const aspect = box.width && box.height ? box.width / box.height : 1.6;
  const pull = 0.05;
  const sim = forceSimulation<GNode>(nodes)
    .force(
      'link',
      forceLink<GNode, GLink>(links)
        .id((d) => d.id)
        .distance(opts.focus ? 90 : 110)
        .strength(0.5),
    )
    .force('charge', forceManyBody<GNode>().strength(opts.focus ? -320 : -360))
    .force('x', forceX<GNode>(0).strength(aspect >= 1 ? pull : pull * aspect))
    .force('y', forceY<GNode>(0).strength(aspect >= 1 ? Math.min(0.3, pull * aspect) : pull))
    // 碰撞半径留出标签的位置，避免文字互相压住
    .force('collide', forceCollide<GNode>().radius((d) => radius(d) + (opts.focus ? 22 : 10)))
    .stop();
  // 预先模拟到接近稳定，首帧就是整理好的布局
  sim.tick(260);
  sim.on('tick', draw);

  /** 缩放平移到刚好容纳所有节点 */
  function fit() {
    if (!width || !height) return;
    const xs = nodes.map((n) => n.x!);
    const ys = nodes.map((n) => n.y!);
    const pad = 70;
    const w = Math.max(...xs) - Math.min(...xs) + pad * 2;
    const h = Math.max(...ys) - Math.min(...ys) + pad * 2;
    view.k = Math.max(0.4, Math.min(1.8, width / w, height / h));
    view.x = width / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * view.k;
    view.y = height / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * view.k;
  }
  let fitted = false;

  function resize() {
    const r = canvas.getBoundingClientRect();
    width = r.width;
    height = r.height;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (!fitted && width && height) {
      fit();
      fitted = true;
    }
    draw();
  }

  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.translate(view.x, view.y);
    ctx.scale(view.k, view.k);

    const active = hover ?? (opts.focus ? byId.get(opts.focus) ?? null : null);
    const near = active ? neighbors.get(active.id)! : null;
    const highlight = (n: GNode) => !hover || n === hover || near!.has(n.id);

    // 边
    ctx.lineWidth = 1 / Math.sqrt(view.k);
    for (const l of links) {
      const s = l.source as GNode;
      const t = l.target as GNode;
      const on = active && (s === active || t === active);
      ctx.strokeStyle = on ? colors.accent : colors.link;
      ctx.globalAlpha = hover && !on ? 0.25 : on ? 0.9 : 1;
      ctx.beginPath();
      ctx.moveTo(s.x!, s.y!);
      ctx.lineTo(t.x!, t.y!);
      ctx.stroke();
    }
    // 节点
    for (const n of nodes) {
      const r = radius(n);
      ctx.globalAlpha = highlight(n) ? 1 : 0.2;
      ctx.beginPath();
      ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2);
      ctx.fillStyle = colors.palette[n.group % colors.palette.length] || colors.muted;
      ctx.fill();
      if (n.id === opts.focus || n === hover) {
        ctx.lineWidth = 2 / view.k;
        ctx.strokeStyle = colors.fg;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, r + 3 / view.k, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // 标签
    const fontSize = 12 / Math.max(0.8, Math.min(view.k, 1.6));
    ctx.font = `500 ${fontSize}px ${colors.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const n of nodes) {
      const show = opts.focus || view.k > 1.15 || n.degree >= 3 || n === hover || (near && near.has(n.id)) || nodes.length < 16;
      if (!show) continue;
      ctx.globalAlpha = highlight(n) ? (n === hover ? 1 : 0.85) : 0.15;
      ctx.fillStyle = n === hover ? colors.fg : colors.muted;
      const label = n.title.length > 18 ? n.title.slice(0, 17) + '…' : n.title;
      ctx.lineWidth = 3 / view.k;
      ctx.strokeStyle = colors.bg;
      ctx.strokeText(label, n.x!, n.y! + radius(n) + 4);
      ctx.fillText(label, n.x!, n.y! + radius(n) + 4);
    }
    ctx.globalAlpha = 1;
  }

  const toWorld = (cx: number, cy: number) => ({ x: (cx - view.x) / view.k, y: (cy - view.y) / view.k });
  function pick(cx: number, cy: number) {
    const p = toWorld(cx, cy);
    let best: GNode | null = null;
    let bestD = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x! - p.x, n.y! - p.y);
      if (d < radius(n) + 6 / view.k && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best;
  }
  const pos = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { cx: e.clientX - r.left, cy: e.clientY - r.top };
  };

  let panStart: { x: number; y: number; vx: number; vy: number } | null = null;
  let moved = false;
  // 双指缩放
  const pointers = new Map<number, { cx: number; cy: number }>();
  let pinch: { d: number; k: number; mx: number; my: number; vx: number; vy: number } | null = null;
  const pinchState = () => {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.cx - b.cx, a.cy - b.cy) || 1, mx: (a.cx + b.cx) / 2, my: (a.cy + b.cy) / 2 };
  };

  canvas.addEventListener('pointerdown', (e) => {
    const { cx, cy } = pos(e);
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    pointers.set(e.pointerId, { cx, cy });
    if (pointers.size === 2) {
      // 第二根手指落下：取消拖动 / 平移，进入缩放
      if (dragNode) {
        dragNode.fx = null;
        dragNode.fy = null;
        dragNode = null;
        sim.alphaTarget(0);
      }
      panStart = null;
      moved = true;
      const s = pinchState();
      pinch = { ...s, k: view.k, vx: view.x, vy: view.y };
      return;
    }
    if (pointers.size > 2) return;
    moved = false;
    const n = pick(cx, cy);
    if (n) {
      dragNode = n;
      n.fx = n.x;
      n.fy = n.y;
      sim.alphaTarget(0.25).restart();
    } else {
      panStart = { x: cx, y: cy, vx: view.x, vy: view.y };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const { cx, cy } = pos(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { cx, cy });
    if (pinch && pointers.size === 2) {
      const s = pinchState();
      const k = Math.min(4, Math.max(0.3, (pinch.k * s.d) / pinch.d));
      // 以起始中点为锚点缩放，并跟随中点平移
      const wx = (pinch.mx - pinch.vx) / pinch.k;
      const wy = (pinch.my - pinch.vy) / pinch.k;
      view.k = k;
      view.x = s.mx - wx * k;
      view.y = s.my - wy * k;
      draw();
      return;
    }
    if (dragNode) {
      const p = toWorld(cx, cy);
      dragNode.fx = p.x;
      dragNode.fy = p.y;
      moved = true;
    } else if (panStart) {
      view.x = panStart.vx + cx - panStart.x;
      view.y = panStart.vy + cy - panStart.y;
      moved = moved || Math.hypot(cx - panStart.x, cy - panStart.y) > 3;
      draw();
    } else {
      const n = pick(cx, cy);
      if (n !== hover) {
        hover = n;
        canvas.style.cursor = n ? 'pointer' : 'grab';
        draw();
      }
    }
  });
  const up = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      panStart = null;
      return;
    }
    if (dragNode) {
      if (!moved) location.href = dragNode.url;
      dragNode.fx = null;
      dragNode.fy = null;
      sim.alphaTarget(0);
      dragNode = null;
    }
    panStart = null;
    if (e.type === 'pointerleave') {
      hover = null;
      draw();
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('pointerleave', up);
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const { cx, cy } = pos(e);
      const k = Math.min(4, Math.max(0.3, view.k * Math.exp(-e.deltaY * 0.0015)));
      view.x = cx - ((cx - view.x) * k) / view.k;
      view.y = cy - ((cy - view.y) * k) / view.k;
      view.k = k;
      draw();
    },
    { passive: false },
  );

  new ResizeObserver(resize).observe(canvas);
  window.addEventListener('themechange', () => {
    colors = readColors();
    draw();
  });
  resize();

  return {
    reset() {
      fit();
      draw();
    },
    zoom(f: number) {
      const k = Math.min(4, Math.max(0.3, view.k * f));
      view.x = width / 2 - ((width / 2 - view.x) * k) / view.k;
      view.y = height / 2 - ((height / 2 - view.y) * k) / view.k;
      view.k = k;
      draw();
    },
  };
}

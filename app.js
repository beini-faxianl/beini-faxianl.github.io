/* ============================================================
   拾叶集 · 核心脚本
   路由 / 数据加载 / 模糊搜索 / 主题与星空 / 朱批之笔
   ============================================================ */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ====================== 数据 ====================== */
  const store = { notes: [], projects: [], about: "" };
  let homeQuery = "", activeCategory = null;

  const fetchJSON = async (u) => { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error(u + " → HTTP " + r.status); return r.json(); };
  const fetchText = async (u) => {
    const r = await fetch(u, { cache: "no-cache" });
    if (!r.ok) throw new Error(u + " → HTTP " + r.status);
    return (await r.text()).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");  /* 容忍 BOM 与 CRLF */
  };
  const stripFM = (md) => md.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "");
  const toPlain = (md) => md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/%%[\s\S]*?%%/g, " ")
    .replace(/!?\[\[([^\]|]+)(\|[^\]]*)?\]\]/g, "$1")
    .replace(/==/g, "")
    .replace(/^>\s*\[!\w+\][+-]?/gm, "")
    .replace(/[#>*`|\-\[\]()!]/g, " ")
    .replace(/\s+/g, " ").trim();

  async function loadAll() {
    /* 笔记是主角：失败则整体报错 */
    const manifest = await fetchJSON("notes/manifest.json");
    const list = await Promise.all((manifest.notes || []).map(async (m, i) => {
      try {
        let md = stripFM(await fetchText("notes/" + encodeURIComponent(m.file))).trim();
        const h1 = md.match(/^#\s+(.+?)\s*\n+/);                 /* 正文首行 H1 与标题重复时去重 */
        if (h1 && h1[1].trim() === (m.title || "").trim()) md = md.slice(h1[0].length);
        return { id: i, title: m.title || m.file, date: m.date || "", category: m.category || "未分类", tags: m.tags || [], md, plain: toPlain(md) };
      } catch (_) { return null; }
    }));
    store.notes = list.filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : -1));

    /* 项目和关于页相互独立：缺少其中一个不影响文章阅读。 */
    const [pr, ab] = await Promise.allSettled([
      fetchJSON("collections/projects.json"),
      fetchText("pages/about.md"),
    ]);
    if (pr.status === "fulfilled") store.projects = pr.value;
    if (ab.status === "fulfilled") store.about = ab.value;
  }

  /* ====================== 搜索引擎 ======================
     Google 式语法："精确短语"  -排除  A OR B  tag:标签  title:词  before:/after:日期
     普通词项：连续子串优先；其次受控模糊（限制字符间隙，杜绝"什么都匹配"的噪声）。 */
  function parseQuery(q) {
    const out = { groups: [], not: [], tags: [], titles: [], categories: [], before: null, after: null };
    const toks = q.match(/-?"[^"]*"|\S+/g) || [];
    let pendingOr = false;
    for (let tok of toks) {
      let neg = false;
      if (tok.startsWith("-") && tok.length > 1) { neg = true; tok = tok.slice(1); }
      let phrase = false;
      if (/^".*"$/.test(tok)) { phrase = true; tok = tok.slice(1, -1); }
      if (!phrase) {
        if (tok === "OR") { pendingOr = true; continue; }
        const f = tok.match(/^(tag|title|category|before|after)[:：](.+)$/i);
        if (f && !neg) {
          const key = f[1].toLowerCase(), v = f[2];
          if (key === "tag") out.tags.push(v.toLowerCase());
          else if (key === "title") out.titles.push(v.toLowerCase());
          else if (key === "category") out.categories.push(v.toLowerCase());
          else if (key === "before") out.before = v.replace(/[./]/g, "-");
          else out.after = v.replace(/[./]/g, "-");
          continue;
        }
      }
      if (!tok) continue;
      const unit = { v: tok.toLowerCase(), phrase };
      if (neg) { out.not.push(unit); pendingOr = false; continue; }
      if (pendingOr && out.groups.length) { out.groups[out.groups.length - 1].push(unit); pendingOr = false; }
      else out.groups.push([unit]);
    }
    return out;
  }
  function unitMatch(u, text) {
    const lt = String(text).toLowerCase();
    const i = lt.indexOf(u.v);
    if (i > -1) return { score: 100 + Math.max(0, 30 - i * 0.1) + u.v.length * 5,
                         idx: Array.from({ length: u.v.length }, (_, k) => i + k) };
    if (u.phrase || u.v.length < 2) return null;        /* 短语与单字只认精确子串 */
    const idx = []; let pos = 0, gaps = 0;              /* 受控子序列（如 js闭包 / dk命令） */
    for (const ch of u.v) {
      if (/\s/.test(ch)) continue;
      const f = lt.indexOf(ch, pos);
      if (f === -1) return null;
      if (idx.length) gaps += f - pos;
      idx.push(f); pos = f + 1;
    }
    if (gaps > 8 + u.v.length * 6) return null;          /* 间隙过大判为不相关 */
    return { score: Math.max(1, 50 + u.v.length * 3 - gaps * 2), idx };
  }
  /* fields: { title, tags:[], body, date } → { score, titleIdx, contentIdx } | null */
  function evalQuery(p, fields) {
    const title = fields.title || "", tags = fields.tags || [], category = fields.category || "", body = fields.body || "";
    const hay = title + "\n" + category + "\n" + tags.join(" ") + "\n" + body;
    for (const n of p.not) if (unitMatch(n, hay)) return null;
    for (const t of p.tags) if (!tags.some(x => String(x).toLowerCase().includes(t))) return null;
    for (const t of p.titles) if (!title.toLowerCase().includes(t)) return null;
    for (const t of p.categories) if (!category.toLowerCase().includes(t)) return null;
    if (p.before && !(fields.date && fields.date < p.before)) return null;
    if (p.after && !(fields.date && fields.date >= p.after)) return null;
    let score = 0; const titleIdx = [], contentIdx = [];
    for (const group of p.groups) {                      /* 组间 AND，组内 OR */
      let best = null;
      for (const u of group) {
        const tT = unitMatch(u, title), tG = unitMatch(u, tags.join(" ")), tB = body ? unitMatch(u, body) : null;
        const s = (tT ? tT.score * 4 : 0) + (tG ? tG.score * 2 : 0) + (tB ? tB.score : 0);  /* 标题命中权重最高 */
        if (s > 0 && (!best || s > best.s)) best = { s, tT, tB };
      }
      if (!best) return null;
      score += best.s;
      if (best.tT) titleIdx.push(...best.tT.idx);
      if (best.tB) contentIdx.push(...best.tB.idx);
    }
    const filterOnly = !p.groups.length;
    if (filterOnly && !(p.tags.length || p.titles.length || p.categories.length || p.before || p.after || p.not.length)) return null;
    return { score: filterOnly ? 1 : score, titleIdx, contentIdx: contentIdx.sort((a, b) => a - b) };
  }
  function markText(text, idxArr) {
    if (!idxArr || !idxArr.length) return esc(text);
    const set = new Set(idxArr); let out = "";
    for (let i = 0; i < text.length; i++) {
      const ch = esc(text[i]);
      out += set.has(i) ? "<mark>" + ch + "</mark>" : ch;
    }
    return out.replace(/<\/mark><mark>/g, "");
  }

  /* ====================== 代码块装饰 ====================== */
  const LANG_LABEL = { js: "JavaScript", javascript: "JavaScript", ts: "TypeScript", py: "Python", python: "Python",
    sh: "Shell", bash: "Shell", zsh: "Shell", sql: "SQL", html: "HTML", css: "CSS", json: "JSON",
    yaml: "YAML", yml: "YAML", md: "Markdown", markdown: "Markdown", text: "Text", go: "Go", rust: "Rust", c: "C", cpp: "C++" };

  function buildCodeBlock({ code, lang, file, desc }) {
    const pre = document.createElement("pre");
    pre.className = "hl-block" + (file ? " snippet-card" : "");
    const head = document.createElement("div"); head.className = "hl-head";
    head.innerHTML = `<span class="dots"><i></i><i></i><i></i></span>` +
      (file ? `<span class="file">${esc(file)}</span>` : "") +
      `<span class="lang-name">${esc(LANG_LABEL[lang] || lang || "code")}</span>`;
    const btn = document.createElement("button");
    btn.className = "copy-btn"; btn.textContent = "复制";
    btn.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(code); }
      catch (_) {
        const ta = document.createElement("textarea");
        ta.value = code; document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (_) {}
        ta.remove();
      }
      btn.textContent = "已复制 ✓";
      setTimeout(() => (btn.textContent = "复制"), 1400);
    });
    head.appendChild(btn);
    pre.appendChild(head);
    if (desc) { const d = document.createElement("div"); d.className = "snippet-desc"; d.textContent = desc; pre.appendChild(d); }
    const codeEl = document.createElement("code");
    if (lang) codeEl.className = "language-" + lang;
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    if (window.hljs) { try { hljs.highlightElement(codeEl); } catch (_) {} }
    return pre;
  }

  /* 把 marked 输出的 <pre><code> 升级为带头栏的高亮块 */
  function enhanceCodeBlocks(container) {
    container.querySelectorAll("pre > code").forEach((codeEl) => {
      const pre = codeEl.parentElement;
      if (pre.classList.contains("hl-block")) return;
      const lang = (codeEl.className.match(/language-([\w-]+)/) || [])[1] || "";
      pre.replaceWith(buildCodeBlock({ code: codeEl.textContent.replace(/\n$/, ""), lang }));
    });
  }

  /* ====================== Obsidian 语法适配 ====================== */
  /* 预处理（marked 之前）：双链 / 高亮 / 图片嵌入 / 注释。代码块内不转换。 */
  function obsidianPre(md) {
    const parts = md.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/);
    return parts.map((seg, i) => {
      if (i % 2 === 1) return seg;                               /* 代码围栏内原样 */
      let s = seg.replace(/%%[\s\S]*?%%/g, "");                  /* %%Obsidian 注释%% */
      s = s.replace(/==([^=\n](?:[^=\n]|=(?!=))*?)==/g, "<mark>$1</mark>");   /* ==高亮== */
      s = s.replace(/!\[\[([^\]\n]+?)\]\]/g, (m0, inner) => {    /* ![[图片嵌入]]，附件放 assets/ */
        const [name, mod] = inner.split("|").map(x => x.trim());
        if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(name)) {
          const w = mod && /^\d+$/.test(mod) ? ` width="${mod}"` : "";
          return `<img src="assets/${encodeURI(name)}" alt="${esc(name)}"${w}>`;
        }
        return `[[${inner}]]`;                                   /* 非图片嵌入降级为双链 */
      });
      s = s.replace(/\[\[([^\]\n]+?)\]\]/g, (m0, inner) => {     /* [[双链]] / [[目标|别名]] */
        const [target, alias] = inner.split("|").map(x => x.trim());
        const pure = target.replace(/#.*$/, "").trim();
        const display = alias || pure;
        const n = store.notes.find(x => x.title === pure) ||
                  store.notes.find(x => x.title.includes(pure));
        return n
          ? `<a href="#/note/${n.id}" class="wikilink">${esc(display)}</a>`
          : `<span class="wikilink missing" title="书斋里还没有这篇：${esc(pure)}">${esc(display)}</span>`;
      });
      return s;
    }).join("");
  }
  /* 后处理（marked 之后）：> [!type] 标注框 */
  const CALLOUTS = {
    note: { i: "📝", c: "co-blue",  t: "笔记" },  info: { i: "ℹ️", c: "co-blue", t: "信息" },
    abstract: { i: "📋", c: "co-blue", t: "摘要" }, summary: { i: "📋", c: "co-blue", t: "摘要" },
    todo: { i: "☑️", c: "co-blue", t: "待办" },
    tip: { i: "💡", c: "co-green", t: "提示" },   hint: { i: "💡", c: "co-green", t: "提示" },
    important: { i: "🔔", c: "co-green", t: "重要" },
    success: { i: "✅", c: "co-green", t: "完成" }, check: { i: "✅", c: "co-green", t: "完成" }, done: { i: "✅", c: "co-green", t: "完成" },
    question: { i: "❓", c: "co-amber", t: "疑问" }, help: { i: "❓", c: "co-amber", t: "疑问" }, faq: { i: "❓", c: "co-amber", t: "常见问题" },
    warning: { i: "⚠️", c: "co-amber", t: "注意" }, caution: { i: "⚠️", c: "co-amber", t: "注意" }, attention: { i: "⚠️", c: "co-amber", t: "注意" },
    danger: { i: "🚫", c: "co-red", t: "危险" }, error: { i: "🚫", c: "co-red", t: "错误" },
    bug: { i: "🐛", c: "co-red", t: "缺陷" }, fail: { i: "❌", c: "co-red", t: "失败" }, failure: { i: "❌", c: "co-red", t: "失败" }, missing: { i: "❌", c: "co-red", t: "缺失" },
    example: { i: "🧪", c: "co-purple", t: "示例" },
    quote: { i: "❝", c: "co-grey", t: "引用" }, cite: { i: "❝", c: "co-grey", t: "引用" },
  };
  function obsidianPost(container) {
    container.querySelectorAll("blockquote").forEach(bq => {
      const first = bq.firstElementChild;
      if (!first || first.tagName !== "P") return;
      const m = first.innerHTML.match(/^\[!(\w+)\][+-]?[ \t]*([^\n]*)\n?/);
      if (!m) return;
      const def = CALLOUTS[m[1].toLowerCase()] || CALLOUTS.note;
      const title = m[2].trim() || def.t;
      first.innerHTML = first.innerHTML.slice(m[0].length);
      if (!first.textContent.trim() && !first.children.length) first.remove();
      const div = document.createElement("div");
      div.className = "callout " + def.c;
      div.innerHTML = `<div class="co-head"><span class="co-ic">${def.i}</span><span>${title}</span></div>`;
      const body = document.createElement("div");
      body.className = "co-body";
      while (bq.firstChild) body.appendChild(bq.firstChild);
      if (body.childNodes.length) div.appendChild(body);
      bq.replaceWith(div);
    });
  }
  const renderMD = (md) => marked.parse(obsidianPre(md));
  function wrapTables(container) {                      /* 宽表格横向滚动，不再溢出 */
    container.querySelectorAll("table").forEach(t => {
      if (t.parentElement.classList.contains("table-wrap")) return;
      const w = document.createElement("div");
      w.className = "table-wrap";
      t.replaceWith(w); w.appendChild(t);
    });
  }

  /* ====================== 路由 ====================== */
  const app = $("#app");
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function parseRoute() {
    const m = (location.hash || "").match(/^#\/(\w+)(?:\/(.+))?$/);
    return m ? { name: m[1], arg: m[2] } : { name: "home" };
  }
  function render() {
    const r = parseRoute();
    const views = { home: viewHome, note: viewNote, projects: viewProjects, about: viewAbout };
    (views[r.name] || viewHome)(r.arg);
    const navKey = r.name === "note" ? "home" : r.name;
    document.querySelectorAll("#mainNav a").forEach(a => a.classList.toggle("on", a.dataset.route === navKey));
    clearInk();
    window.scrollTo({ top: 0 });
    requestAnimationFrame(resizeInk);
  }
  window.addEventListener("hashchange", render);
  $("#brandHome").addEventListener("click", () => go("#/home"));

  /* ====================== 视图 · 首页 ====================== */
  function viewHome() {
    const categories = [...new Set(store.notes.map(n => n.category).filter(Boolean))];
    app.innerHTML = `
      <section class="hero fade-in">
        <div class="halo"></div>
        <h2>拾叶集</h2>
        <p class="motto">摘 星 与 拾 叶 · 把 散 落 的 思 绪 钉 在 星 空 之 下</p>
        <div class="stats">
          <span class="stat-chip">笔记 <b>${store.notes.length}</b> 篇</span>
          <span class="stat-chip">分类 <b>${categories.length}</b> 类</span>
          <span class="stat-chip">项目 <b>${store.projects.length}</b> 个</span>
        </div>
        <div class="search-wrap">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="searchInput" type="search" placeholder='搜索文章 · 支持 "短语"、tag:、category:' autocomplete="off">
          <kbd>/</kbd>
        </div>
        <nav class="category-row" id="categoryRow" aria-label="文章分类">
          <button class="category-chip${activeCategory ? "" : " on"}" data-category="">全部文章</button>
          ${categories.map(c => `<button class="category-chip${c === activeCategory ? " on" : ""}" data-category="${esc(c)}">${esc(c)}</button>`).join("")}
        </nav>
      </section>
      <div id="homeResults"></div>`;
    const input = $("#searchInput");
    input.value = homeQuery;
    input.addEventListener("input", () => { homeQuery = input.value; renderHomeResults(); });
    $("#categoryRow").addEventListener("click", (e) => {
      const b = e.target.closest(".category-chip"); if (!b) return;
      activeCategory = b.dataset.category || null;
      document.querySelectorAll("#categoryRow .category-chip").forEach(x => x.classList.toggle("on", (x.dataset.category || null) === activeCategory));
      renderHomeResults();
    });
    renderHomeResults();
  }

  function renderHomeResults() {
    const q = homeQuery.trim();
    const box = $("#homeResults"); if (!box) return;

    /* 笔记卡片 */
    const parsed = q ? parseQuery(q) : null;
    const rows = [];
    for (const n of store.notes) {
      if (activeCategory && n.category !== activeCategory) continue;
      let m = { score: 0, titleIdx: [], contentIdx: [] };
      if (parsed) {
        const r0 = evalQuery(parsed, { title: n.title, category: n.category, tags: n.tags, body: n.plain, date: n.date });
        if (!r0) continue;
        m = r0;
      }
      rows.push({ n, m });
    }
    if (q) rows.sort((a, b) => b.m.score - a.m.score);

    let html = `<div class="section-label">${q ? "笔 记 命 中" : "全 部 笔 记"}</div>`;
    html += rows.length
      ? `<div class="note-grid">` + rows.map(({ n, m }) => `
          <button class="note-card fade-in" data-note="${n.id}">
            <span class="nc-date">${esc(n.date)}</span>
            <span class="nc-category">${esc(n.category)}</span>
            <h3>${markText(n.title, m.titleIdx)}</h3>
            <p class="nc-excerpt">${(() => {
              if (m.contentIdx && m.contentIdx.length) {
                const first = m.contentIdx[0];
                const start = Math.max(0, first - 20);
                const local = m.contentIdx.filter(i => i >= start && i < start + 110).map(i => i - start);
                return (start > 0 ? "…" : "") + markText(n.plain.slice(start, start + 110), local) + "…";
              }
              return esc(n.plain.slice(0, 92)) + "…";
            })()}</p>
            <span class="nc-tags">${n.tags.map(t => `<span class="mini-tag"># ${esc(t)}</span>`).join("")}</span>
          </button>`).join("") + `</div>`
      : `<div class="empty-result">没有找到相关笔记。<br>
           <span style="font-size:12px">试试高级语法：<code>"精确短语"</code> · <code>-排除词</code> · <code>A OR B</code> · <code>tag:前端</code> · <code>category:编程开发</code> · <code>after:2026-01</code></span></div>`;
    box.innerHTML = html;
    box.querySelectorAll("[data-note]").forEach(el => el.addEventListener("click", () => go("#/note/" + el.dataset.note)));
  }

  /* ====================== 视图 · 文章 ====================== */
  function viewNote(arg) {
    const n = store.notes.find(x => x.id === +arg);
    if (!n) return viewHome();
    const order = store.notes.indexOf(n) + 1;
    app.innerHTML = `
      <div class="fade-in">
        <div class="crumbs"><button id="backHome">← 回到书斋</button><span>${esc(n.date)}</span></div>
        <div class="article-grid">
          <article class="article">
            <header class="article-head">
              <div class="eyebrow">
                <span>${esc(n.date)}</span><span>·</span><span class="category">${esc(n.category)}</span><span>·</span>
                ${n.tags.map(t => `<span class="tag"># ${esc(t)}</span>`).join("")}
                <span>·</span><span>约 ${n.plain.length} 字</span>
              </div>
              <h2 class="title">${esc(n.title)}</h2>
              <div class="rule"></div>
            </header>
            <div class="md" id="artBody"></div>
            <footer class="article-foot"><span>拾 叶 集</span><span>第 ${order} 篇 · 共 ${store.notes.length} 篇</span></footer>
            <nav class="note-nav" id="noteNav" aria-label="上一篇 / 下一篇"></nav>
          </article>
          <aside class="toc" id="tocBox"></aside>
        </div>
      </div>`;
    $("#backHome").addEventListener("click", () => go("#/home"));
    const body = $("#artBody");
    body.innerHTML = renderMD(n.md);
    obsidianPost(body);
    wrapTables(body);
    enhanceCodeBlocks(body);
    buildToc(body);
    renderNoteNav(n);
  }

  function adjacentNotes(n) {
    const i = store.notes.indexOf(n);
    return { prev: store.notes[i - 1] || null, next: store.notes[i + 1] || null };  /* prev=较新 next=较旧 */
  }
  function renderNoteNav(n) {
    const nav = $("#noteNav"); if (!nav) return;
    const { prev, next } = adjacentNotes(n);
    const cell = (note, dir) => note
      ? `<button class="nn ${dir}" data-note="${note.id}">
           <span class="nn-dir">${dir === "prev" ? "← 上一篇 · 较新" : "下一篇 · 较旧 →"}</span>
           <span class="nn-title">${esc(note.title)}</span>
         </button>`
      : `<button class="nn empty" tabindex="-1"></button>`;
    nav.innerHTML = cell(prev, "prev") + cell(next, "next");
    nav.querySelectorAll("[data-note]").forEach(b =>
      b.addEventListener("click", () => go("#/note/" + b.dataset.note)));
  }
  function stepNote(dir) {                              /* ←/→ 在目录顺序中切换 */
    const r = parseRoute();
    if (r.name !== "note") return false;
    const n = store.notes.find(x => x.id === +r.arg);
    if (!n) return false;
    const adj = adjacentNotes(n);
    const target = dir < 0 ? adj.prev : adj.next;
    if (target) go("#/note/" + target.id);
    return true;
  }
  function buildToc(body) {
    const heads = [...body.querySelectorAll("h2, h3")];
    const toc = $("#tocBox");
    if (!heads.length) { toc.innerHTML = ""; return; }
    toc.innerHTML = `<div class="toc-title">本 文 目 录</div>` + heads.map((h, i) => {
      h.id = "h" + i;
      return `<a href="#h${i}" class="${h.tagName === "H3" ? "lv3" : ""}" data-h="h${i}">${esc(h.textContent.replace(/^§\s*/, ""))}</a>`;
    }).join("");
    /* 点击平滑滚动（不污染路由 hash） */
    toc.querySelectorAll("a").forEach(a => a.addEventListener("click", (e) => {
      e.preventDefault();
      document.getElementById(a.dataset.h)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    /* 滚动高亮 */
    if ("IntersectionObserver" in window) {
      const links = new Map([...toc.querySelectorAll("a")].map(a => [a.dataset.h, a]));
      const io = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          if (en.isIntersecting) {
            toc.querySelectorAll("a").forEach(a => a.classList.remove("now"));
            links.get(en.target.id)?.classList.add("now");
          }
        });
      }, { rootMargin: "-80px 0px -72% 0px" });
      heads.forEach(h => io.observe(h));
    }
  }

  /* ====================== 视图 · 我的项目 ====================== */
  function linkGrid(items) {
    if (!items.length) return `<div class="empty-result">还没有公开项目。运行 <code>python manage.py</code> 添加一个吧。</div>`;
    return `<div class="link-grid project-grid">` + items.map(s => `
      <a class="link-card project-card fade-in" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">
        <span class="glyph">${esc(s.icon || "✦")}</span>
        <span class="lc-body">
          <h3>${esc(s.name)} <span class="arrow">↗</span></h3>
          <p>${esc(s.desc || "")}</p>
          <span class="nc-tags">${(s.tags || []).map(t => `<span class="mini-tag">${esc(t)}</span>`).join("")}</span>
        </span>
      </a>`).join("") + `</div>`;
  }
  function viewProjects() {
    app.innerHTML = `<div class="fade-in">
      <header class="page-head"><h2>我 的 项 目</h2><p>把 想 法 做 成 可 以 使 用 的 东 西</p></header>
      ${linkGrid(store.projects)}</div>`;
  }

  /* ====================== 视图 · 关于 ====================== */
  function viewAbout() {
    app.innerHTML = `<div class="fade-in about-wrap">
      <header class="page-head"><h2>关 于</h2><p>书 斋 主 人 与 这 座 书 斋</p></header>
      <div class="about-card"><div class="md" id="aboutBody"></div></div></div>`;
    const body = $("#aboutBody");
    body.innerHTML = store.about
      ? renderMD(stripFM(store.about))
      : marked.parse("还没有自我介绍。编辑 `pages/about.md`，写点什么吧。");
    obsidianPost(body);
    wrapTables(body);
    enhanceCodeBlocks(body);
  }

  /* ====================== 主题与星空 ====================== */
  const themeBtn = $("#themeBtn");
  const THEMES = [
    { key: "auto",  label: "◐ 跟随系统" },
    { key: "light", label: "☀ 拿铁" },
    { key: "dark",  label: "✦ 星渊" },
  ];
  let themeIdx = 0;
  function applyTheme() {
    const t = THEMES[themeIdx];
    if (t.key === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t.key);
    themeBtn.textContent = t.label;
    requestAnimationFrame(() => { syncAmbient(); redrawInk(); });
  }
  themeBtn.addEventListener("click", () => { themeIdx = (themeIdx + 1) % THEMES.length; applyTheme(); });

  /* 氛围动画：夜 = 星空 + 偶现流星 / 日 = 飘落枫叶。纯背景层，不可交互。 */
  const starsCv = $("#stars"), starsCtx = starsCv.getContext("2d");
  const leavesCv = $("#leaves"), leavesCtx = leavesCv.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let starField = [], meteors = [], nextMeteor = 0, leafField = [], ambRAF = 0;
  const cvVisible = (cv) => getComputedStyle(cv).display !== "none";

  function makeStars() {
    const w = starsCv.width = innerWidth, h = starsCv.height = innerHeight;
    const count = Math.min(260, Math.round(w * h / 8500));
    starField = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 1.3 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 1.1,
      hue: Math.random() < 0.12 ? "#bd93f9" : (Math.random() < 0.12 ? "#8be9fd" : "#e8eaff"),
    }));
    meteors = []; nextMeteor = performance.now() + 1200 + Math.random() * 2500;
  }
  function spawnMeteor(now) {
    const w = starsCv.width, fromLeft = Math.random() < 0.5;
    const speed = 5 + Math.random() * 4, ang = (18 + Math.random() * 22) * Math.PI / 180;
    meteors.push({
      x: fromLeft ? Math.random() * w * 0.4 : w * 0.5 + Math.random() * w * 0.5,
      y: -10 - Math.random() * 60,
      vx: (fromLeft ? 1 : -1) * Math.cos(ang) * speed, vy: Math.sin(ang) * speed + 2,
      len: 80 + Math.random() * 90, born: now, life: 900 + Math.random() * 600,
    });
    nextMeteor = now + 2800 + Math.random() * 6500;   /* 时而出现，不喧宾夺主 */
  }
  function drawNight(now) {
    const w = starsCv.width, h = starsCv.height;
    starsCtx.clearRect(0, 0, w, h);
    for (const s of starField) {
      starsCtx.globalAlpha = reduceMotion.matches ? 0.7
        : 0.3 + 0.55 * (0.5 + 0.5 * Math.sin(s.phase + now * 0.001 * s.speed));
      starsCtx.fillStyle = s.hue;
      starsCtx.beginPath(); starsCtx.arc(s.x, s.y, s.r, 0, Math.PI * 2); starsCtx.fill();
    }
    starsCtx.globalAlpha = 1;
    if (reduceMotion.matches) return;
    if (now > nextMeteor) spawnMeteor(now);
    meteors = meteors.filter(m => now - m.born < m.life && m.y < h + 60 && m.x > -120 && m.x < w + 120);
    for (const m of meteors) {
      m.x += m.vx; m.y += m.vy;
      const k = 1 - (now - m.born) / m.life;             /* 渐隐 */
      const sp = Math.hypot(m.vx, m.vy);
      const tx = m.x - m.vx / sp * m.len, ty = m.y - m.vy / sp * m.len;
      const g = starsCtx.createLinearGradient(m.x, m.y, tx, ty);
      g.addColorStop(0, `rgba(235,240,255,${0.85 * k})`);
      g.addColorStop(0.3, `rgba(189,147,249,${0.4 * k})`);
      g.addColorStop(1, "rgba(189,147,249,0)");
      starsCtx.strokeStyle = g; starsCtx.lineWidth = 1.6; starsCtx.lineCap = "round";
      starsCtx.beginPath(); starsCtx.moveTo(m.x, m.y); starsCtx.lineTo(tx, ty); starsCtx.stroke();
      starsCtx.globalAlpha = 0.9 * k;                    /* 流星头部微光 */
      starsCtx.fillStyle = "#f4f6ff";
      starsCtx.beginPath(); starsCtx.arc(m.x, m.y, 1.6, 0, Math.PI * 2); starsCtx.fill();
      starsCtx.globalAlpha = 1;
    }
  }

  function makeLeaves() {
    const w = leavesCv.width = innerWidth, h = leavesCv.height = innerHeight;
    const count = Math.min(11, Math.max(6, Math.round(w / 190)));
    leafField = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      size: 13 + Math.random() * 9,
      vy: 0.18 + Math.random() * 0.35,                   /* 缓缓飘落 */
      sway: 0.4 + Math.random() * 0.8, phase: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI * 2, rs: (Math.random() - 0.5) * 0.012,
      a: 0.18 + Math.random() * 0.2,                     /* 低透明度，纯背景 */
    }));
  }
  function drawLeaves(now) {
    const w = leavesCv.width, h = leavesCv.height;
    leavesCtx.clearRect(0, 0, w, h);
    for (const L of leafField) {
      if (!reduceMotion.matches) {
        L.y += L.vy; L.phase += 0.008;
        L.x += Math.sin(L.phase) * L.sway;
        L.rot += L.rs;
        if (L.y > h + 24) { L.y = -24; L.x = Math.random() * w; }
        if (L.x > w + 24) L.x = -24; else if (L.x < -24) L.x = w + 24;
      }
      leavesCtx.save();
      leavesCtx.translate(L.x, L.y); leavesCtx.rotate(L.rot);
      leavesCtx.globalAlpha = L.a;
      leavesCtx.font = L.size + "px serif";
      leavesCtx.textAlign = "center"; leavesCtx.textBaseline = "middle";
      leavesCtx.fillText("🍁", 0, 0);
      leavesCtx.restore();
    }
    leavesCtx.globalAlpha = 1;
  }

  function ambLoop(now) {
    if (cvVisible(starsCv)) drawNight(now);
    else if (cvVisible(leavesCv)) drawLeaves(now);
    ambRAF = requestAnimationFrame(ambLoop);
  }
  function syncAmbient() {
    cancelAnimationFrame(ambRAF); ambRAF = 0;
    starsCtx.clearRect(0, 0, starsCv.width, starsCv.height);
    leavesCtx.clearRect(0, 0, leavesCv.width, leavesCv.height);
    if (cvVisible(starsCv)) makeStars(); else makeLeaves();
    if (reduceMotion.matches) { cvVisible(starsCv) ? drawNight(0) : drawLeaves(0); return; }
    ambRAF = requestAnimationFrame(ambLoop);
  }
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => requestAnimationFrame(syncAmbient));
  window.addEventListener("resize", () => requestAnimationFrame(syncAmbient));

  /* ====================== 朱批之笔 ====================== */
  const page = $("#page"), ink = $("#inkLayer"), ictx = ink.getContext("2d");
  const HL = { color: "#f0c33c", alpha: 0.32 };
  let strokes = [], drawing = null;
  let penColor = "#e64545", penBold = false, penHL = false, penErase = false;

  /* 画布只有一屏大：笔迹存文档坐标，滚动时平移重绘。
     这样无论文章多长都不会触碰浏览器的 canvas 尺寸上限。 */
  function resizeInk() {
    const w = innerWidth, h = innerHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ink.style.width = w + "px"; ink.style.height = h + "px";
    ink.width = Math.round(w * dpr); ink.height = Math.round(h * dpr);
    ictx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawInk();
  }
  function drawStroke(s) {
    const p = s.pts;
    ictx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
    ictx.strokeStyle = s.color; ictx.fillStyle = s.color;
    ictx.globalAlpha = s.alpha; ictx.lineWidth = s.width;
    ictx.lineCap = "round"; ictx.lineJoin = "round";
    if (p.length < 2) { ictx.beginPath(); ictx.arc(p[0][0], p[0][1], s.width / 2, 0, Math.PI * 2); ictx.fill(); ictx.globalAlpha = 1; ictx.globalCompositeOperation = "source-over"; return; }
    ictx.beginPath(); ictx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < p.length - 1; i++) {
      ictx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    }
    ictx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
    ictx.stroke(); ictx.globalAlpha = 1;
    ictx.globalCompositeOperation = "source-over";
  }
  function redrawInk() {
    ictx.clearRect(0, 0, ink.width, ink.height);
    if (!strokes.length) return;
    const sy = window.scrollY || 0, sx = window.scrollX || 0;
    const top = sy - 80, bottom = sy + innerHeight + 80;
    ictx.save();
    ictx.translate(-sx, -sy);                       /* 文档坐标 → 视口坐标 */
    for (const s of strokes) {
      if (s.maxY < top || s.minY > bottom) continue; /* 视口外的笔迹跳过 */
      drawStroke(s);
    }
    ictx.restore();
    ictx.globalCompositeOperation = "source-over";
  }
  function clearInk() { strokes = []; ictx.clearRect(0, 0, ink.width, ink.height); }
  const inkPos = (e) => [e.clientX + (window.scrollX || 0), e.clientY + (window.scrollY || 0)];
  const trackY = (s, y) => { if (y < s.minY) s.minY = y; if (y > s.maxY) s.maxY = y; };
  let inkScrollRAF = 0;
  window.addEventListener("scroll", () => {
    if (!strokes.length || inkScrollRAF) return;
    inkScrollRAF = requestAnimationFrame(() => { inkScrollRAF = 0; redrawInk(); });
  }, { passive: true });

  ink.addEventListener("pointerdown", (e) => {
    if (!document.body.classList.contains("pen-on")) return;
    ink.setPointerCapture?.(e.pointerId);
    drawing = {
      erase: penErase,
      color: penErase ? "#000" : (penHL ? HL.color : penColor),
      alpha: penErase ? 1 : (penHL ? HL.alpha : 1),
      width: penErase ? (penBold ? 34 : 18) : (penHL ? (penBold ? 24 : 15) : (penBold ? 6.5 : 3)),
      pts: [inkPos(e)],
      minY: Infinity, maxY: -Infinity,
    };
    trackY(drawing, drawing.pts[0][1]);
    strokes.push(drawing); redrawInk(); e.preventDefault();
  });
  ink.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    const p = inkPos(e);
    drawing.pts.push(p); trackY(drawing, p[1]);
    redrawInk();
  });
  ink.addEventListener("pointerup", () => (drawing = null));
  ink.addEventListener("pointercancel", () => (drawing = null));

  function togglePen(force) {
    const on = force !== undefined ? force : !document.body.classList.contains("pen-on");
    document.body.classList.toggle("pen-on", on);
    if (on) resizeInk();
  }
  $("#penFab").addEventListener("click", () => togglePen());
  $("#exitPen").addEventListener("click", () => togglePen(false));
  $("#clearInk").addEventListener("click", clearInk);
  const eraseBtn = $("#penErase");
  document.querySelectorAll(".swatch").forEach(sw => sw.addEventListener("click", () => {
    document.querySelectorAll(".swatch").forEach(s => s.classList.remove("on"));
    sw.classList.add("on");
    penHL = sw.dataset.color === "hl";
    if (!penHL) penColor = sw.dataset.color;
    penErase = false; eraseBtn.classList.remove("on");        /* 选色即收起橡皮 */
  }));
  eraseBtn.addEventListener("click", () => {
    penErase = !penErase;
    eraseBtn.classList.toggle("on", penErase);
    document.querySelectorAll(".swatch").forEach(s => s.classList.toggle("on", !penErase && (penHL ? s.dataset.color === "hl" : s.dataset.color === penColor)));
  });
  const wThin = $("#wThin"), wBold = $("#wBold");
  wThin.addEventListener("click", () => { penBold = false; wThin.classList.add("on"); wBold.classList.remove("on"); });
  wBold.addEventListener("click", () => { penBold = true;  wBold.classList.add("on"); wThin.classList.remove("on"); });
  window.addEventListener("resize", () => requestAnimationFrame(resizeInk));
  let swipe = null;
  document.addEventListener("touchstart", (e) => {
    if (parseRoute().name !== "note" || document.body.classList.contains("pen-on")) { swipe = null; return; }
    const t = e.touches[0]; swipe = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!swipe) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipe.x, dy = t.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) stepNote(dx > 0 ? -1 : 1);  /* 右滑=上一篇 */
  }, { passive: true });

  /* ====================== 快捷键 ====================== */
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") togglePen(false);
    if ((e.key === "ArrowLeft" || e.key === "ArrowRight") &&
        !/INPUT|TEXTAREA/.test(document.activeElement.tagName) &&
        !document.body.classList.contains("pen-on") &&
        !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (stepNote(e.key === "ArrowLeft" ? -1 : 1)) e.preventDefault();
    }
    if (e.key === "/" && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault();
      if (parseRoute().name !== "home") go("#/home");
      requestAnimationFrame(() => { const i = $("#searchInput"); if (i) { i.focus(); i.select(); } });
    }
  });

  /* ====================== 开屏 · 一图一句 ====================== */
  const SCENES = {
    xinghan: { cls: "scene-xinghan" }, muai: { cls: "scene-muai" },
    shanlan: { cls: "scene-shanlan" }, canghai: { cls: "scene-canghai" },
    jinhuo:  { cls: "scene-jinhuo" },  yuebai: { cls: "scene-yuebai", light: true },
  };
  const SPLASH_FALLBACK = {
    quotes: [
      { text: "行到水穷处，坐看云起时。", by: "王维" },
      { text: "星垂平野阔，月涌大江流。", by: "杜甫" },
    ],
    backgrounds: [{ type: "scene", name: "xinghan" }, { type: "scene", name: "muai" }],
  };
  function dismissSplash() {
    const sp = $("#splash"); if (!sp) return;
    sp.classList.add("leave");
    document.body.classList.remove("splash-on");
    setTimeout(() => sp.remove(), 850);
  }
  async function showSplash() {
    const sp = $("#splash"); if (!sp) return;
    if (/^#\/note\//.test(location.hash)) { sp.remove(); return; }   /* 深链直达文章，不打扰 */
    document.body.classList.add("splash-on");
    let cfg = SPLASH_FALLBACK;
    try {
      const j = await fetchJSON("collections/splash.json");
      if (j && Array.isArray(j.quotes) && j.quotes.length) cfg = j;
      if (j && j.enabled === false) { sp.remove(); document.body.classList.remove("splash-on"); return; }
    } catch (_) { /* 取不到配置就用内置兜底 */ }

    /* 背景与诗句各自随机，组合常新 */
    const q = cfg.quotes[Math.random() * cfg.quotes.length | 0];
    const bgs = (cfg.backgrounds && cfg.backgrounds.length) ? cfg.backgrounds : SPLASH_FALLBACK.backgrounds;
    const bg = bgs[Math.random() * bgs.length | 0];
    const bgEl = sp.querySelector(".sp-bg");
    let ink = false;
    if (bg.type === "image" && bg.src) {
      const fb = SCENES[bg.fallback] || SCENES.xinghan;               /* 图片加载前/失败的底色 */
      bgEl.className = "sp-bg " + fb.cls;
      const img = new Image();
      img.onload = () => {
        const d = sp.querySelector(".sp-img");
        if (d) { d.style.backgroundImage = `url("${bg.src}")`; d.classList.add("show"); }
      };
      img.src = bg.src;
      ink = !!bg.light;
    } else {
      const sc = SCENES[bg.name] || SCENES.xinghan;
      bgEl.className = "sp-bg " + sc.cls;
      ink = !!sc.light;
    }
    sp.classList.toggle("sp-ink", ink);

    /* 诗句逐字浮现 */
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sp.querySelector("#spQuote").innerHTML = [...q.text].map((ch, i) =>
      `<span style="animation-delay:${reduce ? 0 : 150 + i * 70}ms">${esc(ch)}</span>`).join("");
    sp.querySelector("#spBy").textContent = q.by ? "—— " + q.by : "";

    /* 任意点击 / 回车 / Esc / 空格 进入 */
    sp.addEventListener("click", dismissSplash);
    const onKey = (e) => {
      if (!$("#splash")) { document.removeEventListener("keydown", onKey); return; }
      if (["Enter", "Escape", " "].includes(e.key)) { e.preventDefault(); dismissSplash(); document.removeEventListener("keydown", onKey); }
    };
    document.addEventListener("keydown", onKey);
  }

  /* ====================== 启动 ====================== */
  applyTheme();
  showSplash();
  loadAll().then(render).catch((err) => {
    console.error(err);
    app.innerHTML = `<div class="about-wrap fade-in">
      <header class="page-head"><h2>书 斋 尚 未 开 张</h2></header>
      <div class="about-card"><div class="md" id="errBody"></div></div></div>`;
    $("#errBody").innerHTML = marked.parse([
      "读取 `notes/manifest.json` 失败。常见原因有两个：",
      "",
      "1. **直接双击打开了 index.html** —— 浏览器不允许网页读取本地文件。请在项目目录运行 `python3 -m http.server 8000`，然后访问 `http://localhost:8000`；或将整个文件夹部署到静态托管。",
      "2. **还没有生成索引** —— 在项目根目录运行 `python3 build.py`。",
    ].join("\n"));
  });
})();

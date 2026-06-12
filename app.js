/* ============================================================
   拾叶集 · 核心脚本
   路由 / 数据加载 / 模糊搜索 / 主题与星空 / 朱批之笔
   ============================================================ */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ====================== 数据 ====================== */
  const store = { notes: [], snippets: [], sites: [], tools: [], prompts: [], about: "" };
  let homeQuery = "", activeTag = null, activeLang = null;

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
        return { id: i, title: m.title || m.file, date: m.date || "", tags: m.tags || [], md, plain: toPlain(md) };
      } catch (_) { return null; }
    }));
    store.notes = list.filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : -1));

    /* 其余板块：缺了哪个都不影响别的 */
    const [sn, si, to, pr, ab] = await Promise.allSettled([
      fetchJSON("snippets/manifest.json").then(man =>
        Promise.all((man.snippets || []).map(async (s) => {
          try { return { ...s, code: (await fetchText("snippets/" + encodeURIComponent(s.file))).replace(/\s+$/, "") }; }
          catch (_) { return null; }
        }))),
      fetchJSON("collections/websites.json"),
      fetchJSON("collections/tools.json"),
      fetchJSON("collections/prompts.json"),
      fetchText("pages/about.md"),
    ]);
    if (sn.status === "fulfilled") store.snippets = sn.value.filter(Boolean);
    if (si.status === "fulfilled") store.sites = si.value;
    if (to.status === "fulfilled") store.tools = to.value;
    if (pr.status === "fulfilled") store.prompts = pr.value;
    if (ab.status === "fulfilled") store.about = ab.value;
  }

  /* ====================== 搜索引擎 ======================
     Google 式语法："精确短语"  -排除  A OR B  tag:标签  title:词  before:/after:日期
     普通词项：连续子串优先；其次受控模糊（限制字符间隙，杜绝"什么都匹配"的噪声）。 */
  function parseQuery(q) {
    const out = { groups: [], not: [], tags: [], titles: [], before: null, after: null };
    const toks = q.match(/-?"[^"]*"|\S+/g) || [];
    let pendingOr = false;
    for (let tok of toks) {
      let neg = false;
      if (tok.startsWith("-") && tok.length > 1) { neg = true; tok = tok.slice(1); }
      let phrase = false;
      if (/^".*"$/.test(tok)) { phrase = true; tok = tok.slice(1, -1); }
      if (!phrase) {
        if (tok === "OR") { pendingOr = true; continue; }
        const f = tok.match(/^(tag|title|before|after)[:：](.+)$/i);
        if (f && !neg) {
          const key = f[1].toLowerCase(), v = f[2];
          if (key === "tag") out.tags.push(v.toLowerCase());
          else if (key === "title") out.titles.push(v.toLowerCase());
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
    const title = fields.title || "", tags = fields.tags || [], body = fields.body || "";
    const hay = title + "\n" + tags.join(" ") + "\n" + body;
    for (const n of p.not) if (unitMatch(n, hay)) return null;
    for (const t of p.tags) if (!tags.some(x => String(x).toLowerCase().includes(t))) return null;
    for (const t of p.titles) if (!title.toLowerCase().includes(t)) return null;
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
    if (filterOnly && !(p.tags.length || p.titles.length || p.before || p.after || p.not.length)) return null;
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
    const views = { home: viewHome, note: viewNote, code: viewCode, prompts: viewPrompts, sites: viewSites, tools: viewTools, about: viewAbout, term: viewTerm };
    (views[r.name] || viewHome)(r.arg);
    const navKey = r.name === "note" ? "home" : r.name;
    document.querySelectorAll("#mainNav a").forEach(a => a.classList.toggle("on", a.dataset.route === navKey));
    document.body.classList.toggle("term-mode", r.name === "term");
    clearInk();
    window.scrollTo({ top: 0 });
    requestAnimationFrame(resizeInk);
  }
  window.addEventListener("hashchange", render);
  $("#brandHome").addEventListener("click", () => go("#/home"));

  /* ====================== 视图 · 首页 ====================== */
  function viewHome() {
    const tags = [...new Set(store.notes.flatMap(n => n.tags))];
    app.innerHTML = `
      <section class="hero fade-in">
        <div class="halo"></div>
        <h2>拾叶集</h2>
        <p class="motto">摘 星 与 拾 叶 · 把 散 落 的 思 绪 钉 在 星 空 之 下</p>
        <div class="stats">
          <span class="stat-chip">笔记 <b>${store.notes.length}</b> 篇</span>
          <span class="stat-chip">代码 <b>${store.snippets.length}</b> 段</span>
          <span class="stat-chip">提示词 <b>${store.prompts.length}</b> 条</span>
          <span class="stat-chip">收藏 <b>${store.sites.length + store.tools.length}</b> 处</span>
        </div>
        <div class="search-wrap">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
          <input id="searchInput" type="search" placeholder='搜索书斋 · 支持 "短语" -排除 OR tag: title:' autocomplete="off">
          <kbd>/</kbd>
        </div>
        <div class="tag-row" id="tagRow">
          ${tags.map(t => `<button class="tag-chip${t === activeTag ? " on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}
        </div>
      </section>
      <div id="homeResults"></div>`;
    const input = $("#searchInput");
    input.value = homeQuery;
    input.addEventListener("input", () => { homeQuery = input.value; renderHomeResults(); });
    $("#tagRow").addEventListener("click", (e) => {
      const b = e.target.closest(".tag-chip"); if (!b) return;
      activeTag = activeTag === b.dataset.tag ? null : b.dataset.tag;
      document.querySelectorAll("#tagRow .tag-chip").forEach(x => x.classList.toggle("on", x.dataset.tag === activeTag));
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
      if (activeTag && !n.tags.includes(activeTag)) continue;
      let m = { score: 0, titleIdx: [], contentIdx: [] };
      if (parsed) {
        const r0 = evalQuery(parsed, { title: n.title, tags: n.tags, body: n.plain, date: n.date });
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
           <span style="font-size:12px">试试高级语法：<code>"精确短语"</code> · <code>-排除词</code> · <code>A OR B</code> · <code>tag:前端</code> · <code>title:闭包</code> · <code>after:2026-01</code></span></div>`;

    /* 跨板块命中（仅搜索时显示） */
    if (q) {
      const hit = (fields) => evalQuery(parsed, fields);
      const groups = [
        { label: "代 码 集", route: "#/code",
          hits: store.snippets.filter(s => hit({ title: s.title, tags: (s.tags || []).concat(s.lang), body: s.desc || "" })), key: s => s.title },
        { label: "提 示 词", route: "#/prompts",
          hits: store.prompts.filter(p => hit({ title: p.title, tags: p.tags || [], body: (p.desc || "") + " " + p.prompt })), key: p => p.title },
        { label: "网 站 收 藏", route: "#/sites",
          hits: store.sites.filter(s => hit({ title: s.name, tags: s.tags || [], body: s.desc || "" })), key: s => s.name },
        { label: "工 具 箱", route: "#/tools",
          hits: store.tools.filter(s => hit({ title: s.name, tags: s.tags || [], body: s.desc || "" })), key: s => s.name },
      ];
      for (const g of groups) {
        if (!g.hits.length) continue;
        html += `<div class="hit-group"><h4>${g.label}</h4>` + g.hits.slice(0, 5).map(h =>
          `<button class="hit-line" data-go="${g.route}"><span>${esc(g.key(h))}</span><span class="where">${esc((h.desc || "").slice(0, 40))}</span></button>`).join("") + `</div>`;
      }
    }
    box.innerHTML = html;
    box.querySelectorAll("[data-note]").forEach(el => el.addEventListener("click", () => go("#/note/" + el.dataset.note)));
    box.querySelectorAll("[data-go]").forEach(el => el.addEventListener("click", () => go(el.dataset.go)));
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
                <span>${esc(n.date)}</span><span>·</span>
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

  /* ====================== 视图 · 代码集 ====================== */
  function viewCode() {
    const langs = [...new Set(store.snippets.map(s => s.lang))];
    const cur = activeLang && langs.includes(activeLang) ? activeLang : null;
    app.innerHTML = `
      <div class="fade-in">
        <header class="page-head">
          <h2>代 码 集</h2>
          <p>自 己 打 磨 的 小 脚 本 · 随 用 随 取</p>
        </header>
        <div class="lang-row" id="langRow">
          <button class="tag-chip${cur ? "" : " on"}" data-lang="">全部</button>
          ${langs.map(l => `<button class="tag-chip${l === cur ? " on" : ""}" data-lang="${esc(l)}">${esc(LANG_LABEL[l] || l)}</button>`).join("")}
        </div>
        <div id="snippetList"></div>
      </div>`;
    $("#langRow").addEventListener("click", (e) => {
      const b = e.target.closest(".tag-chip"); if (!b) return;
      activeLang = b.dataset.lang || null;
      document.querySelectorAll("#langRow .tag-chip").forEach(x => x.classList.toggle("on", (x.dataset.lang || null) === activeLang));
      renderSnippets();
    });
    renderSnippets();
  }
  function renderSnippets() {
    const list = $("#snippetList"); if (!list) return;
    const items = store.snippets.filter(s => !activeLang || s.lang === activeLang);
    list.innerHTML = "";
    if (!items.length) { list.innerHTML = `<div class="empty-result">这一类还没有收藏代码。往 snippets/ 里丢文件，跑一次 build.py 即可。</div>`; return; }
    items.forEach(s => list.appendChild(buildCodeBlock({ code: s.code, lang: s.lang, file: s.file, desc: s.desc })));
  }

  /* ====================== 视图 · 提示词收藏 ====================== */
  let activePTag = null;
  async function copyText(text, btn) {
    try { await navigator.clipboard.writeText(text); }
    catch (_) {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (_) {}
      ta.remove();
    }
    if (btn) { const t = btn.textContent; btn.textContent = "已复制 ✓"; setTimeout(() => (btn.textContent = t), 1400); }
  }
  function viewPrompts() {
    const tags = [...new Set(store.prompts.flatMap(p => p.tags || []))];
    const cur = activePTag && tags.includes(activePTag) ? activePTag : null;
    app.innerHTML = `
      <div class="fade-in">
        <header class="page-head">
          <h2>提 示 词</h2>
          <p>驯 服 大 模 型 的 咒 语 · 一 键 取 用</p>
        </header>
        <div class="lang-row" id="pTagRow">
          <button class="tag-chip${cur ? "" : " on"}" data-tag="">全部</button>
          ${tags.map(t => `<button class="tag-chip${t === cur ? " on" : ""}" data-tag="${esc(t)}">${esc(t)}</button>`).join("")}
        </div>
        <div id="promptList"></div>
      </div>`;
    $("#pTagRow").addEventListener("click", (e) => {
      const b = e.target.closest(".tag-chip"); if (!b) return;
      activePTag = b.dataset.tag || null;
      document.querySelectorAll("#pTagRow .tag-chip").forEach(x => x.classList.toggle("on", (x.dataset.tag || null) === activePTag));
      renderPrompts();
    });
    renderPrompts();
  }
  function renderPrompts() {
    const list = $("#promptList"); if (!list) return;
    const items = store.prompts.filter(p => !activePTag || (p.tags || []).includes(activePTag));
    list.innerHTML = "";
    if (!items.length) {
      list.innerHTML = `<div class="empty-result">这一类还没有提示词。编辑 collections/prompts.json 添一条吧。</div>`;
      return;
    }
    items.forEach(p => {
      const card = document.createElement("div");
      const long = p.prompt.length > 300;
      card.className = "prompt-card" + (long ? " collapsed" : "");
      card.innerHTML = `
        <div class="pc-head">
          <span class="pc-ic">✦</span>
          <span class="pc-title">${esc(p.title)}</span>
          <span class="nc-tags">${(p.tags || []).map(t => `<span class="mini-tag">${esc(t)}</span>`).join("")}</span>
          <button class="copy-btn pc-copy">复制</button>
        </div>
        ${p.desc ? `<div class="pc-desc">${esc(p.desc)}</div>` : ""}
        <div class="pc-body"><div class="pc-text">${esc(p.prompt)}</div></div>
        ${long ? `<button class="pc-more">展开全文 ▾</button>` : ""}`;
      card.querySelector(".pc-copy").addEventListener("click", (e) => copyText(p.prompt, e.currentTarget));
      const more = card.querySelector(".pc-more");
      if (more) more.addEventListener("click", () => {
        const folded = card.classList.toggle("collapsed");
        more.textContent = folded ? "展开全文 ▾" : "收起 ▴";
      });
      list.appendChild(card);
    });
  }

  /* ====================== 视图 · 收藏（网站 / 工具） ====================== */
  function linkGrid(items) {
    if (!items.length) return `<div class="empty-result">收藏夹还空着，去 collections/ 里添一条吧。</div>`;
    return `<div class="link-grid">` + items.map(s => `
      <a class="link-card fade-in" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">
        <span class="glyph">${esc(s.icon || "🔗")}</span>
        <span class="lc-body">
          <h3>${esc(s.name)} <span class="arrow">↗</span></h3>
          <p>${esc(s.desc || "")}</p>
          <span class="nc-tags">${(s.tags || []).map(t => `<span class="mini-tag">${esc(t)}</span>`).join("")}</span>
        </span>
      </a>`).join("") + `</div>`;
  }
  function viewSites() {
    app.innerHTML = `<div class="fade-in">
      <header class="page-head"><h2>网 站 收 藏</h2><p>常 去 的 好 地 方 · 一 键 直 达</p></header>
      ${linkGrid(store.sites)}</div>`;
  }
  function viewTools() {
    app.innerHTML = `<div class="fade-in">
      <header class="page-head"><h2>工 具 箱</h2><p>顺 手 的 兵 器 · 各 有 所 长</p></header>
      ${linkGrid(store.tools)}</div>`;
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

  /* ====================== 视图 · 终端 ====================== */
  const term = { lines: [], hist: [], hidx: -1, cwd: ["~"], prevCwd: ["~"], booted: false, lastSearch: [], comp: null, ghost: "" };
  const ALIASES = { ll: "ls -l", la: "ls", cls: "clear", "..": "cd ..", "?": "help" };
  const setCaretEnd = (f) => f.setSelectionRange(f.value.length, f.value.length);
  const closeMenu = () => { term.comp = null; const m = $("#termMenu"); if (m) m.innerHTML = ""; };
  const C = (cls, s) => `<span class="${cls}">${esc(s)}</span>`;
  let fsRoot = null;

  function fsInit() {
    const file = (text) => ({ f: true, text });
    const dir = (c) => ({ d: true, c });
    const notesDir = {}, snipDir = {};
    store.notes.forEach(n => {
      let fname = (n.date ? n.date + "-" : "") + n.title.replace(/[\/\s]+/g, "-").slice(0, 24) + ".md";
      if (notesDir[fname]) fname = fname.replace(/\.md$/, "-" + n.id + ".md");  /* 避免同名覆盖 */
      notesDir[fname] = { f: true, noteId: n.id, text: `# ${n.title}\n${n.date}  ${n.tags.map(t => "#" + t).join(" ")}\n\n${n.md}` };
    });
    store.snippets.forEach(s => { snipDir[s.file] = file((s.desc ? "#: " + s.desc + "\n" : "") + s.code); });
    fsRoot = dir({
      "notes": dir(notesDir),
      "snippets": dir(snipDir),
      "collections": dir({
        "websites.json": file(JSON.stringify(store.sites, null, 2)),
        "tools.json": file(JSON.stringify(store.tools, null, 2)),
        "prompts.json": file(JSON.stringify(store.prompts, null, 2)),
      }),
      "pages": dir({ "about.md": file(store.about || "（空）") }),
      "README.md": file("拾叶集 · 个人书斋\n\n这是一个虚拟终端，文件系统映射了整座网站：\n  notes/        全部笔记\n  snippets/     代码片段\n  collections/  网站与工具收藏\n  pages/        关于页\n\n输入 help 查看全部命令；cat 阅读文件；open 跳转到精装版页面。"),
    });
    return fsRoot;
  }
  function fsResolve(pathStr) {
    /* 返回 { node, parts } 或 null */
    let parts;
    const p = (pathStr || "").trim();
    if (!p) parts = term.cwd.slice(1);            // 空路径 = 当前目录
    else if (p === "~") parts = [];
    else if (p.startsWith("~/")) parts = p.slice(2).split("/");
    else if (p.startsWith("/")) parts = p.slice(1).split("/");
    else parts = term.cwd.slice(1).concat(p.split("/"));
    const stack = [];
    for (const seg of parts) {
      if (!seg || seg === ".") continue;
      if (seg === "..") { stack.pop(); continue; }
      stack.push(seg);
    }
    let node = fsInit();
    for (const seg of stack) {
      if (!node.d || !node.c[seg]) return null;
      node = node.c[seg];
    }
    return { node, parts: stack };
  }
  const promptHTML = () =>
    C("t-grn t-b", "visitor@shiyeji") + C("t-dim", ":") +
    C("t-cyn t-b", term.cwd.join("/").replace(/^~\/?/, "~/").replace(/\/$/, "") || "~") +
    C("t-dim", " $ ");

  function tPrint(html) { term.lines.push(html); const out = $("#termOut"); if (out) { const div = document.createElement("div"); div.className = "ln"; div.innerHTML = html; out.appendChild(div); } }
  function tScroll() { const sc = $("#termScreen"); if (sc) sc.scrollTop = sc.scrollHeight; }

  const BANNER = [
    C("t-pur", "  ╭──────────────────────────────────────────╮"),
    C("t-pur", "  │ ") + C("t-grn t-b", "拾 叶 集") + C("t-dim", "  ·  SHIYEJI TERMINAL  v2.0") + C("t-pur", "      │"),
    C("t-pur", "  │ ") + C("t-dim", "一座可以敲命令逛的书斋") + C("t-pur", "                   │"),
    C("t-pur", "  ╰──────────────────────────────────────────╯"),
    "",
    C("t-dim", "  输入 ") + C("t-ylw", "help") + C("t-dim", " 查看命令 · ") + C("t-ylw", "ls") + C("t-dim", " 看看有什么 · ") + C("t-ylw", "neofetch") + C("t-dim", " 自报家门"),
    "",
  ];

  const COMMANDS = {
    help: { desc: "显示全部命令", run() {
      const rows = [
        ["ls [-l] / ll", "列出目录（输出可点击！）"], ["cd <路径>", "进入目录（.. 上级 / - 上一个）"],
        ["cat <文件>", "阅读文件内容"], ["tree", "树状图看整个书斋（可点击）"],
        ["open <文件|序号>", "跳到精装版页面阅读"], ["search <关键词>", "全站模糊搜索"],
        ["man <命令>", "查看命令手册"], ["theme <dark|light|auto>", "切换主题"],
        ["neofetch / whoami / date", "书斋信息 / 你是谁 / 几点了"],
        ["history / !! / !<n>", "历史 / 重复上一条 / 执行第 n 条"],
        ["echo <文字>", "回声"], ["clear / cls", "清屏（Ctrl+L 同）"], ["exit", "回到首页"],
      ];
      tPrint(C("t-b", "可用命令"));
      rows.forEach(([c, d]) => tPrint("  " + C("t-ylw", c.padEnd(26)) + C("t-dim", d)));
      tPrint("");
      tPrint(C("t-dim", "顺手功能：") );
      tPrint(C("t-dim", "  · Tab 补全；候选多时再按 Tab 在菜单里循环选（Shift+Tab 反向），Esc 收起"));
      tPrint(C("t-dim", "  · 输入时的灰色建议来自历史，按 → 一键接受"));
      tPrint(C("t-dim", "  · cmd1 && cmd2 串联执行；输出里带下划线的名字都能点"));
    }},
    pwd: { run() { tPrint(C("t-cyn", term.cwd.join("/") || "~")); } },
    ls: { run(rawArg) {
      const parts = (rawArg || "").split(/\s+/).filter(Boolean);
      const long = parts.some(p => /^-\w*l/.test(p));
      const path = parts.filter(p => !p.startsWith("-")).join(" ");
      const r = fsResolve(path);
      if (!r) return tPrint(C("t-pnk", `ls: 无法访问 '${path}'：没有那个文件或目录`));
      if (r.node.f) return tPrint(esc(path));
      const names = Object.keys(r.node.c);
      if (!names.length) return tPrint(C("t-dim", "（空目录）"));
      const prefix = path ? (path.endsWith("/") ? path : path + "/") : "";
      const link = (n) => {
        const node = r.node.c[n];
        const cls = node.d ? "t-cyn t-b t-link" : (n.endsWith(".md") ? "t-grn t-link" : "t-org t-link");
        const cmd = node.d ? `cd ${prefix}${n} && ls` : `cat ${prefix}${n}`;
        return `<span class="${cls}" data-cmd="${esc(cmd)}">${esc(n)}${node.d ? "/" : ""}</span>`;
      };
      if (!long) return tPrint(names.map(link).join("  "));
      names.forEach(n => {
        const node = r.node.c[n];
        const size = node.d ? Object.keys(node.c).length + " 项" : node.text.length + " 字";
        const date = node.noteId !== undefined ? (store.notes.find(x => x.id === node.noteId) || {}).date || "" : "";
        tPrint(C("t-dim", (node.d ? "d" : "-") + "r--") + "  " +
               C("t-pur", String(size).padStart(8)) + "  " +
               C("t-dim", (date || "—").padEnd(10)) + "  " + link(n));
      });
    }},
    cd: { run(arg) {
      const before = term.cwd.slice();
      if (!arg || arg === "~") { term.cwd = ["~"]; term.prevCwd = before; return; }
      if (arg === "-") {                                 /* cd - 回到上一个目录 */
        [term.cwd, term.prevCwd] = [term.prevCwd, term.cwd];
        return tPrint(C("t-cyn", term.cwd.join("/")));
      }
      const r = fsResolve(arg);
      if (!r) return tPrint(C("t-pnk", `cd: ${arg}: 没有那个目录`));
      if (!r.node.d) return tPrint(C("t-pnk", `cd: ${arg}: 不是目录`));
      term.cwd = ["~", ...r.parts]; term.prevCwd = before;
    }},
    cat: { run(arg) {
      if (!arg) return tPrint(C("t-pnk", "cat: 缺少文件名"));
      const r = fsResolve(arg);
      if (!r) return tPrint(C("t-pnk", `cat: ${arg}: 没有那个文件`));
      if (r.node.d) return tPrint(C("t-pnk", `cat: ${arg}: 是一个目录`));
      const allLines = r.node.text.split("\n");
      const CAP = 400;
      const shown = allLines.length > CAP ? allLines.slice(0, CAP) : allLines;
      shown.forEach(line => {
        if (/^#{1,3}\s/.test(line)) tPrint(C("t-pur t-b", line));
        else if (/^>\s?/.test(line)) tPrint(C("t-ylw", line));
        else if (/^(#:|\/\/:|\s*#)/.test(line)) tPrint(C("t-dim", line));
        else tPrint(esc(line));
      });
      if (allLines.length > CAP)
        tPrint(C("t-pnk", `…（全文 ${allLines.length} 行，已截断前 ${CAP} 行）`) +
               C("t-dim", " 终端适合速览，长文请 ") + C("t-ylw", `open ${arg}`));
      if (r.node.noteId !== undefined && allLines.length <= CAP)
        tPrint(C("t-dim", "── 用 ") + C("t-ylw", `open ${arg}`) + C("t-dim", " 可跳转到精装阅读版"));
    }},
    tree: { run() {
      const walk = (node, prefix, p) => {
        const names = Object.keys(node.c);
        names.forEach((n, i) => {
          const last = i === names.length - 1;
          const child = node.c[n];
          const full = p + "/" + n;
          const lab = child.d
            ? `<span class="t-cyn t-b t-link" data-cmd="${esc(`cd ${full} && ls`)}">${esc(n)}/</span>`
            : `<span class="t-grn t-link" data-cmd="${esc(`cat ${full}`)}">${esc(n)}</span>`;
          tPrint(C("t-dim", prefix + (last ? "└── " : "├── ")) + lab);
          if (child.d) walk(child, prefix + (last ? "    " : "│   "), full);
        });
      };
      tPrint(C("t-cyn t-b", "~/"));
      walk(fsInit(), "", "");
    }},
    open: { run(arg) {
      if (!arg) return tPrint(C("t-pnk", "open: 要打开哪个？给文件路径或 search 结果序号"));
      if (/^\d+$/.test(arg)) {
        const hit = term.lastSearch[+arg - 1];
        if (!hit) return tPrint(C("t-pnk", `open: 序号 ${arg} 不在上次搜索结果里`));
        tPrint(C("t-dim", "正在打开 → " + hit.title));
        return setTimeout(() => go(hit.route), 350);
      }
      const r = fsResolve(arg);
      if (!r) return tPrint(C("t-pnk", `open: ${arg}: 没有那个文件`));
      if (r.node.noteId !== undefined) { tPrint(C("t-dim", "正在装订书页…")); return setTimeout(() => go("#/note/" + r.node.noteId), 350); }
      const top = r.parts[0];
      const route = { snippets: "#/code", collections: "#/sites", pages: "#/about" }[top];
      if (route) { tPrint(C("t-dim", "正在前往…")); return setTimeout(() => go(route), 350); }
      tPrint(C("t-pnk", "open: 这个文件没有对应的页面，试试 cat"));
    }},
    search: { run(arg) {
      if (!arg) return tPrint(C("t-pnk", "search: 缺少关键词"));
      const p = parseQuery(arg);
      const hits = [];
      for (const n of store.notes) {
        const r0 = evalQuery(p, { title: n.title, tags: n.tags, body: n.plain, date: n.date });
        if (r0) hits.push({ score: r0.score, title: n.title, where: "笔记", route: "#/note/" + n.id });
      }
      for (const s of store.snippets) if (evalQuery(p, { title: s.title, tags: (s.tags || []).concat(s.lang), body: s.desc || "" })) hits.push({ score: 50, title: s.file + " — " + (s.desc || ""), where: "代码", route: "#/code" });
      for (const s of store.prompts) if (evalQuery(p, { title: s.title, tags: s.tags || [], body: (s.desc || "") + " " + s.prompt })) hits.push({ score: 45, title: s.title, where: "提示", route: "#/prompts" });
      for (const s of store.sites) if (evalQuery(p, { title: s.name, tags: s.tags || [], body: s.desc || "" })) hits.push({ score: 40, title: s.name, where: "网站", route: "#/sites" });
      for (const s of store.tools) if (evalQuery(p, { title: s.name, tags: s.tags || [], body: s.desc || "" })) hits.push({ score: 40, title: s.name, where: "工具", route: "#/tools" });
      hits.sort((a, b) => b.score - a.score);
      term.lastSearch = hits.slice(0, 9);
      if (!term.lastSearch.length) return tPrint(C("t-dim", "没有找到与 “" + arg + "” 相关的内容。"));
      term.lastSearch.forEach((h, i) =>
        tPrint("  " + C("t-pur t-b", "[" + (i + 1) + "]") + " " + C("t-dim", h.where.padEnd(3, "　")) + " " +
               `<span class="t-link" data-go="${esc(h.route)}">${esc(h.title)}</span>`));
      tPrint(C("t-dim", "点击标题或用 ") + C("t-ylw", "open <序号>") + C("t-dim", " 打开"));
    }},
    theme: { run(arg) {
      const map = { dark: 2, light: 1, auto: 0, "星渊": 2, "拿铁": 1 };
      if (!(arg in map)) return tPrint(C("t-pnk", "用法：theme dark | light | auto"));
      themeIdx = map[arg]; applyTheme();
      tPrint(C("t-dim", "主题已切换 → ") + C("t-cyn", THEMES[themeIdx].label));
    }},
    neofetch: { run() {
      const art = ["   🍂        ", "  ✦  ·  ✦   ", " ·  拾叶  ·  ", "  ✦  ·  ✦   ", "   星渊书斋  "];
      const eff = document.documentElement.getAttribute("data-theme") || "auto";
      const info = [
        [C("t-grn t-b", "visitor") + C("t-dim", "@") + C("t-grn t-b", "shiyeji"), ""],
        [C("t-dim", "─".repeat(22)), ""],
        ["OS", "ShiYeJi OS (Markdown 内核)"],
        ["Shell", "leaf-sh 2.0"],
        ["Theme", eff === "dark" ? "星渊 ✦" : eff === "light" ? "拿铁 ☀" : "跟随系统 ◐"],
        ["Notes", store.notes.length + " 篇"],
        ["Snippets", store.snippets.length + " 段"],
        ["Bookmarks", (store.sites.length + store.tools.length) + " 处"],
        ["Pen", "朱批之笔 · 已上墨"],
      ];
      info.forEach((row, i) => {
        const left = C("t-pur", (art[i] || "             "));
        tPrint(left + "  " + (row[1] ? C("t-cyn t-b", String(row[0]).padEnd(10)) + C("t-dim", ": ") + esc(row[1]) : row[0]));
      });
    }},
    history: { run() { term.hist.forEach((h, i) => tPrint(C("t-dim", String(i + 1).padStart(4) + "  ") + esc(h))); } },
    echo: { run(arg) { tPrint(esc(arg || "")); } },
    whoami: { run() { tPrint("visitor " + C("t-dim", "—— 欢迎光临，请随意翻阅。")); } },
    date: { run() { tPrint(esc(new Date().toLocaleString("zh-CN", { hour12: false }))); } },
    clear: { run() { term.lines = []; const o = $("#termOut"); if (o) o.innerHTML = ""; } },
    banner: { run() { BANNER.forEach(tPrint); } },
    exit: { run() { tPrint(C("t-dim", "再会。")); setTimeout(() => go("#/home"), 300); } },
    sudo: { run() { tPrint(C("t-pnk", "权限不足：这座书斋只有一位主人。")); } },
    man: { run(arg) {
      const M = {
        ls: ["ls [-l] [路径]", "列出目录内容。-l 显示详情（大小/日期）。输出中的名字可直接点击：目录会 cd 进去，文件会 cat 出来。", "ls -l notes"],
        cd: ["cd <路径>", "切换目录。支持相对/绝对路径、cd .. 上级、cd - 回到上一个目录、cd 回家。", "cd notes && ls"],
        cat: ["cat <文件>", "输出文件内容，Markdown 标题与引用会着色。", "cat README.md"],
        open: ["open <文件|序号>", "跳出终端，到精装版页面阅读。序号来自上一次 search 的结果。", "open 1"],
        search: ["search <关键词>", "全站模糊搜索（支持不连续匹配），结果可点击。", "search 闭包"],
        tree: ["tree", "树状图展示整座书斋，节点皆可点击。", "tree"],
        theme: ["theme <dark|light|auto>", "切换星渊 / 拿铁 / 跟随系统。", "theme dark"],
        history: ["history", "命令历史。!! 重复上一条，!<n> 执行第 n 条。", "!!"],
        help: ["help", "命令总览。", "help"],
      };
      if (!arg) return tPrint(C("t-dim", "用法：man <命令>，例如 man ls"));
      const m = M[arg];
      if (!m) return tPrint(C("t-pnk", `man: 没有 ${arg} 的手册页`));
      tPrint(C("t-b", "名称    ") + esc(arg));
      tPrint(C("t-b", "用法    ") + C("t-ylw", m[0]));
      tPrint(C("t-b", "说明    ") + C("t-dim", m[1]));
      tPrint(C("t-b", "示例    ") + C("t-cyn", "$ " + m[2]));
    }},
  };

  function execOne(input) {
    if (!input) return;
    let sp = input.indexOf(" ");
    let cmd = sp === -1 ? input : input.slice(0, sp);
    let arg = sp === -1 ? "" : input.slice(sp + 1).trim();
    if (ALIASES[cmd]) {                                     /* 别名展开 */
      const merged = ALIASES[cmd] + (arg ? " " + arg : "");
      sp = merged.indexOf(" ");
      cmd = sp === -1 ? merged : merged.slice(0, sp);
      arg = sp === -1 ? "" : merged.slice(sp + 1).trim();
    }
    const c = COMMANDS[cmd];
    if (c) c.run(arg);
    else tPrint(C("t-pnk", `leaf-sh: ${cmd}: 未找到命令`) + C("t-dim", "（help 查看全部命令）"));
  }
  function runCommand(raw) {
    closeMenu();
    let input = raw.trim();
    if (input === "!!") input = term.hist[term.hist.length - 1] || "";   /* 历史展开 */
    else { const bm = input.match(/^!(\d+)$/); if (bm) input = term.hist[+bm[1] - 1] || ""; }
    tPrint(promptHTML() + esc(input || raw));
    if (!input) return;
    term.hist.push(input); term.hidx = term.hist.length;
    input.split("&&").forEach(part => execOne(part.trim()));            /* && 串联 */
  }

  function compCandidates(field) {
    const v = field.value;
    const tokens = v.split(/\s+/);
    const lastTok = tokens[tokens.length - 1] || "";
    const base = v.slice(0, v.length - lastTok.length);
    let cands = [];
    if (tokens.length === 1) {                              /* 补全命令名 */
      const pool = [...new Set([...Object.keys(COMMANDS), ...Object.keys(ALIASES)])].sort();
      cands = pool.filter(n => n.startsWith(lastTok)).map(n => ({ insert: n + " ", label: n, dir: false }));
    } else {                                                /* 补全路径 */
      const slash = lastTok.lastIndexOf("/");
      const basePath = slash === -1 ? "" : lastTok.slice(0, slash + 1);
      const frag = slash === -1 ? lastTok : lastTok.slice(slash + 1);
      const r = fsResolve(basePath);
      if (!r || !r.node.d) return { base, cands: [], lastTok };
      cands = Object.keys(r.node.c).sort().filter(n => n.startsWith(frag))
        .map(n => ({ insert: basePath + n + (r.node.c[n].d ? "/" : ""), label: n + (r.node.c[n].d ? "/" : ""), dir: !!r.node.c[n].d }));
    }
    return { base, cands, lastTok };
  }
  function renderMenu() {
    const m = $("#termMenu"); if (!m) return;
    if (!term.comp) { m.innerHTML = ""; return; }
    m.innerHTML = term.comp.cands.map((c, i) =>
      `<span class="cand ${c.dir ? "t-cyn" : "t-ylw"}${i === term.comp.idx ? " sel" : ""}" data-ci="${i}">${esc(c.label)}</span>`).join("");
    tScroll();
  }
  function applyCand(field) {
    const c = term.comp;
    field.value = c.base + c.cands[c.idx].insert;
    setCaretEnd(field); syncTyped(field);
  }
  function onTab(field, back) {
    if (term.comp) {                                        /* 菜单已开：循环选择 */
      const n = term.comp.cands.length;
      term.comp.idx = ((term.comp.idx + (back ? -1 : 1)) % n + n) % n;
      applyCand(field); renderMenu(); return;
    }
    const { base, cands, lastTok } = compCandidates(field);
    if (!cands.length) return;
    if (cands.length === 1) {                               /* 唯一候选：直接补全 */
      field.value = base + cands[0].insert;
      setCaretEnd(field); syncTyped(field); return;
    }
    /* 多个候选：先补全公共前缀，再弹出菜单等待 Tab 循环 */
    let lcp = cands[0].insert;
    for (const c of cands) { let i = 0; while (i < lcp.length && lcp[i] === c.insert[i]) i++; lcp = lcp.slice(0, i); }
    if (lcp.length > lastTok.length) { field.value = base + lcp; setCaretEnd(field); }
    term.comp = { base, cands, idx: -1 };
    renderMenu(); syncTyped(field);
  }
  function syncTyped(field) {
    const t = $("#termTyped"); if (!t) return;
    const v = field.value;
    const pos = field.selectionStart ?? v.length;
    const at = v.slice(pos, pos + 1);
    t.innerHTML = esc(v.slice(0, pos)) +
      `<span class="caret-block">${at ? esc(at) : "&nbsp;"}</span>` +
      esc(v.slice(pos + 1));
    /* fish 式幽灵建议：来自历史与命令名，→ 接受 */
    let ghost = "";
    if (v && pos === v.length && !term.comp) {
      const h = [...term.hist].reverse().find(x => x.startsWith(v) && x !== v);
      if (h) ghost = h.slice(v.length);
      else { const c = Object.keys(COMMANDS).find(n => n.startsWith(v) && n !== v); if (c) ghost = c.slice(v.length); }
    }
    term.ghost = ghost;
    const g = $("#termGhost"); if (g) g.textContent = ghost;
    const p = $("#termPrompt"); if (p) p.innerHTML = promptHTML();
    const bar = document.querySelector(".term-bar .title");
    if (bar) bar.textContent = "visitor@shiyeji: " + term.cwd.join("/");
  }
  async function termCopy(field) {
    const sel = (window.getSelection() || "").toString();
    const text = sel || field.value;
    if (!text) return;
    try { await navigator.clipboard.writeText(text); }
    catch (_) { try { document.execCommand("copy"); } catch (_) {} }
  }
  async function termPaste(field) {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const s = field.selectionStart ?? field.value.length, e = field.selectionEnd ?? s;
      field.setRangeText(text.replace(/\n/g, " "), s, e, "end");
      syncTyped(field);
    } catch (_) { /* 剪贴板权限被拒：交给浏览器默认 Ctrl+V */ }
  }

  function viewTerm() {
    app.innerHTML = `
      <div class="term-wrap">
        <div class="term-window" id="termWindow">
          <div class="term-bar">
            <span class="dots"><i></i><i></i><i></i></span>
            <span class="title">visitor@shiyeji: ${esc(term.cwd.join("/"))}</span>
            <span class="tipline">
              <span class="keys">Tab 补全 · ↑↓ 历史 · Ctrl+L 清屏</span>
              <button class="fs-btn" id="fsBtn" title="全屏 (F11 体验更佳)">⛶</button>
            </span>
          </div>
          <div class="term-screen" id="termScreen">
            <div id="termOut"></div>
            <div id="termMenu" class="term-menu"></div>
            <div class="ln"><span id="termPrompt"></span><span id="termTyped"></span><span id="termGhost"></span></div>
            <input id="termField" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="终端输入">
          </div>
        </div>
      </div>`;
    fsRoot = null; fsInit(); term.comp = null; term.ghost = "";
    const out = $("#termOut"), field = $("#termField"), screen = $("#termScreen");
    /* 输出区点击委托：路径直达 / 搜索结果跳转 / 菜单候选选择 */
    screen.addEventListener("click", (e) => {
      const g = e.target.closest("[data-go]");
      if (g) { go(g.dataset.go); return; }
      const c = e.target.closest("[data-cmd]");
      if (c) { runCommand(c.dataset.cmd); syncTyped(field); tScroll(); field.focus({ preventScroll: true }); return; }
      const ci = e.target.closest(".cand");
      if (ci && term.comp) {
        term.comp.idx = +ci.dataset.ci;
        applyCand(field); closeMenu();
        field.focus({ preventScroll: true });
      }
    });
    $("#fsBtn").addEventListener("click", async () => {
      const win = $("#termWindow");
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await win.requestFullscreen();
      } catch (_) { /* 不支持就算了 */ }
      field.focus({ preventScroll: true });
    });
    if (!term.booted) { term.booted = true; BANNER.forEach(l => term.lines.push(l)); }
    out.innerHTML = term.lines.map(l => `<div class="ln">${l}</div>`).join("");
    syncTyped(field);
    /* 选中输出文本时不抢焦点（保证原生选择/复制体验） */
    screen.addEventListener("pointerup", () => {
      if (!(window.getSelection() || "").toString()) field.focus({ preventScroll: true });
    });
    ["input", "keyup", "click", "select"].forEach(ev => field.addEventListener(ev, () => syncTyped(field)));
    field.addEventListener("keydown", (e) => {
      const k = e.key, lower = k.toLowerCase();
      /* —— Ctrl+Shift 组合：终端式复制粘贴 —— */
      if (e.ctrlKey && e.shiftKey) {
        if (lower === "c") { e.preventDefault(); termCopy(field); return; }
        if (lower === "v") { e.preventDefault(); termPaste(field); return; }
        return;
      }
      /* —— Ctrl 组合：readline 行编辑 —— */
      if (e.ctrlKey && !e.altKey && !e.metaKey) {
        const pos = field.selectionStart ?? field.value.length;
        switch (lower) {
          case "c": { /* 取消当前行 */
            e.preventDefault();
            tPrint(promptHTML() + esc(field.value) + C("t-dim", "^C"));
            field.value = ""; term.hidx = term.hist.length;
            syncTyped(field); tScroll(); return;
          }
          case "l": e.preventDefault(); COMMANDS.clear.run(); syncTyped(field); return;
          case "a": e.preventDefault(); field.setSelectionRange(0, 0); syncTyped(field); return;
          case "e": e.preventDefault(); field.setSelectionRange(field.value.length, field.value.length); syncTyped(field); return;
          case "u": e.preventDefault(); field.value = field.value.slice(pos); field.setSelectionRange(0, 0); syncTyped(field); return;
          case "k": e.preventDefault(); field.value = field.value.slice(0, pos); syncTyped(field); return;
          case "w": { /* 删除前一个单词 */
            e.preventDefault();
            const left = field.value.slice(0, pos).replace(/\S+\s*$/, "");
            field.value = left + field.value.slice(pos);
            field.setSelectionRange(left.length, left.length);
            syncTyped(field); return;
          }
          case "d": { /* 空行时 Ctrl+D = 退出 */
            if (!field.value) {
              e.preventDefault();
              tPrint(promptHTML() + C("t-dim", "logout"));
              setTimeout(() => go("#/home"), 350);
            }
            return;
          }
        }
        return; /* 其余 Ctrl 组合交还浏览器（如 Ctrl+F） */
      }
      /* —— 普通按键 —— */
      if (k === "Enter") { runCommand(field.value); field.value = ""; term.hidx = term.hist.length; syncTyped(field); tScroll(); }
      else if (k === "ArrowUp") {
        e.preventDefault(); closeMenu();
        if (term.hidx > 0) { term.hidx--; field.value = term.hist[term.hidx] || ""; }
        field.setSelectionRange(field.value.length, field.value.length); syncTyped(field);
      }
      else if (k === "ArrowDown") {
        e.preventDefault(); closeMenu();
        if (term.hidx < term.hist.length) { term.hidx++; field.value = term.hist[term.hidx] || ""; }
        field.setSelectionRange(field.value.length, field.value.length); syncTyped(field);
      }
      else if (k === "Tab") { e.preventDefault(); onTab(field, e.shiftKey); }
      else if (k === "Escape") {
        if (term.comp) { e.preventDefault(); e.stopPropagation(); closeMenu(); syncTyped(field); }
      }
      else if (k === "ArrowRight" || k === "End") {         /* 接受幽灵建议 */
        const pos = field.selectionStart ?? field.value.length;
        if (term.ghost && pos === field.value.length) {
          e.preventDefault();
          field.value += term.ghost;
          setCaretEnd(field); syncTyped(field);
        }
      }
    });
    field.addEventListener("input", () => { closeMenu(); });   /* 手动输入即收起补全菜单 */
    field.focus({ preventScroll: true });
    tScroll();
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

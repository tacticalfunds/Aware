/** UI wiring: directory grid, search/filter, chat panel, settings modal. */

const state = {
  activeCategory: "all",
  searchTerm: "",
  apiKey: localStorage.getItem("aware_api_key") || "",
  model: localStorage.getItem("aware_model") || "claude-sonnet-5",
  routing: localStorage.getItem("aware_routing") === "on" ? "on" : "off",
  // Claude-format conversation the agent appends to, so follow-up turns continue the
  // same investigation with the same findings and tool surface.
  agentHistory: [],
  liveKeys: JSON.parse(localStorage.getItem("aware_live_keys") || "{}"),
  // Each: { media_type, data, name, url, metadata } — data is bare base64, url is
  // the data: URL kept for rendering annotations back over the right photo.
  attachedImages: [],
  sentImages: [],   // the set handed to the agent on the last turn
  fontStep: Math.min(5, Math.max(0, parseInt(localStorage.getItem("aware_font_step") ?? "1", 10) || 0)),
  chatWidth: localStorage.getItem("aware_chat_width") === "wide" ? "wide" : "normal"
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheEls();
  // Probe for the server-side proxy; when present it removes the CORS ceiling and
  // may supply API keys, so the agent gets a much larger set of runnable tools.
  Proxy.detect().then(ok => { if (ok) updateModeBadge(); });
  renderStats();
  renderCategoryPills();
  renderToolsGrid();
  wireDirectory();
  wireChat();
  wireSettings();
  wireChatPrefs();
  updateModeBadge();
  pushBotMessage(
    `Welcome to **Aware** — a single concierge for the OSINT toolkit. I have ${OSINT_TOOLS_FLAT.length} tools ` +
    `across ${OSINT_CATEGORIES.length} categories indexed. Tell me what you're investigating, or click a suggestion below.\n\n` +
    `I can also run **live lookups** — drop an IP, domain, Bitcoin address, or email into the chat and I'll actually ` +
    `query DNS, ipinfo.io, crt.sh, urlscan.io and blockchain.info for you (add your own Shodan/VirusTotal/AbuseIPDB/` +
    `Etherscan/HIBP key in AI settings for more).`,
    []
  );
});

function cacheEls() {
  els.toolsGrid = document.getElementById("toolsGrid");
  els.categoryPills = document.getElementById("categoryPills");
  els.dirSearch = document.getElementById("dirSearch");
  els.statTools = document.getElementById("statTools");
  els.statCategories = document.getElementById("statCategories");
  els.chatMessages = document.getElementById("chatMessages");
  els.chatForm = document.getElementById("chatForm");
  els.chatInput = document.getElementById("chatInput");
  els.modeBadge = document.getElementById("modeBadge");
  els.settingsBtn = document.getElementById("settingsBtn");
  els.settingsModal = document.getElementById("settingsModal");
  els.closeSettings = document.getElementById("closeSettings");
  els.apiKeyInput = document.getElementById("apiKeyInput");
  els.modelSelect = document.getElementById("modelSelect");
  els.routingSelect = document.getElementById("routingSelect");
  els.saveSettings = document.getElementById("saveSettings");
  els.clearSettings = document.getElementById("clearSettings");
  els.suggestions = document.getElementById("chatSuggestions");
  els.attachBtn = document.getElementById("attachBtn");
  els.attachInput = document.getElementById("attachInput");
  els.attachPreview = document.getElementById("attachPreview");
  els.attachStrip = document.getElementById("attachStrip");
  els.attachName = document.getElementById("attachName");
  els.attachRemove = document.getElementById("attachRemove");
  els.fontDown = document.getElementById("fontDown");
  els.fontUp = document.getElementById("fontUp");
  els.widenChat = document.getElementById("widenChat");
  els.liveKeyInputs = {
    shodan: document.getElementById("shodanKeyInput"),
    virustotal: document.getElementById("virustotalKeyInput"),
    abuseipdb: document.getElementById("abuseipdbKeyInput"),
    etherscan: document.getElementById("etherscanKeyInput"),
    hibp: document.getElementById("hibpKeyInput"),
    veriphone: document.getElementById("veriphoneKeyInput"),
    abstractphone: document.getElementById("abstractphoneKeyInput"),
    ipqs: document.getElementById("ipqsKeyInput")
  };
}

function renderStats() {
  els.statTools.textContent = OSINT_TOOLS_FLAT.length;
  els.statCategories.textContent = OSINT_CATEGORIES.length;
}

function renderCategoryPills() {
  const allPill = makePill("all", "All", "🗂️");
  els.categoryPills.appendChild(allPill);
  for (const cat of OSINT_CATEGORIES) {
    els.categoryPills.appendChild(makePill(cat.id, cat.name, cat.icon));
  }
}

function makePill(id, label, icon) {
  const btn = document.createElement("button");
  btn.className = "pill" + (id === state.activeCategory ? " active" : "");
  btn.dataset.id = id;
  btn.innerHTML = `<span>${icon}</span> ${label}`;
  btn.addEventListener("click", () => {
    setActivePill(id);
    if (state.searchTerm) {
      // Jumping to a category should drop any active search so the full section is visible.
      state.searchTerm = "";
      els.dirSearch.value = "";
      renderToolsGrid();
    }
    if (id === "all") {
      els.toolsGrid.scrollIntoView({ behavior: "smooth", block: "start" });
    } else {
      document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
  return btn;
}

function setActivePill(id) {
  state.activeCategory = id;
  [...els.categoryPills.children].forEach(p => p.classList.toggle("active", p.dataset.id === id));
}

function searchFilteredTools(term) {
  const tokens = tokenize(term);
  return OSINT_TOOLS_FLAT
    .map(tool => ({ tool, score: scoreTool(tool, tokens) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(s => s.tool);
}

// With ~3.5k tools, rendering every card up front would put tens of thousands of
// nodes in the DOM and stall the page on mobile. Each category shows a preview and
// reveals the rest in batches on demand.
const CATEGORY_PREVIEW = 12;
const SEARCH_PAGE = 60;

/**
 * Grid that renders `initial` cards, plus a button that appends the rest in
 * batches of the same size.
 */
function buildCappedGrid(tools, initial) {
  const wrap = document.createElement("div");
  const grid = document.createElement("div");
  grid.className = "tools-grid-inner";
  wrap.appendChild(grid);

  let shown = 0;
  const appendBatch = n => {
    const frag = document.createDocumentFragment();
    const end = Math.min(shown + n, tools.length);
    for (let i = shown; i < end; i++) frag.appendChild(renderToolCard(tools[i]));
    grid.appendChild(frag);
    shown = end;
  };

  appendBatch(initial);
  if (tools.length <= initial) return wrap;

  const more = document.createElement("button");
  more.type = "button";
  more.className = "show-more-btn";
  const sync = () => {
    const left = tools.length - shown;
    if (left <= 0) { more.remove(); return; }
    more.textContent = `Show ${Math.min(left, initial)} more (${left} remaining)`;
  };
  more.addEventListener("click", () => { appendBatch(initial); sync(); });
  sync();
  wrap.appendChild(more);
  return wrap;
}

// Category pills act as a jump-menu over always-visible, categorized sections.
// Typing a search term switches to a flat, ranked results view instead.
function renderToolsGrid() {
  els.toolsGrid.innerHTML = "";
  disconnectSectionObserver();

  if (state.searchTerm) {
    const matches = searchFilteredTools(state.searchTerm);
    setActivePill("all");
    if (matches.length === 0) {
      // A dead end is unhelpful — hand the query to the concierge, which knows
      // workflows and (with a key) can reason beyond literal keyword matches.
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.innerHTML = `
        <p>No tools in the directory match "${escapeHtml(state.searchTerm)}".</p>
        <p class="empty-state-sub">Ask the concierge instead — it can suggest an approach
           even when no tool name matches.</p>`;
      const askBtn = document.createElement("button");
      askBtn.type = "button";
      askBtn.className = "empty-state-btn";
      askBtn.textContent = `Ask the concierge about "${state.searchTerm}"`;
      askBtn.addEventListener("click", () => {
        const q = state.searchTerm;
        pushUserMessage(q);
        handleUserQuery(q);
        els.chatMessages.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
      empty.appendChild(askBtn);
      els.toolsGrid.appendChild(empty);
      return;
    }
    const label = document.createElement("p");
    label.className = "results-label";
    label.textContent = `${matches.length} result${matches.length === 1 ? "" : "s"} for "${state.searchTerm}"`;
    els.toolsGrid.appendChild(label);
    els.toolsGrid.appendChild(buildCappedGrid(matches, SEARCH_PAGE));
    return;
  }

  for (const cat of OSINT_CATEGORIES) {
    const section = document.createElement("section");
    section.className = "category-section";
    section.id = `cat-${cat.id}`;

    const header = document.createElement("div");
    header.className = "category-section-header";
    header.innerHTML = `<span class="icon">${cat.icon}</span><h3>${escapeHtml(cat.name)}</h3><span class="count">${cat.tools.length} tools</span>`;
    section.appendChild(header);

    const tools = cat.tools.map(t => ({ ...t, category: cat.name, categoryId: cat.id, categoryIcon: cat.icon }));
    section.appendChild(buildCappedGrid(tools, CATEGORY_PREVIEW));
    els.toolsGrid.appendChild(section);
  }

  setupSectionObserver();
}

let sectionObserver = null;
let sectionBottomHandler = null;
let toolbarH = 190;

/**
 * The sticky toolbar's height depends on how many category pills wrap, which changes
 * with the category count and viewport. Measure it and drive both the CSS scroll
 * offset and the scroll-spy band off the real value instead of a magic number.
 */
function syncToolbarOffset() {
  const tb = document.querySelector(".directory-toolbar");
  const panel = document.querySelector(".directory-panel");
  if (!tb || !panel) return;

  // What matters is where the toolbar's *bottom* comes to rest once stuck, measured
  // from the top of whichever element is actually scrolling:
  //  - desktop: .directory-panel scrolls, and a sticky top:0 child stops at the
  //    panel's padding edge (not its border edge), so add the panel's padding-top.
  //  - mobile breakpoint: the panel is static and the document scrolls, with the
  //    toolbar pinned below the fixed topbar by its own CSS `top`.
  const panelScrolls = panel.scrollHeight > panel.clientHeight + 1;
  const stickyTop = panelScrolls
    ? parseFloat(getComputedStyle(panel).paddingTop) || 0
    : parseFloat(getComputedStyle(tb).top) || 0;

  toolbarH = Math.round(stickyTop + tb.getBoundingClientRect().height);
  document.documentElement.style.setProperty("--toolbar-h", `${toolbarH}px`);
}

function setupSectionObserver() {
  syncToolbarOffset();
  const sections = [...document.querySelectorAll(".category-section")];
  sectionObserver = new IntersectionObserver(
    entries => {
      const visible = entries.filter(e => e.isIntersecting);
      if (visible.length === 0) return;
      // Multiple sections can intersect the active band at once (a tall one ending, a short
      // one starting) — the current section is whichever has scrolled closest to the top edge
      // without going past it, i.e. the largest (least negative) top.
      visible.sort((a, b) => b.boundingClientRect.top - a.boundingClientRect.top);
      const id = visible[0].target.id.replace("cat-", "");
      setActivePill(id);
    },
    { rootMargin: `-${toolbarH + 12}px 0px -70% 0px`, threshold: 0 }
  );
  sections.forEach(s => sectionObserver.observe(s));

  // A short last section can never scroll its header up to the active band (there's no more
  // page below it to scroll through), so the observer alone would never highlight it. Force it
  // active once the user has scrolled to the bottom, on whichever container actually scrolls
  // (the bounded .directory-panel on desktop, or the document itself on the mobile breakpoint).
  const dirPanel = document.querySelector(".directory-panel");
  const lastId = OSINT_CATEGORIES[OSINT_CATEGORIES.length - 1].id;
  sectionBottomHandler = () => {
    const doc = document.documentElement;
    const atBottomPanel = dirPanel.scrollHeight - dirPanel.scrollTop - dirPanel.clientHeight < 4;
    const atBottomDoc = doc.scrollHeight - window.scrollY - doc.clientHeight < 4;
    if (atBottomPanel || atBottomDoc) setActivePill(lastId);
  };
  dirPanel.addEventListener("scroll", sectionBottomHandler);
  window.addEventListener("scroll", sectionBottomHandler);
}

function disconnectSectionObserver() {
  if (sectionObserver) {
    sectionObserver.disconnect();
    sectionObserver = null;
  }
  if (sectionBottomHandler) {
    document.querySelector(".directory-panel")?.removeEventListener("scroll", sectionBottomHandler);
    window.removeEventListener("scroll", sectionBottomHandler);
    sectionBottomHandler = null;
  }
}

function renderToolCard(tool) {
  const card = document.createElement("a");
  card.className = "tool-card";
  card.href = tool.url;
  card.target = "_blank";
  card.rel = "noopener noreferrer";
  // Imported entries carry their upstream heading; show it when there's no
  // description so the card still says something about what the tool is for.
  const sub = tool.desc
    ? `<p>${escapeHtml(tool.desc)}</p>`
    : tool.section
      ? `<p class="tool-section-hint">${escapeHtml(tool.section)}</p>`
      : "";
  card.innerHTML = `
    <div class="tool-card-top">
      <span class="tool-icon">${tool.categoryIcon || "🔗"}</span>
      <span class="tool-category">${escapeHtml(tool.category)}</span>
    </div>
    <h3>${escapeHtml(tool.name)}</h3>
    ${sub}
  `;
  return card;
}

function wireDirectory() {
  let debounce;
  els.dirSearch.addEventListener("input", e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.searchTerm = e.target.value.trim();
      renderToolsGrid();
    }, 120);
  });

  // Pill wrapping — and so the sticky toolbar's height — changes with viewport width.
  let resizeDebounce;
  window.addEventListener("resize", () => {
    clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      syncToolbarOffset();
      if (!state.searchTerm) {
        // Rebuild the observer so its band matches the new toolbar height.
        disconnectSectionObserver();
        setupSectionObserver();
      }
    }, 150);
  });
}

/* ---------------- Case board ---------------- */

const ENTITY_INK = {
  coordinates: "#22d3ee", name: "#ff3ea5", domain: "#4fd1c5", ipv4: "#a78bfa",
  email: "#f5a524", url: "#60a5fa", btc: "#fbbf24", eth: "#4ade80"
};

/**
 * Everything the run turned up, grouped by kind, each entry naming the tools
 * that produced it. The chart above is a co-occurrence graph: a line means two
 * entities came back from the same lookup. That is the only relation the data
 * actually supports, so it is the only one drawn — nothing here infers a
 * connection the tools did not show.
 */
function renderEntityBoard(board) {
  if (!board || !board.entities.length) return null;

  const el = document.createElement("div");
  el.className = "board-wrap";

  const nodes = board.entities.slice(0, 24);
  const index = new Map(nodes.map((e, i) => [e.key, i]));
  const links = board.links.filter(l => index.has(l.a) && index.has(l.b));

  // Nodes on a circle, links as chords. At this scale that stays readable;
  // a force layout would only add motion and no information. The frame is wider
  // than it is tall so the labels either side have somewhere to go — at equal
  // width the longest ones ran off the edge.
  const W = 420, H = 300, R = 96, cx = W / 2, cy = H / 2;
  const at = i => {
    const a = (i / nodes.length) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, a };
  };

  const edgeSvg = links.map(l => {
    const p = at(index.get(l.a)), q = at(index.get(l.b));
    return `<line x1="${p.x.toFixed(1)}" y1="${p.y.toFixed(1)}" x2="${q.x.toFixed(1)}" y2="${q.y.toFixed(1)}"
      stroke="var(--border)" stroke-width="${Math.min(2, 0.6 + l.count * 0.3).toFixed(1)}" opacity="0.75"/>`;
  }).join("");

  const nodeSvg = nodes.map((e, i) => {
    const p = at(i);
    const ink = ENTITY_INK[e.type] || "#94a3b8";
    const right = p.x >= cx;
    const label = truncate(e.value, 16);
    return `<g>
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(3 + Math.min(e.sources.length, 3)).toFixed(1)}"
        fill="${ink}"><title>${escapeHtml(e.value)} — ${escapeHtml(e.sources.join(", "))}</title></circle>
      <text x="${(p.x + (right ? 8 : -8)).toFixed(1)}" y="${(p.y + 3).toFixed(1)}"
        text-anchor="${right ? "start" : "end"}" font-size="8" fill="var(--text-dim)"
        >${escapeHtml(label)}</text>
    </g>`;
  }).join("");

  const groups = board.groups.map(g => `
    <div class="board-group">
      <h4 style="color:${ENTITY_INK[g.type] || "#94a3b8"}">${escapeHtml(g.label)} <span>${g.items.length}</span></h4>
      <ul>${g.items.map(e => `
        <li>
          <span class="board-value">${escapeHtml(e.value)}</span>
          <span class="board-src">${escapeHtml(e.sources.join(", "))}</span>
        </li>`).join("")}</ul>
    </div>`).join("");

  el.innerHTML = `
    <div class="visual-title">🗂️ Case board — ${board.total} entit${board.total === 1 ? "y" : "ies"} found</div>
    <div class="board-scroll">
      <svg class="board-svg" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="Entities found, linked where they came back from the same lookup">
        ${edgeSvg}${nodeSvg}
      </svg>
    </div>
    <div class="board-groups">${groups}</div>
    <p class="board-note">Each entry names the tool that produced it. A line links two entities that
      came back from the same lookup — the only relation the data supports.
      ${board.shown < board.total ? `Showing the ${board.shown} best-corroborated of ${board.total}.` : ""}</p>`;
  return el;
}

/* ---------------- Chat ---------------- */

function wireChat() {
  els.chatForm.addEventListener("submit", async e => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text && !state.attachedImages.length) return;
    els.chatInput.value = "";
    pushUserMessage(
      text || (state.attachedImages.length > 1 ? "(investigate these images)" : "(investigate this image)"),
      state.attachedImages
    );
    await handleUserQuery(text);
  });

  wireAttach();

  const suggestions = [
    "Investigate a person",
    "Trace a username",
    "Verify a photo",
    "Live-check a domain: example.com",
    "Live-check an IP: 8.8.8.8",
    "Trace a crypto wallet"
  ];
  els.suggestions.innerHTML = "";
  for (const s of suggestions) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "suggestion-chip";
    chip.textContent = s;
    chip.addEventListener("click", async () => {
      pushUserMessage(s);
      await handleUserQuery(s);
    });
    els.suggestions.appendChild(chip);
  }
}

/* ---------------- Image attachment ---------------- */

function wireAttach() {
  els.attachBtn.addEventListener("click", () => els.attachInput.click());
  els.attachInput.addEventListener("change", e => {
    loadAttachments([...(e.target.files || [])]);
    els.attachInput.value = "";
  });
  els.attachRemove.addEventListener("click", clearAttachment);

  // Pasting a screenshot straight into the chat is the fastest path for image
  // tasks, and a paste can carry several at once.
  els.chatInput.addEventListener("paste", e => {
    const files = [...(e.clipboardData?.items || [])]
      .filter(i => i.type.startsWith("image/"))
      .map(i => i.getAsFile())
      .filter(Boolean);
    if (files.length) { e.preventDefault(); loadAttachments(files); }
  });

  // Dropping a set of photos onto the chat is the other natural way to do this.
  const panel = els.chatMessages.closest(".chat-panel") || els.chatMessages;
  panel.addEventListener("dragover", e => { e.preventDefault(); panel.classList.add("drag-over"); });
  panel.addEventListener("dragleave", () => panel.classList.remove("drag-over"));
  panel.addEventListener("drop", e => {
    e.preventDefault();
    panel.classList.remove("drag-over");
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type.startsWith("image/"));
    if (files.length) loadAttachments(files);
  });
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/*
 * Attached images are re-sent with every turn of the investigation — unlike the
 * photos tools fetch, they are the subject and are never pruned away. Six at
 * roughly 1.5k tokens each is the point where that stops being free.
 */
const MAX_ATTACHMENTS = 6;

function loadAttachments(files) {
  const room = MAX_ATTACHMENTS - state.attachedImages.length;
  if (room <= 0) {
    pushBotMessage(`That's already ${MAX_ATTACHMENTS} images, which is the limit — every one is re-sent on ` +
      `every turn of the investigation. Remove one first, or send these and attach the rest after.`, []);
    return;
  }
  const accepted = [];
  for (const file of files.slice(0, room)) {
    if (!file.type.startsWith("image/")) continue;
    if (file.size > MAX_IMAGE_BYTES) {
      pushBotMessage(`**${escapeHtml(file.name || "That image")}** is ${(file.size / 1048576).toFixed(1)} MB — ` +
        `too large to send. Images must be under 5 MB.`, []);
      continue;
    }
    accepted.push(file);
  }
  if (files.length > room) {
    pushBotMessage(`Only took the first ${room} — the limit is ${MAX_ATTACHMENTS} images at a time.`, []);
  }
  accepted.forEach(loadAttachment);
}

function loadAttachment(file) {
  const entry = {
    media_type: file.type,
    data: null,
    name: file.name || "pasted image",
    url: null,
    metadata: null
  };
  state.attachedImages.push(entry);

  // EXIF must be read from the file itself — the vision API only sees pixels, so
  // without this the embedded GPS and capture time would be silently discarded.
  extractImageMetadata(file).then(md => {
    entry.metadata = md;
    if (md) {
      const which = state.attachedImages.length > 1 ? ` in **${entry.name}**` : " in this image";
      pushBotMessage(`📷 **Metadata found${which}:**\n` + formatImageMetadata(md), []);
    }
  });

  const reader = new FileReader();
  reader.onload = () => {
    const url = String(reader.result);
    entry.url = url;
    entry.data = url.split(",")[1];   // strip the data: prefix; the API wants bare base64
    renderAttachments();
  };
  reader.readAsDataURL(file);
}

/** The thumbnail strip, rebuilt from state so removal cannot desync it. */
function renderAttachments() {
  const imgs = state.attachedImages;
  els.attachPreview.hidden = imgs.length === 0;
  els.attachName.textContent = imgs.length === 1
    ? imgs[0].name
    : `${imgs.length} images — the agent sees them numbered 1–${imgs.length}`;

  els.attachStrip.innerHTML = "";
  imgs.forEach((img, i) => {
    const cell = document.createElement("div");
    cell.className = "attach-cell";
    cell.innerHTML =
      `<img class="attach-thumb" src="${img.url || ""}" alt="${escapeHtml(img.name)}" />` +
      `<span class="attach-idx">${i + 1}</span>` +
      `<button type="button" class="attach-drop" aria-label="Remove ${escapeHtml(img.name)}">✕</button>`;
    cell.querySelector(".attach-drop").addEventListener("click", () => {
      state.attachedImages.splice(i, 1);
      renderAttachments();
    });
    els.attachStrip.appendChild(cell);
  });
}

function clearAttachment() {
  state.attachedImages = [];
  renderAttachments();
}

async function handleUserQuery(text) {
  const images = state.attachedImages.filter(i => i.data);

  // In AI mode every turn goes to the agent. Routing only "investigate"-shaped
  // messages there used to drop follow-ups into a chat path that had no tools at
  // all, so "it's my own number" or "you do it" got a toolless answer that claimed
  // it couldn't run anything — while the tools sat right there unused.
  if (state.apiKey) {
    // Keep a copy: the composer is cleared on send, but annotate_image draws over
    // these later in the run.
    if (images.length) state.sentImages = images;
    clearAttachment();
    await runAgentTask(text, images);
    return;
  }

  if (images.length || looksLikeInvestigation(text)) {
    clearAttachment();
    pushBotMessage(
      "Running an investigation on my own needs an **Anthropic API key** — I have to reason about the " +
      "task, choose tools, read results and decide what to check next, which local keyword matching " +
      "can't do." +
      (images.length
        ? ` Reading ${images.length > 1 ? `these ${images.length} images` : "an image"} needs one too.`
        : "") +
      " Add your key under **AI settings** and I'll take the whole task. Meanwhile, here's what I can " +
      "still do without one:",
      []
    );
    // Fall through — direct lookups and tool matching still work and are worth having.
  }

  const targets = extractTargets(text);
  if (targets.length > 0) {
    const loadingId = pushBotMessage(
      `⚡ Running live lookups on ${targets.map(t => t.value).join(", ")}…`,
      [],
      true
    );
    try {
      const results = await runLiveLookups(text, state.liveKeys);
      replaceMessageRaw(loadingId, renderLiveBubble(results));
    } catch (err) {
      replaceMessage(loadingId, `Live lookup failed unexpectedly (${err.message}).`, []);
    }
  }

  const local = buildLocalResponse(text);
  pushBotMessage(local.text, local.toolCards);
}

// Deliberately narrow: verbs that mean "go and do this for me". Generic words like
// "trace" or "profile" are left out — they collide with the built-in workflows
// ("Trace a username"), which are the better answer when there's no key.
const INVESTIGATE_RE = /\b(investigate|look into|dig into|find out (about|who|where)|run a (check|report) on|recon)\b/i;

function looksLikeInvestigation(text) {
  return INVESTIGATE_RE.test(text || "");
}

/**
 * EXIF is fact the model cannot see for itself — vision gets pixels, not headers.
 * Stating it in the task keeps the agent from having to guess at what it already
 * has, while the wording keeps it treating the values as evidence, not proof.
 */
function buildAgentTask(text, images) {
  const n = images.length;
  const base = text || (n
    ? (n > 1
      ? `Investigate these ${n} images: work out where they were taken and anything else verifiable. ` +
        `Say whether they show the same place, and use each one to check the others.`
      : "Investigate this image: work out where it was taken and anything else verifiable.")
    : "");
  if (!n) return base;

  const roll = images.map((img, i) => `Image ${i + 1}: ${img.name}`).join("\n");
  // Metadata is per file, so it has to be labelled per image or the agent cannot
  // tell which photo a GPS fix belongs to.
  const meta = images
    .map((img, i) => img.metadata
      ? `--- EXIF read from Image ${i + 1} (${img.name}) — the file itself; you cannot see this in the pixels ---\n` +
        `${formatImageMetadata(img.metadata)}`
      : `--- Image ${i + 1} (${img.name}): no EXIF metadata present ---`)
    .join("\n\n");

  return `${base}\n\nAttached, in order:\n${roll}\n\n${meta}\n--- end metadata ---`;
}

async function runAgentTask(text, images) {
  // The image_metadata tool reads from here, so its numbering matches the
  // numbering the agent is given in the task text.
  if (typeof setInvestigationMetadata === "function") setInvestigationMetadata(images);

  const trace = createTraceBubble();
  try {
    await runInvestigation({
      apiKey: state.apiKey,
      model: state.model,
      // Routing to a worker only makes sense when the chosen model is bigger
      // than the worker; picking Haiku and then "routing" to Haiku is a no-op.
      workerModel: state.routing === "on" && state.model !== WORKER_MODEL ? WORKER_MODEL : null,
      task: buildAgentTask(text, images),
      images: images.map(i => ({ media_type: i.media_type, data: i.data, name: i.name })),
      liveKeys: state.liveKeys,
      onEvent: ev => trace.push(ev),
      history: state.agentHistory,
      onManualRequest: req => trace.requestManual(req),
      onVisual: spec => trace.showVisual(spec)
    });
  } catch (err) {
    trace.push({ type: "error", text: err.message || String(err) });
  }
  trace.finish();
}

/** A live-updating bubble showing each step the agent takes. */
function createTraceBubble() {
  const id = `msg-${++msgCounter}`;
  const wrap = document.createElement("div");
  wrap.className = "msg msg-bot msg-trace";
  wrap.id = id;
  wrap.innerHTML = `<div class="trace-status">🔎 Investigating…</div><div class="trace-steps"></div>`;
  els.chatMessages.appendChild(wrap);
  scrollChatToBottom();

  const steps = wrap.querySelector(".trace-steps");
  const status = wrap.querySelector(".trace-status");

  const add = html => {
    const d = document.createElement("div");
    d.className = "trace-step";
    d.innerHTML = html;
    steps.appendChild(d);
    scrollChatToBottom();
  };

  return {
    push(ev) {
      switch (ev.type) {
        case "thinking":
          add(`<details class="trace-thinking"><summary>Reasoning</summary><div>${mdLiteToHtml(ev.text)}</div></details>`);
          break;
        case "tool_call":
          // The handoff renders its own card right below with the same details —
          // dumping the raw JSON too is just noise.
          if (ev.name === "request_manual_lookup") break;
          add(`<div class="trace-tool">⚙️ <strong>${escapeHtml(ev.name)}</strong> <code>${escapeHtml(truncate(JSON.stringify(ev.input), 140))}</code></div>`);
          break;
        case "tool_result":
          add(`<div class="trace-result ${ev.ok ? "ok" : "err"}">${ev.ok ? "✓" : "✗"} ` +
            (ev.images?.length
              ? `<span class="trace-imgs">🖼️ ${ev.images.length} photo${ev.images.length === 1 ? "" : "s"} shown to the model</span> `
              : "") +
            `${mdLiteToHtml(truncate(ev.text, 400))}</div>`);
          break;
        case "text":
          add(`<div class="trace-text">${mdLiteToHtml(ev.text)}</div>`);
          break;
        case "refusal":
          add(`<div class="trace-result err">Declined: ${escapeHtml(ev.text)}</div>`);
          break;
        case "usage": {
          // Per-step, folded away by default — the total is what matters, but the
          // breakdown is what shows whether a step was cheap because it was routed
          // to a smaller model or because the cache was warm.
          const u = ev.usage || {};
          const bits = [
            `${(u.input_tokens || 0).toLocaleString()} in`,
            `${(u.output_tokens || 0).toLocaleString()} out`,
            u.cache_read_input_tokens ? `${u.cache_read_input_tokens.toLocaleString()} cached` : null,
            ev.stepCost != null ? fmtMoney(ev.stepCost) : null
          ].filter(Boolean).join(" · ");
          add(`<div class="trace-usage">▪ ${escapeHtml(ev.model)} — ${bits}</div>`);
          break;
        }
        case "entities": {
          const node = renderEntityBoard(ev.board);
          if (node) { steps.appendChild(node); scrollChatToBottom(); }
          break;
        }
        case "cost": {
          const c = ev.summary;
          const rows = c.perModel.length > 1
            ? `<ul class="cost-models">${c.perModel.map(m =>
                `<li><strong>${escapeHtml(m.model)}</strong> — ${m.steps} step${m.steps === 1 ? "" : "s"}, ` +
                `${(m.in + m.out).toLocaleString()} tokens, ${fmtMoney(m.cost)}</li>`).join("")}</ul>`
            : "";
          add(
            `<div class="trace-cost">` +
            `<div class="cost-head">${c.steps} model call${c.steps === 1 ? "" : "s"} · ` +
            `<strong>${c.priced ? `~${fmtMoney(c.cost)}` : "cost unknown"}</strong></div>` +
            `<div class="cost-detail">` +
            `${c.input.toLocaleString()} input · ${c.output.toLocaleString()} output` +
            (c.cacheRead ? ` · ${c.cacheRead.toLocaleString()} read from cache` : "") +
            (c.cacheWrite ? ` · ${c.cacheWrite.toLocaleString()} written to cache` : "") +
            `</div>${rows}` +
            (c.priced
              ? `<div class="cost-note">Estimate at Anthropic's list API rates — your actual bill is authoritative.</div>`
              : `<div class="cost-note">No rate on file for ${c.unpriced.map(escapeHtml).join(", ")}, so this run is unpriced.</div>`) +
            `</div>`
          );
          break;
        }
        case "retry":
          add(`<div class="trace-retry">↻ ${escapeHtml(ev.text)}</div>`);
          break;
        case "error":
          add(`<div class="trace-result err">Error: ${escapeHtml(ev.text)}</div>`);
          break;
      }
    },
    /** Renders an agent-produced visual into the trace. Returns false if it can't. */
    showVisual(spec) {
      let node = null;
      if (spec.type === "annotations") node = renderAnnotations(spec.regions, spec.image || 1);
      else if (spec.type === "triangulation") node = renderTriangulation(spec);
      if (!node) return false;
      steps.appendChild(node);
      scrollChatToBottom();
      return true;
    },

    /**
     * Approach A, the human-in-the-loop handoff: for tools the agent can't call,
     * it hands over a prefilled link and waits. Resolves with what the user pastes
     * (or {skipped:true}), which the agent receives as the tool's result.
     */
    requestManual(req) {
      status.textContent = "⏸ Waiting for you";
      return new Promise(resolve => {
        const card = document.createElement("div");
        card.className = "manual-request";
        // A multi-engine handoff (reverse image search) opens several tools in one
        // card; the single-link form stays as it was.
        const linkBlock = req.multi && req.links?.length
          ? `<div class="manual-links">${req.links.map(l => `
              <a class="manual-open manual-open-multi" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">
                ${escapeHtml(l.name)} ↗
              </a>${l.note ? `<span class="manual-link-note">${escapeHtml(l.note)}</span>` : ""}`).join("")}</div>`
          : `<a class="manual-open" href="${escapeHtml(req.url)}" target="_blank" rel="noopener noreferrer">
              Open ${escapeHtml(req.tool_name)} ↗
            </a>`;
        card.innerHTML = `
          <div class="manual-head">🙋 Your turn — I can't query ${req.multi ? "these" : "this one"} directly</div>
          <div class="manual-tool">${escapeHtml(req.tool_name)}${
            req.subject ? ` <span class="manual-subject">${escapeHtml(req.subject)}</span>` : ""}</div>
          ${req.why ? `<div class="manual-why">${escapeHtml(req.why)}</div>` : ""}
          ${linkBlock}
          <div class="manual-copy"><strong>Copy back:</strong> ${escapeHtml(req.what_to_copy)}</div>
        `;
        const ta = document.createElement("textarea");
        ta.className = "manual-input";
        ta.rows = 4;
        ta.placeholder = "Paste what you found here, then Submit…";

        const actions = document.createElement("div");
        actions.className = "manual-actions";
        const submit = document.createElement("button");
        submit.type = "button";
        submit.className = "btn-primary";
        submit.textContent = "Submit results";
        const skip = document.createElement("button");
        skip.type = "button";
        skip.className = "btn-secondary";
        skip.textContent = "Skip this";

        const done = value => {
          ta.disabled = submit.disabled = skip.disabled = true;
          card.classList.add("resolved");
          status.textContent = "🔎 Investigating…";
          resolve(value);
        };
        submit.addEventListener("click", () => {
          const text = ta.value.trim();
          if (!text) { ta.focus(); return; }
          done({ text });
        });
        skip.addEventListener("click", () => done({ skipped: true }));
        // Ctrl/Cmd+Enter submits, since pasted results are often multi-line.
        ta.addEventListener("keydown", e => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit.click();
        });

        actions.append(skip, submit);
        card.append(ta, actions);
        steps.appendChild(card);
        scrollChatToBottom();
        ta.focus();
      });
    },
    finish() {
      status.textContent = "🔎 Investigation complete";
      scrollChatToBottom();
    }
  };
}

/* ---------------- Agent visual output ---------------- */

const ANNO_COLORS = {
  sign: "#f5a524", landmark: "#4fd1c5", vehicle: "#a78bfa",
  shadow: "#fbbf24", terrain: "#4ade80", person: "#94a3b8", other: "#60a5fa"
};

/**
 * One attached photo with the agent's labelled boxes drawn over it. `index` is
 * 1-based, matching the numbering the agent is given in the task text, and the
 * images are the ones sent with the turn — they are cleared from the composer on
 * send, so the copy kept for this render is the one that matters.
 */
function renderAnnotations(regions, index = 1) {
  const shot = (state.sentImages || [])[Math.max(0, Math.min(index - 1, (state.sentImages || []).length - 1))];
  if (!shot || !shot.url) return null;
  const many = (state.sentImages || []).length > 1;
  const el = document.createElement("div");
  el.className = "anno-wrap";
  el.innerHTML = `
    <div class="visual-title">🖼️ Details this rests on${many ? ` — Image ${index}: ${escapeHtml(shot.name)}` : ""}</div>
    <div class="anno-frame">
      <img class="anno-img" src="${shot.url}" alt="Annotated evidence" />
      <svg class="anno-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${regions.map((r, i) => {
          const c = ANNO_COLORS[r.category] || ANNO_COLORS.other;
          return `<rect x="${r.x * 100}" y="${r.y * 100}" width="${r.w * 100}" height="${r.h * 100}"
                    fill="${c}22" stroke="${c}" stroke-width="0.5" vector-effect="non-scaling-stroke" rx="0.5"/>
                  <circle cx="${r.x * 100 + 2.2}" cy="${r.y * 100 + 2.6}" r="2.2" fill="${c}"/>
                  <text x="${r.x * 100 + 2.2}" y="${r.y * 100 + 3.4}" font-size="3" font-weight="700"
                    text-anchor="middle" fill="#0b0f14">${i + 1}</text>`;
        }).join("")}
      </svg>
    </div>
    <ol class="anno-legend">
      ${regions.map(r => {
        const c = ANNO_COLORS[r.category] || ANNO_COLORS.other;
        return `<li><span class="anno-dot" style="background:${c}"></span>
          <strong>${escapeHtml(r.label)}</strong>${r.note ? ` — ${escapeHtml(r.note)}` : ""}</li>`;
      }).join("")}
    </ol>`;
  return el;
}

/* ---------------- Plan view: annotated aerial imagery ---------------- */

/*
 * Web Mercator, the projection every slippy-map tile is cut to. World pixel
 * coordinates at zoom z run 0..256*2^z; a tile is the 256px square at
 * (floor(x/256), floor(y/256)), which is what /api/tile serves.
 */
const TILE_PX = 256;
const PLAN_W = 680, PLAN_H = 460;
const PLAN_MAX_Z = 18;      // ~0.5 m/px — tighter than this and a single point fills the frame
const PLAN_MAX_TILES = 30;

const lonToWorldX = (lon, z) => (lon + 180) / 360 * TILE_PX * 2 ** z;
const latToWorldY = (lat, z) => {
  const s = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE_PX * 2 ** z;
};
const worldXToLon = (x, z) => x / (TILE_PX * 2 ** z) * 360 - 180;
const worldYToLat = (y, z) => {
  const n = Math.PI - 2 * Math.PI * y / (TILE_PX * 2 ** z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

const D2R = Math.PI / 180, R2D = 180 / Math.PI, EARTH_R = 6371000;

function planDistance(a, b) {
  const φ1 = a.lat * D2R, φ2 = b.lat * D2R;
  const Δφ = (b.lat - a.lat) * D2R, Δλ = (b.lon - a.lon) * D2R;
  const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
function planBearing(a, b) {
  const φ1 = a.lat * D2R, φ2 = b.lat * D2R, Δλ = (b.lon - a.lon) * D2R;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}
function planDestination(lat, lon, brgDeg, distM) {
  const φ1 = lat * D2R, λ1 = lon * D2R, θ = brgDeg * D2R, δ = distM / EARTH_R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
                             Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: φ2 * R2D, lon: ((λ2 * R2D + 540) % 360) - 180 };
}
const fmtMetres = m => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
const fmtDeg = d => `${d.toFixed(0)}°`;
/** Decimal degrees with a hemisphere letter, the way a map margin writes them. */
const fmtLat = v => `${Math.abs(v).toFixed(5)}° ${v >= 0 ? "N" : "S"}`;
const fmtLon = v => `${Math.abs(v).toFixed(5)}° ${v >= 0 ? "E" : "W"}`;

/** Largest zoom at which every point still sits inside the frame with a margin. */
function chooseZoom(pts) {
  const lats = pts.map(p => p.lat), lons = pts.map(p => p.lon);
  const [minLat, maxLat] = [Math.min(...lats), Math.max(...lats)];
  const [minLon, maxLon] = [Math.min(...lons), Math.max(...lons)];
  for (let z = PLAN_MAX_Z; z >= 1; z--) {
    const w = lonToWorldX(maxLon, z) - lonToWorldX(minLon, z);
    const h = latToWorldY(minLat, z) - latToWorldY(maxLat, z);
    if (w <= PLAN_W * 0.74 && h <= PLAN_H * 0.74) return z;
  }
  return 1;
}

/*
 * Text over aerial imagery is unreadable without a halo — the backdrop is
 * arbitrary. paint-order:stroke draws the outline *under* the glyph, so a fat
 * dark stroke becomes a contour rather than eating the letterforms.
 */
const HALO = `paint-order="stroke" stroke="#04070c" stroke-width="2.6" stroke-linejoin="round"`;

const PLAN_INK = {
  anchor: "#ff3ea5",   // magenta — located features and the lines between them
  camera: "#22d3ee",   // cyan    — the derived camera station
  building: "#ffd54a", // amber   — OSM building footprints
  road: "#3ddc84",     // green   — OSM ways
  margin: "#dce6f2"
};

/**
 * Plan view of the geolocation working, drawn over real aerial imagery: the
 * located anchors as numbered control points, OSM building and road vectors
 * traced over the photography, and — when the agent supplies one — the camera
 * station with its sight lines, view cone and error ellipse.
 *
 * Returns the node synchronously (the trace renders it straight away); imagery
 * tiles load as ordinary <image> requests and the OSM vector overlay is fetched
 * afterwards and injected. Either can fail without breaking the diagram — the
 * abstract grid underneath is the fallback, which is what a static deployment
 * with no /api/tile gets.
 */
function renderTriangulation({ anchors, camera, caption, basemap }) {
  const layer = basemap === "street" ? "street" : "satellite";
  const cam = camera && typeof camera.lat === "number" ? { ...camera, name: "Camera station" } : null;

  // The cone is sized to sit inside the evidence rather than reach past it — a
  // cone longer than the anchors drags the bounding box out and zooms the whole
  // map away from the thing being shown. Its tips still join the bounding box,
  // so a bearing pointing away from every anchor can't be drawn off-frame.
  const bboxPts = [...anchors];
  let coneLen = 0;
  if (cam) {
    bboxPts.push(cam);
    if (typeof cam.bearing === "number") {
      coneLen = Math.max(40, 0.8 * Math.max(...anchors.map(a => planDistance(cam, a)), 50));
      const fov = cam.fov || 65;
      bboxPts.push(
        planDestination(cam.lat, cam.lon, cam.bearing - fov / 2, coneLen),
        planDestination(cam.lat, cam.lon, cam.bearing, coneLen),
        planDestination(cam.lat, cam.lon, cam.bearing + fov / 2, coneLen)
      );
    }
  }

  /*
   * Tiles only exist at integer zooms, and stepping between them doubles the
   * scale — so fitting to the nearest integer alone leaves the scene filling
   * anywhere from a third of the frame to all of it. Take the zoom one step
   * tighter than fits, then scale the whole map down by k to land it exactly:
   * the imagery is downsampled rather than stretched, which stays sharp.
   */
  const z = Math.min(chooseZoom(bboxPts) + 1, PLAN_MAX_Z + 1);
  const wx = bboxPts.map(p => lonToWorldX(p.lon, z));
  const wy = bboxPts.map(p => latToWorldY(p.lat, z));
  const spanX = Math.max(...wx) - Math.min(...wx), spanY = Math.max(...wy) - Math.min(...wy);
  const k = Math.min(1, Math.max(0.5,
    Math.min(spanX > 1 ? PLAN_W * 0.74 / spanX : 1, spanY > 1 ? PLAN_H * 0.74 / spanY : 1)));

  const cxW = (Math.min(...wx) + Math.max(...wx)) / 2;
  const cyW = (Math.min(...wy) + Math.max(...wy)) / 2;
  // World-pixel window the frame covers once scaled by k.
  const halfW = PLAN_W / 2 / k, halfH = PLAN_H / 2 / k;
  const x0 = cxW - halfW, y0 = cyW - halfH;

  const sx = p => (lonToWorldX(p.lon, z) - x0) * k;
  const sy = p => (latToWorldY(p.lat, z) - y0) * k;

  const centreLat = worldYToLat(cyW, z);
  const mPerPx = 156543.03392804097 * Math.cos(centreLat * D2R) / 2 ** z / k;
  const bounds = {
    north: worldYToLat(y0, z), south: worldYToLat(y0 + halfH * 2, z),
    west: worldXToLon(x0, z), east: worldXToLon(x0 + halfW * 2, z)
  };

  /* --- imagery mosaic --- */
  const tilesAvailable = typeof Proxy?.hasBasemap === "function" && Proxy.hasBasemap(layer);
  let tiles = "";
  if (tilesAvailable) {
    const tx0 = Math.floor(x0 / TILE_PX), tx1 = Math.floor((x0 + halfW * 2) / TILE_PX);
    const ty0 = Math.floor(y0 / TILE_PX), ty1 = Math.floor((y0 + halfH * 2) / TILE_PX);
    const n = 2 ** z, count = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
    if (count <= PLAN_MAX_TILES) {
      const size = (TILE_PX * k + 0.6).toFixed(2);  // hairline overlap hides seams
      for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
          // Wrap in x at the antimeridian; y has no wrap, it just runs out.
          const col = ((tx % n) + n) % n;
          if (ty < 0 || ty >= n) continue;
          tiles += `<image class="plan-tile" href="/api/tile/${layer}/${z}/${col}/${ty}"
            x="${((tx * TILE_PX - x0) * k).toFixed(2)}" y="${((ty * TILE_PX - y0) * k).toFixed(2)}"
            width="${size}" height="${size}" preserveAspectRatio="none"/>`;
        }
      }
    }
  }

  /* --- sight lines, camera to each anchor --- */
  let sightlines = "", sightLabels = "";
  if (cam) {
    anchors.forEach((a, i) => {
      const d = planDistance(cam, a), brg = planBearing(cam, a);
      const [ax, ay, bx, by] = [sx(cam), sy(cam), sx(a), sy(a)];
      sightlines +=
        `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#04070c" stroke-width="3.4" opacity="0.55"/>
         <line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${PLAN_INK.anchor}" stroke-width="1.5"/>`;
      // Label rides along its line, flipped where it would otherwise read upside down.
      let ang = Math.atan2(by - ay, bx - ax) * R2D;
      if (ang > 90 || ang < -90) ang += 180;
      const mx = ax + (bx - ax) * 0.58, my = ay + (by - ay) * 0.58;
      // A short line has no room for the full caption without running over the
      // markers at either end, so it gets the distance alone, set further off
      // the line. The bearing is still in the tool's text output either way.
      const lineLen = Math.hypot(bx - ax, by - ay);
      const tight = lineLen < 150;
      sightLabels +=
        `<text x="${mx}" y="${my - (tight ? 11 : 5)}" transform="rotate(${ang.toFixed(1)} ${mx} ${my})"
           text-anchor="middle" font-size="13" font-weight="600" fill="${PLAN_INK.anchor}" ${HALO}
           >${tight ? fmtMetres(d) : `${i + 1} · ${fmtMetres(d)} @ ${fmtDeg(brg)}`}</text>`;
    });
  }

  /* --- view cone and error ellipse --- */
  let cone = "", ring = "", coneLabel = "";
  if (cam && typeof cam.bearing === "number") {
    const fov = cam.fov || 65;
    const p1 = planDestination(cam.lat, cam.lon, cam.bearing - fov / 2, coneLen);
    const p2 = planDestination(cam.lat, cam.lon, cam.bearing + fov / 2, coneLen);
    const rPx = coneLen / mPerPx;
    cone =
      `<path d="M ${sx(cam)} ${sy(cam)} L ${sx(p1)} ${sy(p1)}
         A ${rPx.toFixed(1)} ${rPx.toFixed(1)} 0 ${fov > 180 ? 1 : 0} 1 ${sx(p2)} ${sy(p2)} Z"
         fill="${PLAN_INK.camera}" fill-opacity="0.07"
         stroke="${PLAN_INK.camera}" stroke-width="1.1" stroke-dasharray="5 4"/>`;
    const axis = planDestination(cam.lat, cam.lon, cam.bearing, coneLen);
    cone +=
      `<line x1="${sx(cam)}" y1="${sy(cam)}" x2="${sx(axis)}" y2="${sy(axis)}"
         stroke="${PLAN_INK.camera}" stroke-width="1" stroke-dasharray="2 5" opacity="0.8"/>`;
    coneLabel = `view ${fmtDeg(cam.bearing)} · ${Math.round(fov)}° FOV`;
  }
  if (cam && cam.uncertainty_m) {
    const rPx = Math.max(4, cam.uncertainty_m / mPerPx);
    ring = `<circle cx="${sx(cam)}" cy="${sy(cam)}" r="${rPx.toFixed(1)}" fill="none"
              stroke="${PLAN_INK.camera}" stroke-width="1.2" stroke-dasharray="3 4" opacity="0.9"/>`;
  }

  /* --- control points --- */
  const markers = anchors.map((a, i) => {
    const x = sx(a), y = sy(a);
    // An X in a ring: reads as a surveyed point rather than a map pin, and stays
    // legible against busy imagery.
    return `<g>
      <circle cx="${x}" cy="${y}" r="9" fill="none" stroke="#04070c" stroke-width="3.5" opacity="0.6"/>
      <circle cx="${x}" cy="${y}" r="9" fill="none" stroke="${PLAN_INK.anchor}" stroke-width="1.6"/>
      <path d="M ${x - 5.5} ${y - 5.5} L ${x + 5.5} ${y + 5.5} M ${x + 5.5} ${y - 5.5} L ${x - 5.5} ${y + 5.5}"
        stroke="${PLAN_INK.anchor}" stroke-width="1.8"/>
      <text x="${x}" y="${y - 13}" text-anchor="middle" font-size="14.2" font-weight="700"
        fill="${PLAN_INK.anchor}" ${HALO}>${i + 1}</text>
    </g>`;
  }).join("");

  let camMarker = "";
  if (cam) {
    const x = sx(cam), y = sy(cam);
    camMarker = `<g>
      <circle cx="${x}" cy="${y}" r="11" fill="none" stroke="#04070c" stroke-width="3.5" opacity="0.6"/>
      <circle cx="${x}" cy="${y}" r="11" fill="none" stroke="${PLAN_INK.camera}" stroke-width="1.6"/>
      <circle cx="${x}" cy="${y}" r="4" fill="${PLAN_INK.camera}" stroke="#04070c" stroke-width="1.2"/>
      <line x1="${x - 15}" y1="${y}" x2="${x - 11}" y2="${y}" stroke="${PLAN_INK.camera}" stroke-width="1.6"/>
      <line x1="${x + 11}" y1="${y}" x2="${x + 15}" y2="${y}" stroke="${PLAN_INK.camera}" stroke-width="1.6"/>
      <line x1="${x}" y1="${y - 15}" x2="${x}" y2="${y - 11}" stroke="${PLAN_INK.camera}" stroke-width="1.6"/>
      <line x1="${x}" y1="${y + 11}" x2="${x}" y2="${y + 15}" stroke="${PLAN_INK.camera}" stroke-width="1.6"/>
    </g>`;
  }

  /*
   * Name labels with leader lines, hung off the side of the marker that faces
   * into the frame so they don't run off the edge, and stepped vertically so
   * two nearby anchors don't stack their text on top of each other.
   */
  let camDir = null;
  if (cam && anchors.length) {
    let ux = 0, uy = 0;
    for (const a of anchors) {
      const dx = sx(a) - sx(cam), dy = sy(a) - sy(cam), m = Math.hypot(dx, dy) || 1;
      ux += dx / m; uy += dy / m;
    }
    const m = Math.hypot(ux, uy) || 1;
    camDir = { x: -ux / m, y: -uy / m };
  }

  const labelled = [...anchors.map((a, i) => ({ ...a, n: `${i + 1}. ${a.name}`, ink: PLAN_INK.anchor })),
                    ...(cam ? [{ ...cam, n: "Camera station", ink: PLAN_INK.camera, dir: camDir }] : [])];
  const labels = labelled.map((p, i) => {
    const x = sx(p), y = sy(p);
    // Anchors step their labels vertically so two near neighbours don't stack.
    let dx = p.dir ? p.dir.x * 22 : (x < PLAN_W / 2 ? 16 : -16);
    const dy = p.dir ? p.dir.y * 22 : ((i % 3) - 1) * 15 - 2;
    const wide = p.n.length * 7.4;            // ~14px type, close enough to flip on
    if (dx >= 0 && x + dx + 6 + wide > PLAN_W - 6) dx = -Math.abs(dx);
    else if (dx < 0 && x + dx - 6 - wide < 6) dx = Math.abs(dx);
    const right = dx >= 0;
    const len = Math.hypot(dx, dy) || 1;
    const tx = x + dx + (right ? 6 : -6), ty = y + dy;
    return `<g>
      <path d="M ${(x + dx / len * 11).toFixed(1)} ${(y + dy / len * 11).toFixed(1)} L ${x + dx} ${y + dy} L ${tx} ${ty}"
        fill="none" stroke="${p.ink}" stroke-width="1" opacity="0.85"/>
      <text x="${tx}" y="${ty + 4}" text-anchor="${right ? "start" : "end"}" font-size="14.2"
        font-weight="600" fill="#ffffff" ${HALO}>${escapeHtml(p.n)}</text>
    </g>`;
  }).join("");

  /* --- map margin: graticule, north arrow, scale bar, attribution --- */
  const gratX = [0.25, 0.5, 0.75].map(f => {
    const px = PLAN_W * f;
    return `<line x1="${px}" y1="0" x2="${px}" y2="${PLAN_H}" stroke="#ffffff" stroke-width="0.5" opacity="0.18"/>
            <text x="${px + 3}" y="${38}" font-size="11.2" fill="${PLAN_INK.margin}" opacity="0.85" ${HALO}
              >${fmtLon(worldXToLon(x0 + px / k, z))}</text>`;
  }).join("");
  const gratY = [0.25, 0.5, 0.75].map(f => {
    const py = PLAN_H * f;
    return `<line x1="0" y1="${py}" x2="${PLAN_W}" y2="${py}" stroke="#ffffff" stroke-width="0.5" opacity="0.18"/>
            <text x="4" y="${py - 4}" font-size="11.2" fill="${PLAN_INK.margin}" opacity="0.85" ${HALO}
              >${fmtLat(worldYToLat(y0 + py / k, z))}</text>`;
  }).join("");

  // Scale bar: a round number of metres closest to a quarter of the frame.
  const target = PLAN_W * 0.25 * mPerPx;
  const nice = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]
    .reduce((b, v) => Math.abs(v - target) < Math.abs(b - target) ? v : b, 5);
  const barPx = nice / mPerPx;

  const attribution = layer === "satellite"
    ? "Imagery: Esri, Maxar, Earthstar Geographics"
    : "© OpenStreetMap contributors";

  const el = document.createElement("div");
  el.className = "plan-wrap";
  el.innerHTML = `
    <div class="visual-title">🛰️ Plan view — how the position was fixed
      <button type="button" class="plan-zoom" aria-pressed="false">⤢ Enlarge</button>
    </div>
    <div class="plan-scroll">
    <svg class="plan-svg" viewBox="0 0 ${PLAN_W} ${PLAN_H}" role="img"
      aria-label="Aerial plan view of the located features and the derived camera position">
      <rect width="${PLAN_W}" height="${PLAN_H}" fill="#0b0f14"/>
      ${[1,2,3,4,5,6,7].map(i => `
        <line x1="${i*PLAN_W/8}" y1="0" x2="${i*PLAN_W/8}" y2="${PLAN_H}" stroke="#1c2432" stroke-width="0.5"/>
        <line x1="0" y1="${i*PLAN_H/8}" x2="${PLAN_W}" y2="${i*PLAN_H/8}" stroke="#1c2432" stroke-width="0.5"/>`).join("")}
      <g class="plan-tiles">${tiles}</g>
      <g class="plan-vectors"></g>
      ${gratX}${gratY}
      ${cone}${sightlines}${ring}
      ${markers}${camMarker}
      ${sightLabels}${labels}
      <g transform="translate(${PLAN_W - 34},22)">
        <line x1="0" y1="18" x2="0" y2="-2" stroke="#ffffff" stroke-width="2" ${HALO}/>
        <polygon points="0,-8 -4.5,0 4.5,0" fill="#ffffff" ${HALO}/>
        <text x="0" y="31" font-size="13" font-weight="700" text-anchor="middle" fill="#ffffff" ${HALO}>N</text>
      </g>
      <g transform="translate(14,${PLAN_H - 22})">
        <line x1="0" y1="0" x2="${barPx.toFixed(1)}" y2="0" stroke="#ffffff" stroke-width="2.5" ${HALO}/>
        <line x1="0" y1="-4" x2="0" y2="4" stroke="#ffffff" stroke-width="2.5" ${HALO}/>
        <line x1="${barPx.toFixed(1)}" y1="-4" x2="${barPx.toFixed(1)}" y2="4" stroke="#ffffff" stroke-width="2.5" ${HALO}/>
        <text x="${(barPx / 2).toFixed(1)}" y="-7" font-size="13" font-weight="600" text-anchor="middle"
          fill="#ffffff" ${HALO}>${nice >= 1000 ? `${nice / 1000} km` : `${nice} m`}</text>
      </g>
      <text x="14" y="20" font-size="12.4" font-weight="600" fill="${PLAN_INK.margin}" ${HALO}
        >WGS 84 / Web Mercator · z${z} · ${mPerPx.toFixed(2)} m per pixel</text>
      <text class="plan-attrib" x="${PLAN_W - 8}" y="${PLAN_H - 7}" font-size="11.2" text-anchor="end"
        fill="${PLAN_INK.margin}" opacity="0.8" ${HALO}>${escapeHtml(attribution)}</text>
    </svg>
    </div>
    <div class="plan-legend">
      <span><span class="plan-key plan-key-anchor"></span>control point (located feature)</span>
      ${cam ? `<span><span class="plan-key plan-key-cam"></span>camera station${cam.uncertainty_m ? ` ±${Math.round(cam.uncertainty_m)} m` : ""}</span>` : ""}
      ${coneLabel ? `<span><span class="plan-key plan-key-cone"></span>${coneLabel}</span>` : ""}
      <span><span class="plan-key plan-key-bldg"></span>OSM building</span>
      <span><span class="plan-key plan-key-road"></span>OSM way</span>
    </div>
    ${caption ? `<div class="plan-caption">${escapeHtml(caption)}</div>` : ""}
    ${cam ? `<div class="plan-coords">Camera station: ${cam.lat.toFixed(6)}, ${cam.lon.toFixed(6)}${
        typeof cam.bearing === "number" ? ` · looking ${fmtDeg(cam.bearing)}` : ""}</div>`
      : `<div class="plan-coords plan-coords-warn">No camera station supplied — the plan shows located features only.</div>`}`;

  hydratePlan(el, { bounds, z, k, x0, y0, mPerPx, tilesAvailable });
  return el;
}

/**
 * Everything that can't be drawn synchronously: notice when the imagery fails
 * to load, and trace the OSM footprints over it once Overpass answers.
 */
function hydratePlan(el, { bounds, z, k, x0, y0, mPerPx, tilesAvailable }) {
  const svg = el.querySelector(".plan-svg");

  el.querySelector(".plan-zoom").addEventListener("click", () =>
    el.classList.contains("plan-big") ? closePlanLightbox(el) : openPlanLightbox(el));

  if (tilesAvailable) {
    const imgs = [...el.querySelectorAll(".plan-tile")];
    let failed = 0;
    imgs.forEach(img => img.addEventListener("error", () => {
      img.remove();
      // One missing tile at the edge of coverage is normal; all of them means the
      // basemap is unreachable, and the user should be told what they're looking at.
      if (++failed === imgs.length) notePlan(el, "Aerial imagery unavailable — showing the survey geometry only.");
    }));
  } else {
    notePlan(el, "Aerial imagery needs the server (npm start) — showing the survey geometry only.");
  }

  const groundWidth = PLAN_W * mPerPx;
  if (typeof Proxy?.lookup !== "function" || !Proxy.available || groundWidth > 1500) return;

  const bbox = `${bounds.south.toFixed(6)},${bounds.west.toFixed(6)},${bounds.north.toFixed(6)},${bounds.east.toFixed(6)}`;
  const query =
    `[out:json][timeout:25];(way["building"](${bbox});way["highway"](${bbox}););out geom 600;`;

  Proxy.lookup("overpass", { query }).then(data => {
    const ways = (data && data.elements || []).filter(e => Array.isArray(e.geometry) && e.geometry.length > 1);
    if (!ways.length) return;
    const g = svg.querySelector(".plan-vectors");
    if (!g) return;

    const pt = n => `${((lonToWorldX(n.lon, z) - x0) * k).toFixed(1)},${((latToWorldY(n.lat, z) - y0) * k).toFixed(1)}`;
    g.innerHTML = ways.map(w => {
      const pts = w.geometry.filter(n => n && typeof n.lat === "number").map(pt).join(" ");
      if (!pts) return "";
      return w.tags && w.tags.building
        ? `<polygon points="${pts}" fill="${PLAN_INK.building}" fill-opacity="0.10"
             stroke="${PLAN_INK.building}" stroke-width="1" stroke-opacity="0.9"/>`
        : `<polyline points="${pts}" fill="none" stroke="${PLAN_INK.road}"
             stroke-width="1.2" stroke-opacity="0.5" stroke-linejoin="round"/>`;
    }).join("");
  }).catch(() => { /* vectors are a bonus; the imagery and geometry stand alone */ });
}

/*
 * The chat column is ~430px wide; a 680-unit map scaled into it is a thumbnail.
 * Enlarging moves the diagram bodily out to a full-viewport overlay rather than
 * cloning it — the tiles stay loaded and the Overpass overlay keeps landing in
 * the same node — and a placeholder holds its place in the trace until it is
 * put back.
 */
function openPlanLightbox(el) {
  const holder = document.createElement("div");
  el.after(holder);
  const box = document.createElement("div");
  box.className = "plan-lightbox";
  box.appendChild(el);
  document.body.appendChild(box);
  el.classList.add("plan-big");

  const esc = e => { if (e.key === "Escape") closePlanLightbox(el); };
  box.addEventListener("click", e => { if (e.target === box) closePlanLightbox(el); });
  document.addEventListener("keydown", esc);
  el._plan = { holder, box, esc };

  const btn = el.querySelector(".plan-zoom");
  btn.textContent = "⤡ Close";
  btn.setAttribute("aria-pressed", "true");
}

function closePlanLightbox(el) {
  if (!el._plan) return;
  const { holder, box, esc } = el._plan;
  holder.replaceWith(el);
  box.remove();
  document.removeEventListener("keydown", esc);
  el.classList.remove("plan-big");
  el._plan = null;

  const btn = el.querySelector(".plan-zoom");
  btn.textContent = "⤢ Enlarge";
  btn.setAttribute("aria-pressed", "false");
}

function notePlan(el, text) {
  const note = document.createElement("div");
  note.className = "plan-note";
  note.textContent = text;
  el.querySelector(".plan-legend").before(note);
}

/** Sub-cent costs need four places or they all read as $0.00. */
function fmtMoney(d) {
  if (d == null) return "—";
  return d < 0.01 ? `$${d.toFixed(4)}` : `$${d.toFixed(2)}`;
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

let msgCounter = 0;
function pushUserMessage(text, images = []) {
  const div = document.createElement("div");
  div.className = "msg msg-user";
  const list = Array.isArray(images) ? images : [images];
  if (list.length) {
    const grid = document.createElement("div");
    grid.className = "msg-images" + (list.length > 1 ? " multi" : "");
    list.forEach((image, i) => {
      if (!image || !image.data) return;
      const img = document.createElement("img");
      img.className = "msg-image";
      img.src = image.url || `data:${image.media_type};base64,${image.data}`;
      img.alt = list.length > 1 ? `Attached image ${i + 1}` : "Attached image";
      img.title = image.name || "";
      grid.appendChild(img);
    });
    div.appendChild(grid);
  }
  const p = document.createElement("div");
  p.textContent = text;
  div.appendChild(p);
  els.chatMessages.appendChild(div);
  scrollChatToBottom();
}

function pushBotMessage(text, toolCards = [], loading = false) {
  const id = `msg-${++msgCounter}`;
  const wrap = document.createElement("div");
  wrap.className = "msg msg-bot" + (loading ? " loading" : "");
  wrap.id = id;
  wrap.innerHTML = renderBotBubble(text, toolCards);
  els.chatMessages.appendChild(wrap);
  scrollChatToBottom();
  return id;
}

function replaceMessage(id, text, toolCards = []) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("loading");
  el.innerHTML = renderBotBubble(text, toolCards);
  scrollChatToBottom();
}

function renderBotBubble(text, toolCards) {
  const html = mdLiteToHtml(text);
  const cards = toolCards.length
    ? `<div class="msg-tools">${toolCards.map(t => `
        <a class="msg-tool-chip" href="${t.url}" target="_blank" rel="noopener noreferrer">
          <span>${t.categoryIcon || "🔗"}</span> ${escapeHtml(t.name)}
        </a>`).join("")}</div>`
    : "";
  return `<div class="msg-text">${html}</div>${cards}`;
}

function replaceMessageRaw(id, html) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove("loading");
  el.innerHTML = html;
  scrollChatToBottom();
}

function renderLiveBubble(results) {
  if (results.length === 0) {
    return `<div class="msg-text">Couldn't find a lookup target in that message.</div>`;
  }

  const byTarget = new Map();
  for (const r of results) {
    const key = `${r.target.type}:${r.target.value}`;
    if (!byTarget.has(key)) byTarget.set(key, { target: r.target, items: [] });
    byTarget.get(key).items.push(r);
  }

  let html = `<div class="live-lookup">`;
  const skippedSources = new Set();

  for (const { target, items } of byTarget.values()) {
    html += `<div class="live-target"><span class="live-target-type">${escapeHtml(target.type)}</span> ${escapeHtml(target.value)}</div>`;
    for (const item of items) {
      if (item.status === "skipped") {
        skippedSources.add(item.source);
        continue;
      }
      const cls = item.status === "ok" ? "live-ok" : item.status === "empty" ? "live-empty" : "live-error";
      const body =
        item.status === "error"
          ? `Couldn't reach it directly — likely blocked by CORS, a missing/invalid key, or a rate limit. (${escapeHtml(item.error)})`
          : escapeHtml(item.summary || "");
      html += `
        <div class="live-source ${cls}">
          <div class="live-source-name">${escapeHtml(item.source)}</div>
          <div class="live-source-body">${body.replace(/\n/g, "<br>")}</div>
        </div>`;
    }
  }
  if (skippedSources.size > 0) {
    html += `<div class="live-skip-hint">Add a key for ${[...skippedSources].map(escapeHtml).join(", ")} in AI settings to unlock deeper lookups on this target.</div>`;
  }
  html += `</div>`;
  return html;
}

function mdLiteToHtml(text) {
  // Blockquote lines first, and merge runs of them into one block, so the agent's
  // "> extracted fact" lines render as the boxed-out details they're meant to be.
  const withQuotes = escapeHtml(text)
    .split("\n")
    .map(line => {
      const m = line.match(/^&gt;\s?(.*)$/);
      return m ? { quote: true, text: m[1] } : { quote: false, text: line };
    })
    .reduce((acc, cur) => {
      const prev = acc[acc.length - 1];
      if (cur.quote && prev?.quote) prev.text += "\n" + cur.text;
      else acc.push({ ...cur });
      return acc;
    }, [])
    .map(part =>
      part.quote
        ? `<blockquote>${part.text.replace(/\n/g, "<br>")}</blockquote>`
        : part.text
    )
    .join("\n");

  return withQuotes
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n(?!<blockquote|<\/blockquote)/g, "<br>")
    .replace(/<br>(<blockquote)/g, "$1")
    .replace(/(<\/blockquote>)<br>/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
}

function scrollChatToBottom() {
  els.chatMessages.scrollTop = els.chatMessages.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

/* ---------------- Settings / AI mode ---------------- */

function wireSettings() {
  els.settingsBtn.addEventListener("click", () => {
    els.apiKeyInput.value = state.apiKey;
    els.modelSelect.value = state.model;
    els.routingSelect.value = state.routing;
    for (const [name, input] of Object.entries(els.liveKeyInputs)) {
      input.value = state.liveKeys[name] || "";
    }
    els.settingsModal.classList.add("open");
  });
  els.closeSettings.addEventListener("click", () => els.settingsModal.classList.remove("open"));
  els.settingsModal.addEventListener("click", e => {
    if (e.target === els.settingsModal) els.settingsModal.classList.remove("open");
  });
  els.saveSettings.addEventListener("click", () => {
    state.apiKey = els.apiKeyInput.value.trim();
    state.model = els.modelSelect.value;
    state.routing = els.routingSelect.value === "on" ? "on" : "off";
    localStorage.setItem("aware_api_key", state.apiKey);
    localStorage.setItem("aware_model", state.model);
    localStorage.setItem("aware_routing", state.routing);

    const liveKeys = {};
    for (const [name, input] of Object.entries(els.liveKeyInputs)) {
      const val = input.value.trim();
      if (val) liveKeys[name] = val;
    }
    state.liveKeys = liveKeys;
    localStorage.setItem("aware_live_keys", JSON.stringify(liveKeys));

    els.settingsModal.classList.remove("open");
    updateModeBadge();
    const addedLive = Object.keys(liveKeys).length;
    pushBotMessage(
      (state.apiKey
        ? `AI mode enabled with **${state.model}**. I'll now answer with free-form reasoning grounded in the tool directory.`
        : "AI mode disabled. Back to local keyword matching.") +
        (addedLive > 0 ? ` ${addedLive} live-lookup key(s) saved.` : ""),
      []
    );
  });
  els.clearSettings.addEventListener("click", () => {
    state.apiKey = "";
    state.liveKeys = {};
    localStorage.removeItem("aware_api_key");
    localStorage.removeItem("aware_live_keys");
    els.apiKeyInput.value = "";
    for (const input of Object.values(els.liveKeyInputs)) input.value = "";
    updateModeBadge();
  });
}

/* ---------------- Chat readability ---------------- */

const WORKER_MODEL = "claude-haiku-4-5";

const FONT_STEPS = [13, 14, 16, 18, 20, 22];
const CHAT_WIDTHS = { normal: "460px", wide: "40vw" };

/**
 * Text size and chat width, persisted per browser. Both drive CSS variables so
 * every chat element scales from one place rather than each needing its own rule.
 */
function applyChatPrefs() {
  const root = document.documentElement;
  root.style.setProperty("--chat-fs", `${FONT_STEPS[state.fontStep]}px`);
  root.style.setProperty("--chat-w", CHAT_WIDTHS[state.chatWidth] || CHAT_WIDTHS.normal);
  if (els.fontDown) els.fontDown.disabled = state.fontStep === 0;
  if (els.fontUp) els.fontUp.disabled = state.fontStep === FONT_STEPS.length - 1;
  if (els.widenChat) els.widenChat.classList.toggle("active", state.chatWidth === "wide");
}

function wireChatPrefs() {
  const step = delta => {
    state.fontStep = Math.min(FONT_STEPS.length - 1, Math.max(0, state.fontStep + delta));
    localStorage.setItem("aware_font_step", String(state.fontStep));
    applyChatPrefs();
  };
  els.fontDown.addEventListener("click", () => step(-1));
  els.fontUp.addEventListener("click", () => step(1));
  els.widenChat.addEventListener("click", () => {
    state.chatWidth = state.chatWidth === "wide" ? "normal" : "wide";
    localStorage.setItem("aware_chat_width", state.chatWidth);
    applyChatPrefs();
    // The sticky toolbar's height depends on how the pills wrap, which changes
    // with the directory column's new width.
    syncToolbarOffset();
  });
  applyChatPrefs();
}

function updateModeBadge() {
  const base = state.apiKey ? `AI mode · ${state.model}` : "Local mode";
  els.modeBadge.textContent = Proxy.available ? `${base} · proxy` : base;
  els.modeBadge.classList.toggle("ai-on", !!state.apiKey);
  els.modeBadge.title = (Proxy.available
    ? "Served by server.js — lookups run server-side, so CORS-blocked sources work"
    : "Static hosting — only CORS-friendly sources can be queried from the browser")
    + (Proxy.build ? `\nBuild ${Proxy.build}` : "");
}

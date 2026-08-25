/** UI wiring: directory grid, search/filter, chat panel, settings modal. */

const state = {
  activeCategory: "all",
  searchTerm: "",
  apiKey: localStorage.getItem("aware_api_key") || "",
  model: localStorage.getItem("aware_model") || "claude-sonnet-5",
  chatHistory: [], // Claude-format history for AI mode: {role, content}
  liveKeys: JSON.parse(localStorage.getItem("aware_live_keys") || "{}"),
  attachedImage: null // { media_type, data, name } — data is bare base64
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheEls();
  renderStats();
  renderCategoryPills();
  renderToolsGrid();
  wireDirectory();
  wireChat();
  wireSettings();
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
  els.saveSettings = document.getElementById("saveSettings");
  els.clearSettings = document.getElementById("clearSettings");
  els.suggestions = document.getElementById("chatSuggestions");
  els.attachBtn = document.getElementById("attachBtn");
  els.attachInput = document.getElementById("attachInput");
  els.attachPreview = document.getElementById("attachPreview");
  els.attachThumb = document.getElementById("attachThumb");
  els.attachName = document.getElementById("attachName");
  els.attachRemove = document.getElementById("attachRemove");
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

/* ---------------- Chat ---------------- */

function wireChat() {
  els.chatForm.addEventListener("submit", async e => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text && !state.attachedImage) return;
    els.chatInput.value = "";
    pushUserMessage(text || "(investigate this image)", state.attachedImage);
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
    const file = e.target.files?.[0];
    if (file) loadAttachment(file);
    els.attachInput.value = "";
  });
  els.attachRemove.addEventListener("click", clearAttachment);
  // Pasting a screenshot straight into the chat is the fastest path for image tasks.
  els.chatInput.addEventListener("paste", e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith("image/"));
    if (item) {
      const file = item.getAsFile();
      if (file) { e.preventDefault(); loadAttachment(file); }
    }
  });
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function loadAttachment(file) {
  if (!file.type.startsWith("image/")) return;
  if (file.size > MAX_IMAGE_BYTES) {
    pushBotMessage(`That image is ${(file.size / 1048576).toFixed(1)} MB — too large to send. Please attach one under 5 MB.`, []);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    const url = String(reader.result);
    state.attachedImage = {
      media_type: file.type,
      data: url.split(",")[1], // strip the data: prefix; the API wants bare base64
      name: file.name || "pasted image"
    };
    els.attachThumb.src = url;
    els.attachName.textContent = state.attachedImage.name;
    els.attachPreview.hidden = false;
  };
  reader.readAsDataURL(file);
}

function clearAttachment() {
  state.attachedImage = null;
  els.attachThumb.removeAttribute("src");
  els.attachPreview.hidden = true;
}

async function handleUserQuery(text) {
  // An image, or an explicit investigate-style task, goes to the autonomous agent.
  const image = state.attachedImage;
  const wantsAgent = !!image || looksLikeInvestigation(text);

  if (wantsAgent) {
    clearAttachment();
    if (state.apiKey) {
      await runAgentTask(text, image);
      return;
    }
    pushBotMessage(
      "Running an investigation on my own needs an **Anthropic API key** — I have to reason about the " +
      "task, choose tools, read results and decide what to check next, which local keyword matching " +
      "can't do." + (image ? " Reading an image needs one too." : "") +
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

  if (state.apiKey) {
    const loadingId = pushBotMessage("…thinking", [], true);
    try {
      const reply = await askClaude(state.apiKey, state.model, state.chatHistory, text);
      state.chatHistory.push({ role: "user", content: text });
      state.chatHistory.push({ role: "assistant", content: reply });
      if (state.chatHistory.length > 20) state.chatHistory.splice(0, state.chatHistory.length - 20);
      replaceMessage(loadingId, reply, searchTools(text, 4));
    } catch (err) {
      replaceMessage(
        loadingId,
        `AI mode hit an error (${err.message}). Falling back to local matching for this one:`,
        []
      );
      const local = buildLocalResponse(text);
      pushBotMessage(local.text, local.toolCards);
    }
    return;
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

async function runAgentTask(text, image) {

  const trace = createTraceBubble();
  try {
    await runInvestigation({
      apiKey: state.apiKey,
      model: state.model,
      task: text || "Investigate this image: work out where it was taken and anything else verifiable.",
      image: image ? { media_type: image.media_type, data: image.data } : null,
      liveKeys: state.liveKeys,
      onEvent: ev => trace.push(ev)
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
          add(`<div class="trace-tool">⚙️ <strong>${escapeHtml(ev.name)}</strong> <code>${escapeHtml(JSON.stringify(ev.input))}</code></div>`);
          break;
        case "tool_result":
          add(`<div class="trace-result ${ev.ok ? "ok" : "err"}">${ev.ok ? "✓" : "✗"} ${mdLiteToHtml(truncate(ev.text, 400))}</div>`);
          break;
        case "text":
          add(`<div class="trace-text">${mdLiteToHtml(ev.text)}</div>`);
          break;
        case "refusal":
          add(`<div class="trace-result err">Declined: ${escapeHtml(ev.text)}</div>`);
          break;
        case "error":
          add(`<div class="trace-result err">Error: ${escapeHtml(ev.text)}</div>`);
          break;
      }
    },
    finish() {
      status.textContent = "🔎 Investigation complete";
      scrollChatToBottom();
    }
  };
}

function truncate(s, n) {
  s = String(s || "");
  return s.length > n ? s.slice(0, n) + "…" : s;
}

let msgCounter = 0;
function pushUserMessage(text, image) {
  const div = document.createElement("div");
  div.className = "msg msg-user";
  if (image) {
    const img = document.createElement("img");
    img.className = "msg-image";
    img.src = `data:${image.media_type};base64,${image.data}`;
    img.alt = "Attached image";
    div.appendChild(img);
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
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>")
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
    localStorage.setItem("aware_api_key", state.apiKey);
    localStorage.setItem("aware_model", state.model);

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

function updateModeBadge() {
  els.modeBadge.textContent = state.apiKey ? `AI mode · ${state.model}` : "Local mode";
  els.modeBadge.classList.toggle("ai-on", !!state.apiKey);
}

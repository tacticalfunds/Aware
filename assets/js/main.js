/** UI wiring: directory grid, search/filter, chat panel, settings modal. */

const state = {
  activeCategory: "all",
  searchTerm: "",
  apiKey: localStorage.getItem("aware_api_key") || "",
  model: localStorage.getItem("aware_model") || "claude-sonnet-5",
  chatHistory: [] // Claude-format history for AI mode: {role, content}
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
    `across ${OSINT_CATEGORIES.length} categories indexed. Tell me what you're investigating, or click a suggestion below.`,
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

// Category pills act as a jump-menu over always-visible, categorized sections.
// Typing a search term switches to a flat, ranked results view instead.
function renderToolsGrid() {
  els.toolsGrid.innerHTML = "";
  disconnectSectionObserver();

  if (state.searchTerm) {
    const matches = searchFilteredTools(state.searchTerm);
    setActivePill("all");
    if (matches.length === 0) {
      els.toolsGrid.innerHTML = `<p class="empty-state">No tools match "${escapeHtml(state.searchTerm)}". Try a different term.</p>`;
      return;
    }
    const label = document.createElement("p");
    label.className = "results-label";
    label.textContent = `${matches.length} result${matches.length === 1 ? "" : "s"} for "${state.searchTerm}"`;
    els.toolsGrid.appendChild(label);
    const grid = document.createElement("div");
    grid.className = "tools-grid-inner";
    for (const tool of matches) grid.appendChild(renderToolCard(tool));
    els.toolsGrid.appendChild(grid);
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

    const grid = document.createElement("div");
    grid.className = "tools-grid-inner";
    for (const tool of cat.tools) {
      grid.appendChild(renderToolCard({ ...tool, category: cat.name, categoryId: cat.id, categoryIcon: cat.icon }));
    }
    section.appendChild(grid);
    els.toolsGrid.appendChild(section);
  }

  setupSectionObserver();
}

let sectionObserver = null;
let sectionBottomHandler = null;

function setupSectionObserver() {
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
    { rootMargin: "-190px 0px -70% 0px", threshold: 0 }
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
  card.innerHTML = `
    <div class="tool-card-top">
      <span class="tool-icon">${tool.categoryIcon || "🔗"}</span>
      <span class="tool-category">${tool.category}</span>
    </div>
    <h3>${escapeHtml(tool.name)}</h3>
    <p>${escapeHtml(tool.desc)}</p>
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
}

/* ---------------- Chat ---------------- */

function wireChat() {
  els.chatForm.addEventListener("submit", async e => {
    e.preventDefault();
    const text = els.chatInput.value.trim();
    if (!text) return;
    els.chatInput.value = "";
    pushUserMessage(text);
    await handleUserQuery(text);
  });

  const suggestions = [
    "Investigate a person",
    "Trace a username",
    "Verify a photo",
    "Look up a domain",
    "Check an email for breaches",
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

async function handleUserQuery(text) {
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

let msgCounter = 0;
function pushUserMessage(text) {
  const div = document.createElement("div");
  div.className = "msg msg-user";
  div.textContent = text;
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
    els.settingsModal.classList.remove("open");
    updateModeBadge();
    pushBotMessage(
      state.apiKey
        ? `AI mode enabled with **${state.model}**. I'll now answer with free-form reasoning grounded in the tool directory.`
        : "AI mode disabled. Back to local keyword matching.",
      []
    );
  });
  els.clearSettings.addEventListener("click", () => {
    state.apiKey = "";
    localStorage.removeItem("aware_api_key");
    els.apiKeyInput.value = "";
    updateModeBadge();
  });
}

function updateModeBadge() {
  els.modeBadge.textContent = state.apiKey ? `AI mode · ${state.model}` : "Local mode";
  els.modeBadge.classList.toggle("ai-on", !!state.apiKey);
}

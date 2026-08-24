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
    state.activeCategory = id;
    [...els.categoryPills.children].forEach(p => p.classList.toggle("active", p.dataset.id === id));
    renderToolsGrid();
  });
  return btn;
}

function getFilteredTools() {
  let list = OSINT_TOOLS_FLAT;
  if (state.activeCategory !== "all") {
    list = list.filter(t => t.categoryId === state.activeCategory);
  }
  if (state.searchTerm) {
    const tokens = tokenize(state.searchTerm);
    list = list
      .map(tool => ({ tool, score: scoreTool(tool, tokens) }))
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(s => s.tool);
  }
  return list;
}

function renderToolsGrid() {
  const list = getFilteredTools();
  els.toolsGrid.innerHTML = "";
  if (list.length === 0) {
    els.toolsGrid.innerHTML = `<p class="empty-state">No tools match that search. Try a different term.</p>`;
    return;
  }
  for (const tool of list) {
    els.toolsGrid.appendChild(renderToolCard(tool));
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

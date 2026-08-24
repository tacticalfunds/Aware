# Aware — OSINT Tool Concierge

A single-page website that puts an entire OSINT (open-source intelligence) toolkit
behind one AI chatbot. Inspired by curated toolkit pages like
[start.me/p/L1rEYQ/osint4all](https://start.me/p/L1rEYQ/osint4all), it bundles 116
tools across 18 investigation categories (people search, usernames, email/breach
data, phone lookup, social media, images, geolocation, domain/network recon, web
archives, metadata, dark web, cryptocurrency, business records, government records,
media verification, threat intelligence, and all-in-one frameworks) into one
searchable directory with a chat concierge on top.

## Structure

```
index.html              Page shell: chat panel + directory panel + settings modal
assets/css/styles.css   All styling (dark theme, responsive two-column layout)
assets/js/tools-data.js Tool database: categories -> tools (name, url, desc, tags)
assets/js/chatbot.js    Chat brain: keyword matcher, workflow library, Claude API call
assets/js/main.js       UI wiring: rendering, search/filter, chat, settings
```

No build step, no dependencies — open `index.html` directly or serve the folder
with any static file server (e.g. `python3 -m http.server`).

## How the chatbot works

Two modes, switchable from the "AI settings" button in the header:

- **Local mode (default)** — no account or key needed. A keyword matcher scores
  every tool against your message, and a small library of hand-written
  investigation workflows (e.g. "investigating a person", "verifying an image",
  "tracing a crypto wallet") chains several categories together with guidance text.
- **AI mode (optional)** — paste your own [Anthropic API key](https://console.anthropic.com/)
  and pick a model. The browser calls the Claude API directly
  (`api.anthropic.com/v1/messages` with `anthropic-dangerous-direct-browser-access`),
  grounding answers on the closest-matching tools from the same directory. The key
  is stored only in `localStorage` and is never sent anywhere but Anthropic's API.

## Extending the directory

Add or edit entries in `assets/js/tools-data.js`. Each category is:

```js
{ id: "category-id", name: "Display Name", icon: "🔍", tools: [
  { name: "Tool Name", url: "https://...", desc: "One-line description.", tags: ["keyword", ...] }
]}
```

Tags drive both the directory search and the local chatbot matcher, so add a few
relevant keywords per tool.

## Responsible use

This directory is meant for lawful research, journalism, security work, and
personal-safety investigations. Respect each tool's terms of service and local
law — don't use it to stalk, harass, or target private individuals without a
lawful basis. The AI concierge is instructed to decline requests along those lines.

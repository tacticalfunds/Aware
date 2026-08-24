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
index.html               Page shell: chat panel + directory panel + settings modal
assets/css/styles.css    All styling (dark theme, responsive two-column layout)
assets/js/tools-data.js  Tool database: categories -> tools (name, url, desc, tags)
assets/js/chatbot.js     Chat brain: keyword matcher, workflow library, Claude API call
assets/js/live-lookup.js Target extraction + real API calls for the live-lookup feature
assets/js/main.js        UI wiring: rendering, search/filter, chat, settings
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

## Live lookup — actually running tools, not just linking to them

Drop an IP, domain, Bitcoin address, or email into the chat and the concierge
detects it and queries real APIs itself, reporting results back inline instead
of just suggesting a link. This is intentionally scoped to sources that expose
a genuine public API — most of the 116 directory tools (people search, reverse
phone lookup, social media, reverse image search...) are consumer websites
with no API, and scraping them would break their terms of service, so those
stay link-only.

**No key required** (works for every visitor, out of the box):
- DNS records — Google DNS-over-HTTPS
- Certificate/subdomain history — crt.sh
- IP geolocation/ASN — ipinfo.io
- Bitcoin address balance/history — blockchain.info
- Domain/URL scan history — urlscan.io

**Optional key** (added per-user in AI settings → "Live lookup API keys",
stored only in `localStorage`, same bring-your-own-key pattern as the Claude
integration):
- Shodan (IP → exposed services/ports)
- VirusTotal (domain/IP reputation)
- AbuseIPDB (IP abuse reports)
- Etherscan (ETH address balance)
- Have I Been Pwned (email breach check — note: HIBP's API does not reliably
  support direct browser calls due to CORS, so this one may fall back to its
  error message even with a valid key; a small server-side proxy would be the
  fix if that matters to you)

Each lookup fails gracefully — a blocked/erroring source shows a clear "couldn't
reach it directly" note plus the reason, rather than breaking silently or
looking like a real negative result. The logic lives in `assets/js/live-lookup.js`;
add a new source by writing a `lookupX()` function and registering it under the
appropriate target type in `LIVE_SOURCES`.

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

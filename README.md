# Aware — OSINT Tool Concierge

A single-page website that puts an OSINT (open-source intelligence) toolkit behind
one AI chatbot. Inspired by curated toolkit pages like
[start.me/p/L1rEYQ/osint4all](https://start.me/p/L1rEYQ/osint4all), it bundles
**3,469 tools across 44 investigation categories** into one searchable directory
with a chat concierge on top.

## Where the tools come from

Two provenance tiers, both marked in `assets/js/tools-data.js`:

- **165 hand-written entries** (`curated: true`) — description and tags written by
  hand, URL checked when added.
- **~3,300 imported entries** — merged and deduplicated from four public
  awesome-OSINT collections:
  [edwardtay/awesome-OSINT](https://github.com/edwardtay/awesome-OSINT),
  [cipher387/osint_stuff_tool_collection](https://github.com/cipher387/osint_stuff_tool_collection),
  [jivoi/awesome-osint](https://github.com/jivoi/awesome-osint) and
  [Ph055a/OSINT_Collection](https://github.com/Ph055a/OSINT_Collection).

**Caveat worth knowing:** imported links are inherited from those upstream lists
and are *not* individually verified — link rot is normal in collections this size,
so expect some dead links. About 1,300 imported entries have no upstream
description; those cards fall back to showing their original section heading.

Regenerate the merged dataset with the scripts described in
[`tools/README.md`](tools/README.md).

## Structure

```
index.html               Page shell: chat panel + directory panel + settings modal
assets/css/styles.css    All styling (dark theme, responsive two-column layout)
assets/js/tools-data.js  Tool database: categories -> tools (name, url, desc, tags)
assets/js/chatbot.js     Chat brain: keyword matcher, workflow library, Claude API call
assets/js/live-lookup.js Target extraction + real API calls for the live-lookup feature
assets/js/agent.js       Autonomous investigation agent (Claude tool-use loop + vision)
assets/js/main.js        UI wiring: rendering, search/filter, chat, settings
tools/                   Scripts that regenerate tools-data.js from upstream lists
```

No build step, no dependencies for local use — open `index.html` directly or serve
the folder with any static file server (e.g. `python3 -m http.server`).

## Deploying

- **GitHub Pages** — Settings → Pages → Deploy from a branch → pick this branch,
  `/ (root)`. No build step needed.
- **Netlify / Vercel** — drag the folder onto app.netlify.com/drop for an instant
  URL, or connect the GitHub repo for auto-deploy on push.
- **Railway** — `package.json` + `railway.json` in this repo are there so Railway's
  Nixpacks builder detects it as a Node app: `npm install` pulls in
  [`serve`](https://www.npmjs.com/package/serve), then `npm start` runs
  `serve -s . -l $PORT`, which Railway requires (it only routes traffic to a
  process actually listening on the port it assigns — a plain static-file repo
  with nothing listening won't get a working deployment). In Railway: New
  Project → Deploy from GitHub repo → select this repo/branch → it auto-detects
  and deploys → Settings → Networking → Generate Domain for a public URL.

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

## Autonomous investigation

Give the concierge a task and it runs the investigation itself: plans, calls tools,
reads the results, follows the leads, and writes up what it found. Attach an image
(button or paste) and it analyses that too. Every step is shown live in the chat —
reasoning, each tool call and its result — so nothing is a black box.

It routes to the agent when you attach an image, or when the task reads as an
instruction to go and do something ("investigate…", "look into…", "run a check on…").
Requires an Anthropic API key: it genuinely needs to reason about the task and decide
what to check next, which keyword matching can't do. Without a key it says so and
falls back to direct lookups plus tool recommendations.

Its tools are the live-lookup functions plus a search over the local directory — so
for the ~3,400 sources with no browser-callable API it hands back specific named
tools and what to search for in each. Implementation in `assets/js/agent.js`
(Claude tool-use loop, capped at 12 steps to bound cost).

**Scope limits, enforced in the agent's system prompt:** it will geolocate a photo —
standard OSINT work — but it will not read the licence plates of uninvolved cars in a
car park or street scene and run their registrations, nor try to identify bystanders'
faces. That's bulk collection against people who aren't the subject of the
investigation. It will look up a specific vehicle you have a stated lawful reason to
investigate. It declines tasks aimed at stalking or covertly monitoring a private
individual.

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
- **Phone numbers — analysed entirely offline**, no network call: validity, country,
  line type from the numbering plan (via a vendored
  [libphonenumber-js](https://github.com/catamphetamine/libphonenumber-js) bundle),
  plus the geographic region and cities for US/Canada area codes. Numbers port
  between carriers, so this establishes geography and line type — never the current
  carrier or the subscriber.

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
- Veriphone / AbstractAPI (phone carrier and line type)
- IPQualityScore (phone fraud and spam-risk score)

The three phone providers are the answer to "which carrier is this, and is it
reported as spam" — questions the offline analysis genuinely cannot answer. Their
browser-CORS behaviour is unverified (this repo was built in a sandbox that can't
reach them), so treat a CORS failure there as possible rather than surprising.

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

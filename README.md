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
- **Railway (recommended)** — `npm start` runs `server.js`, which serves the site
  *and* the lookup proxy, so the agent gets its full tool surface. No dependencies;
  Node 18+ only. In Railway: New Project → Deploy from GitHub repo → select this
  repo/branch → Settings → Networking → Generate Domain.

  Optionally set any of these as Railway environment variables to enable the
  credentialed sources for everyone using your deployment, without anyone pasting
  keys into a browser: `SHODAN_KEY`, `VIRUSTOTAL_KEY`, `ABUSEIPDB_KEY`,
  `ETHERSCAN_KEY`, `HIBP_KEY`, `VERIPHONE_KEY`, `IPQS_KEY`, `GITHUB_TOKEN`.
  `GET /api/sources` reports which are configured.

Static hosting (GitHub Pages, Netlify drop) still works, but without `server.js`
there's no proxy — the agent falls back to the handful of CORS-friendly sources plus
the manual handoff, and the mode badge drops the "· proxy" suffix.

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

**With an API key set, the agent handles every turn** — there is deliberately no
second, tool-less chat mode to fall into. Follow-ups continue the same investigation
with the same findings and the same tools, so "it's my own number", "now check the
domain too" or "you do it" all act rather than restating links. Without a key it says
so plainly and falls back to direct lookups plus tool recommendations.

Every investigation is structured in four phases the agent is instructed to follow —
**Plan**, **Tools** (naming which it runs itself vs. which need you), **Findings**
(each extracted fact in a blockquote, rendered as a boxed callout), and
**Assessment** (what's established, what isn't, confidence, next step).

### How it covers 3,469 tools with ~20 callable ones

Two mechanisms, because no single one covers the whole directory:

**1. Server-side proxy — for anything with an API.** Most OSINT APIs send no CORS
headers, so a browser physically cannot call them. `server.js` proxies a fixed list of
34 sources. It is **not** an open proxy: the client sends a source *name* and
parameters, and the server builds the upstream URL itself from its own table — passing
a raw URL through would be an SSRF hole. API keys can live in server env vars instead
of every visitor's browser.

Two of the 26 agent tools deserve specific mention:

- **`username_enumeration`** — checks a handle against hundreds of sites using the
  [WhatsMyName](https://github.com/WebBreacher/WhatsMyName) dataset (`data/wmn-data.json`,
  refresh with `tools/refresh-wmn.sh`), the same technique as Sherlock/Maigret. It only
  works server-side, since the browser can't read cross-origin responses. Requests are
  throttled (12 concurrent, 7s timeout, 90 sites by default) because this fans out to
  hundreds of third parties. Sites behind CAPTCHA/Cloudflare are **skipped rather than
  reported as misses** — their challenge page would otherwise read as "no account", and
  a false negative is worse than a gap you know about. Results are a floor, not a ceiling.
- **`sun_position`** — sun altitude/azimuth and shadow direction for a place and time,
  computed offline. The workhorse for dating an outdoor photo: shadows fall opposite the
  sun's azimuth, and shadow length is `1/tan(altitude)` × object height.
  (Note for anyone editing this: suncalc v2 returns **degrees measured from north**, not
  v1's radians-from-south — the `* 180/Math.PI` conversion in most tutorials produces
  garbage here. Verified against sunrise-NE / noon-due-south / sunset-NW.)

**2. Human-in-the-loop handoff — for everything else.** The great majority of the
directory is sites with no API, or that need a login, or that block automation. For
those the agent calls `request_manual_lookup`: it builds the **exact prefilled URL**,
states precisely what to copy back, and **the run pauses**. You click through, paste
what you found, and that text returns to the agent as the tool's result so it continues
the analysis. Skip is always available and gets recorded as unchecked.

This is deliberately chosen over headless-browser scraping. Automating those sites is
fragile (breaks on any layout change), gets blocked quickly, needs ~500MB RAM per
Chromium instance on your host, and for many of them violates their terms of service —
liability that lands on whoever runs the deployment. If you want it anyway, a commercial
scraping API (Apify, ScrapingBee) is the saner route: add it as a source in `server.js`
rather than driving a browser yourself.

Implementation in `assets/js/agent.js` (Claude tool-use loop, capped at 12 steps to
bound cost) and `assets/js/proxy.js`.

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

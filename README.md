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
assets/css/styles.css    Base styling (dark theme, two-column layout)
assets/css/compact.css   Phone layout — see "Phones that lie about their width"
assets/css/narrow.css    Extra stacking under ~560px
server.js                Static host + lookup/tile/image proxy (see Deploying)
assets/js/tools-data.js  Tool database: categories -> tools (name, url, desc, tags)
assets/js/chatbot.js     Chat brain: keyword matcher, workflow library, Claude API call
assets/js/live-lookup.js Target extraction + real API calls for the live-lookup feature
assets/js/agent.js       Autonomous investigation agent (Claude tool-use loop + vision)
assets/js/tools/         Agent tool groups: geo, image, metadata, visual, photos
assets/js/main.js        UI wiring: rendering, search/filter, chat, settings
tools/                   Scripts that regenerate tools-data.js from upstream lists
```

### Phones that lie about their width

The phone layout lives in its own stylesheet loaded with a `media` attribute,
rather than inside an `@media` block, because some browsers do not lay the page
out at the width the device actually is.

Safari's **Request Desktop Website** and many in-app WebViews ignore the viewport
meta tag and lay the page out at ~980px, then scale the result down to fit. Every
`max-width` media query resolves to the desktop layout, so a 390px phone renders
two columns side by side — which is the correct rendering *for a 980px viewport*,
and no CSS can tell the two cases apart.

`screen.width` and the pointer type still describe the real device, so a short
script in `index.html` uses them: when they say phone and the layout viewport says
desktop, it flips `compact.css` to `media="all"`. Keeping the rules in one file
means there is still only one copy of them, and the media attributes stay in place
so ordinary desktop resizing is untouched.

A browser doing this also scales the text down with everything else. The layout
proportions come out right, but type ends up around 40% size — the real fix for
that is turning the browser setting off, or opening the site in Safari/Chrome
proper rather than an in-app browser.

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
  keys into a browser. **[KEYS.md](KEYS.md)** covers what each one is worth, in the
  order they change what the agent can actually do — `BRAVE_KEY` and
  `MAPILLARY_TOKEN` first, since without them web search is a scrape that gets
  rate-limited and street-level imagery is a manual handoff. The server also names
  the ones you have not set on every startup.
  `GET /api/sources` reports which are configured, along with the basemap layers
  available to the plan view.

Overpass — the OSM query backend behind `osm_nearby` and `osm_find_named` — rate
limits hard (429) and sheds load (504). `server.js` retries across four public
mirrors with a growing backoff and caches successful queries for ten minutes, so
a transient outage costs the agent nothing; only a genuine dead end reaches it,
and the error says how many attempts were spent.

Retrying without a deadline turned out to be its own failure. Eight attempts at a
30-second timeout is four minutes on one lookup, holding a connection open the
whole time without sending a byte — which nothing survives: the edge proxy or the
browser drops it, and the page reports the generic `Failed to fetch`. Every lookup
now has a **total budget of 22 seconds**, retries included, with the clock starting
when the request arrives rather than when it reaches the front of a queue. An
attempt that cannot finish inside the budget is never started, and the error says
so.

Sources marked `serial` — Overpass is the only one — are queued one at a time. The
agent fires tool calls in parallel by design, which is right for independent
lookups and wrong for a rate-limited one: the public instances allocate a couple of
slots per IP, so two simultaneous queries from a single turn mostly buy two 429s.

On the client, every proxy call carries a 35-second deadline and translates a
network failure into something the agent can act on. `fetch` rejects with a bare
`TypeError` for every network-level problem, carrying no status and no explanation;
handed to the model verbatim it reads as though the lookup returned nothing, when
in fact it never ran.

Static hosting (GitHub Pages, Netlify drop) still works, but without `server.js`
there's no proxy — the agent falls back to the handful of CORS-friendly sources plus
the manual handoff, the mode badge drops the "· proxy" suffix, and the plan view
draws its geometry on a plain grid instead of aerial imagery.

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

### Knowing which build is running

`server.js` used to send no cache validators at all — no `Cache-Control`, no
`ETag`, no `Last-Modified` — which leaves a browser free to apply heuristic
caching and keep serving whatever copy of the scripts it already has. A deployed
fix could simply not reach the page, and a bug that had been fixed kept happening.

Static files now carry `Cache-Control: no-cache` and a content-hash `ETag`.
"no-cache" means revalidate before use, not "do not store": each file costs one
304 per load and a deploy takes effect on the next reload, which is the right
trade for a site with no cache-busted filenames.

Alongside that, the running build is identified — from Railway's commit SHA, or
git, or a hash of the source as a last resort. It appears in the startup log, in
`GET /api/sources`, in the browser console at load, and in the mode badge's
tooltip. "It still does that after the fix" is otherwise unanswerable.

### Both diagrams, every investigation

Asking for the visuals in the system prompt was not enough — a run would reason
its way to a location and then write it up in prose, which is the part a reader
cannot check.

The loop now watches what the UI actually rendered (`showVisual` reports whether a
visual reached the trace, so an `annotate_image` that came back "there's no image
to annotate" does not count) and refuses to let a turn end without them. It asks
once per diagram, so a model that declines is not put in a loop.

The requirement is conditional on there being something to draw, because
demanding a diagram the evidence does not support would only invite invented
coordinates: `annotate_image` is required when an image is attached, and
`plot_triangulation` once any lookup has returned real coordinates. With neither —
a domain lookup, say — nothing is demanded.

### Surviving a bad connection

A single dropped request used to end an investigation outright: one `fetch` to the
Claude API, no retry, and `Failed to fetch` — the browser's generic network
`TypeError`, which carries no status and explains nothing — as the whole report.
Minutes of tool calls went with it.

The call now retries network failures, 429 and the 5xx family including 529
(overloaded), backing off between attempts and honouring `Retry-After`. A bad key
or a malformed request is a real answer and comes straight back rather than being
retried six times. Every retry shows in the trace, and the message on a genuine
outage says how many attempts were spent and that saying "continue" resumes.

The first version of that policy — four attempts inside six seconds — was not a
policy for a phone. A wifi-to-cellular handover, a lift, a tunnel: these last tens
of seconds, and every attempt spent inside the window is wasted. The budget is now
six attempts over roughly half a minute, and when `navigator.onLine` says the
device is offline the run **holds** for up to 45 seconds waiting for the `online`
event rather than spending an attempt. `navigator.onLine` reports the link and not
whether anything is reachable, so it is only ever used to add patience, never to
conclude anything. Proxy calls get the same treatment on a smaller scale: one
retry for a network-level failure, none for a timeout, since the server has its
own budget and a slow answer will not become a fast one.

Both failure messages now record what the browser thought of the connection.
"Failed to fetch" while offline and "Failed to fetch" while online are different
problems and were previously indistinguishable in the report.

Photo tools make the other half of this problem: every image they return is
re-sent with every later turn, and a few `place_photos` calls at 800px is
megabytes of base64 per step — which is what a browser reports as a request that
simply fails. Images older than a short window are replaced with a note that they
were there; images the user attached are never touched.

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
42 sources, 32 of which need no API key at all. It is **not** an open proxy: the client sends a source *name* and
parameters, and the server builds the upstream URL itself from its own table — passing
a raw URL through would be an SSRF hole. API keys can live in server env vars instead
of every visitor's browser.

#### Image metadata — `assets/js/tools/metadata.js`

EXIF is parsed **in the browser** the moment you attach an image, and handed to the
agent as stated fact. This matters because Claude's vision reads pixels, not file
headers — without it, a photo's embedded GPS coordinates and capture time are
silently discarded, and those are usually the most direct answer to "where and when".

Reported with the caveats that matter: EXIF is trivially editable, every major social
platform strips it on upload, and a `Software` tag naming an editor means the file has
been re-saved. Exposure values are read as a rough daylight/low-light cross-check
against a claimed time.

#### Visual output — `assets/js/tools/visual.js`

Two tools that let the agent *show* its reasoning rather than assert it:

- **`annotate_image`** — colour-coded numbered boxes over the photo marking the exact
  details the conclusion rests on (amber signs, teal landmarks, violet vehicles,
  yellow shadows, green terrain), with a matching legend. Coordinates are normalised
  0–1 and clamped into frame.
- **`plot_triangulation`** — a survey-style plan view drawn **over real aerial imagery
  of the site**: numbered magenta control points for each located anchor, the camera
  station, a sight line to every anchor labelled with its distance and bearing, the
  view cone, the error ellipse, a lat/lon graticule, scale bar, north arrow and
  imagery attribution. OpenStreetMap building footprints (amber) and ways (green) are
  fetched from Overpass and traced over the photography, so the fix can be checked
  against the actual ground.

  It also returns every pairwise distance and bearing to the agent, so it doubles as a
  check on its own geometry — the bearings have to match the left-to-right order of
  the features in the photo, and the agent is told to move the station and re-plot if
  they don't.

  Imagery comes through `GET /api/tile/{layer}/{z}/{x}/{y}` (`satellite` = Esri World
  Imagery, `street` = OpenStreetMap), proxied and cached by `server.js` for the same
  reason as the lookup proxy: the client names a layer and tile, never a URL. Zoom is
  chosen one integer step tighter than fits and then scaled down to land the scene
  exactly in frame, so the diagram fills itself without stretching the imagery.
  Without `server.js` — or if the imagery is unreachable — the diagram degrades to the
  geometry on a plain grid and says so. Inline it renders at chat width; **⤢ Enlarge**
  lifts it into a full-viewport overlay (Escape or a click outside puts it back).

#### Photographs of places — `assets/js/tools/photos.js`

The difference between naming a location and verifying one. These return **actual
pixels the model looks at**: images ride back inside the tool result as image
blocks, so on its next turn the agent is comparing a photo of the candidate place
against the photo in hand, rather than handing the user a list of links.

- **`place_photos`** — every geotagged Wikimedia Commons photo within a radius of a
  point, or a name search when there are no coordinates yet, falling back to
  Openverse (Flickr and friends) where Commons is thin. Thumbnails are fetched
  server-side and attached as images; everything found is also listed as text, so
  nothing is silently dropped.
- **`street_imagery`** — Mapillary frames around a point, each carrying the compass
  angle it was shot at, sorted by how close that heading is to the camera bearing
  the agent derived. Without `MAPILLARY_TOKEN` it falls back to handing the user
  prefilled Street View / Mapillary / KartaView links.
- **`web_search`** — Brave when `BRAVE_KEY` is set, otherwise the no-JavaScript
  endpoints of DuckDuckGo, DuckDuckGo Lite and Mojeek in turn, taking the first
  that answers. DuckDuckGo alone starts serving a bot challenge after two or three
  queries from a hosted server, and an agent firing parallel searches trips that
  immediately — so `POST /api/search` caches results for fifteen minutes,
  serialises outbound requests with a minimum gap between them, and falls through
  to the next engine when one is challenged. If every engine is blocked the tool
  says so explicitly: "could not check" and "nothing found" are different findings
  and the agent is told not to confuse them.

Images cost roughly 1.1k tokens each at 800px, so the defaults are low (3, max 6)
and the model is told to raise them only when it is comparing closely.

Fetching runs through `POST /api/image`, which is **strictly allowlisted by host**
— the image CDNs behind those sources and nothing else, HTTPS only, `image/*` only,
5 MB cap. It cannot be used to reach an arbitrary URL.

#### Geolocation tools — `assets/js/tools/geo.js`

All seven geo capabilities the agent can run automatically live in one module,
definitions and executors together. None need an API key:

| Tool | Source | What it's for |
|---|---|---|
| `geocode` | Nominatim | Place/address ⇄ coordinates |
| `place_search` | Photon | Fuzzy/partial names — a half-read shop sign |
| `osm_nearby` | Overpass | What features should be visible at a candidate spot |
| `elevation` | OpenTopoData | Rule candidates in/out by terrain; line-of-sight checks |
| `weather_history` | Open-Meteo | What the weather **actually** was, back to 1940 |
| `sun_position` | offline | Sun altitude/azimuth, shadow bearing and length |
| `moon_position` | offline | Moon altitude/azimuth, phase, rise/set — night photos |

Together these run the full verification loop: read visual clues → geocode → check
terrain → check what's nearby → verify sun/moon geometry → verify weather.
`weather_history` is the sharpest of them for breaking a false claim — an image
showing dry ground on a day the record says had 12mm of rain is a hard contradiction.

Tool groups register through a `{GROUP}_TOOLS` / `{GROUP}_EXECUTORS` pair that
`agent.js` merges; add a new group by dropping a file in `assets/js/tools/` and
listing it in `TOOL_GROUPS`.

Two other tools deserve specific mention:

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

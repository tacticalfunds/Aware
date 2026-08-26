/**
 * Aware server: static file host + OSINT lookup proxy.
 *
 * Why a proxy at all: most OSINT APIs don't send CORS headers, so a browser
 * simply cannot call them from the page. Routing through this server removes
 * that limit and unlocks sources the client could never reach directly, and
 * lets API keys live in server env vars instead of every visitor's localStorage.
 *
 * Security: this is NOT an open proxy. The client sends a source *name* and
 * parameters; the server builds the upstream URL itself from the SOURCES table
 * below. There is deliberately no way to pass a raw URL through — that would be
 * an SSRF hole letting anyone use this box to hit internal addresses.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

/* ------------------------------------------------------------------ *
 * Upstream sources. Each builds its own URL from validated params.
 * `key` names an env var; when absent the source reports itself as
 * unconfigured rather than calling out with a broken request.
 * ------------------------------------------------------------------ */

const enc = encodeURIComponent;

const SOURCES = {
  // --- no credentials required ---
  dns: {
    build: p => `https://dns.google/resolve?name=${enc(p.name)}&type=${enc(p.type || "A")}`
  },
  rdap_domain: {
    // Registration data — the modern, machine-readable replacement for WHOIS.
    build: p => `https://rdap.org/domain/${enc(p.domain)}`
  },
  crtsh: {
    build: p => `https://crt.sh/?q=${enc("%." + p.domain)}&output=json`
  },
  ipinfo: {
    build: p => `https://ipinfo.io/${enc(p.ip)}/json`
  },
  urlscan: {
    build: p => `https://urlscan.io/api/v1/search/?q=domain:${enc(p.domain)}`
  },
  wayback: {
    build: p => `https://archive.org/wayback/available?url=${enc(p.url)}${p.timestamp ? `&timestamp=${enc(p.timestamp)}` : ""}`
  },
  wayback_cdx: {
    build: p => `https://web.archive.org/cdx/search/cdx?url=${enc(p.url)}&output=json&limit=${Number(p.limit) || 20}&collapse=timestamp:6`
  },
  btc_address: {
    build: p => `https://blockchain.info/rawaddr/${enc(p.address)}?limit=10`
  },
  github_user: {
    build: p => `https://api.github.com/users/${enc(p.username)}`
  },
  github_user_repos: {
    build: p => `https://api.github.com/users/${enc(p.username)}/repos?sort=updated&per_page=20`
  },
  github_search_users: {
    build: p => `https://api.github.com/search/users?q=${enc(p.q)}&per_page=10`
  },
  github_search_code: {
    build: p => `https://api.github.com/search/code?q=${enc(p.q)}&per_page=10`,
    key: "GITHUB_TOKEN",
    auth: (url, k) => ({ url, headers: { Authorization: `Bearer ${k}` } })
  },
  wikipedia: {
    build: p => `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${enc(p.q)}&format=json&srlimit=8&origin=*`
  },
  wikidata: {
    build: p => `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${enc(p.q)}&language=en&format=json&origin=*`
  },
  nominatim: {
    // Geocode a place name, or reverse-geocode coordinates.
    build: p => p.lat && p.lon
      ? `https://nominatim.openstreetmap.org/reverse?lat=${enc(p.lat)}&lon=${enc(p.lon)}&format=jsonv2`
      : `https://nominatim.openstreetmap.org/search?q=${enc(p.q)}&format=jsonv2&limit=5`
  },
  nhtsa_vin: {
    build: p => `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${enc(p.vin)}?format=json`
  },
  hackernews: {
    build: p => `https://hn.algolia.com/api/v1/search?query=${enc(p.q)}&hitsPerPage=10`
  },
  reddit_user: {
    build: p => `https://www.reddit.com/user/${enc(p.username)}/about.json`
  },
  reddit_search: {
    build: p => `https://www.reddit.com/search.json?q=${enc(p.q)}&limit=10`
  },
  coingecko: {
    build: p => `https://api.coingecko.com/api/v3/simple/price?ids=${enc(p.ids)}&vs_currencies=usd`
  },
  opensky: {
    build: p => `https://opensky-network.org/api/states/all?icao24=${enc(p.icao24)}`
  },
  rdap_ip: {
    // Who the IP block is registered to — the netblock owner, not just the host.
    build: p => `https://rdap.org/ip/${enc(p.ip)}`
  },
  bgpview_ip: {
    build: p => `https://api.bgpview.io/ip/${enc(p.ip)}`
  },
  bgpview_asn: {
    build: p => `https://api.bgpview.io/asn/${enc(String(p.asn).replace(/^AS/i, ""))}`
  },
  urlhaus: {
    // abuse.ch malware-URL database; host lookup needs no key.
    build: p => `https://urlhaus-api.abuse.ch/v1/host/`,
    method: "POST",
    body: p => `host=${enc(p.host)}`,
    contentType: "application/x-www-form-urlencoded"
  },
  bluesky_profile: {
    build: p => `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${enc(p.handle)}`
  },
  photon: {
    // Komoot's geocoder — much better than Nominatim on partial/misspelled input.
    build: p => `https://photon.komoot.io/api/?q=${enc(p.q)}&limit=8` +
      (p.lat != null && p.lon != null ? `&lat=${enc(p.lat)}&lon=${enc(p.lon)}` : "")
  },
  opentopodata: {
    build: p => `https://api.opentopodata.org/v1/srtm30m?locations=${enc(p.locations)}`
  },
  open_meteo_archive: {
    // Historical weather back to 1940; archive lags ~5 days behind the present.
    build: p => `https://archive-api.open-meteo.com/v1/archive?latitude=${enc(p.lat)}&longitude=${enc(p.lon)}` +
      `&start_date=${enc(p.start)}&end_date=${enc(p.end)}` +
      `&hourly=temperature_2m,precipitation,cloud_cover,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum` +
      `&timezone=UTC`
  },
  overpass: {
    // Free-form OSM query — the workhorse for "what is near these coordinates".
    //
    // The main instance rate-limits hard (429) and sheds load under pressure
    // (504), which in practice meant an investigation spent its whole step
    // budget on failed lookups. Mirrors are tried in order, and a short-lived
    // cache stops an agent that retries the same query from paying twice.
    build: () => `https://overpass-api.de/api/interpreter`,
    mirrors: [
      "https://overpass.kumi.systems/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
      "https://overpass.osm.jp/api/interpreter"
    ],
    method: "POST",
    body: p => `data=${enc(p.query)}`,
    contentType: "application/x-www-form-urlencoded",
    timeout: 30000,
    cacheKey: p => `overpass:${p.query}`,
    cacheMs: 10 * 60 * 1000
  },

  /* --- imagery and photos of places, so a candidate location can actually be
         looked at rather than merely named --- */

  commons_geosearch: {
    // Every geotagged photo Wikimedia Commons holds within a radius of a point.
    // iiurlwidth asks for an 800px thumbnail, which is what gets shown to the
    // model — the originals are frequently 20 MP.
    build: p => `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
      `&generator=geosearch&ggsnamespace=6` +
      `&ggscoord=${enc(p.lat)}%7C${enc(p.lon)}` +
      `&ggsradius=${enc(Math.min(Math.max(Number(p.radius) || 500, 10), 10000))}` +
      `&ggslimit=${enc(Math.min(Number(p.limit) || 20, 50))}` +
      `&prop=imageinfo%7Ccoordinates&iiprop=url%7Cextmetadata%7Cmime&iiurlwidth=800`
  },
  commons_search: {
    // Same, but by name — "Rockmount Ranch Wear", "Union Station Denver".
    build: p => `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
      `&generator=search&gsrnamespace=6&gsrsearch=${enc(p.q)}` +
      `&gsrlimit=${enc(Math.min(Number(p.limit) || 12, 30))}` +
      `&prop=imageinfo&iiprop=url%7Cextmetadata%7Cmime&iiurlwidth=800`
  },
  openverse: {
    // ~700M openly-licensed images. No key for anonymous use.
    build: p => `https://api.openverse.org/v1/images/?q=${enc(p.q)}` +
      `&page_size=${enc(Math.min(Number(p.limit) || 12, 20))}&mature=false`
  },

  // --- credentialed; key comes from the server env, never the browser ---
  mapillary_images: {
    // Crowdsourced street-level photography, with the compass angle of each
    // shot — which is directly comparable to a derived camera bearing.
    key: "MAPILLARY_TOKEN",
    build: (p, k) => `https://graph.mapillary.com/images` +
      `?fields=id,thumb_1024_url,computed_geometry,geometry,captured_at,compass_angle,is_pano` +
      `&bbox=${enc(p.bbox)}&limit=${enc(Math.min(Number(p.limit) || 12, 50))}` +
      `&access_token=${enc(k)}`
  },
  brave_search: {
    key: "BRAVE_KEY",
    build: p => `https://api.search.brave.com/res/v1/web/search?q=${enc(p.q)}&count=10`,
    auth: (url, k) => ({ url, headers: { "X-Subscription-Token": k, Accept: "application/json" } })
  },

  shodan: {
    key: "SHODAN_KEY",
    build: (p, k) => `https://api.shodan.io/shodan/host/${enc(p.ip)}?key=${enc(k)}`
  },
  virustotal: {
    key: "VIRUSTOTAL_KEY",
    build: p => `https://www.virustotal.com/api/v3/${p.kind === "ip" ? "ip_addresses" : "domains"}/${enc(p.target)}`,
    auth: (url, k) => ({ url, headers: { "x-apikey": k } })
  },
  abuseipdb: {
    key: "ABUSEIPDB_KEY",
    build: p => `https://api.abuseipdb.com/api/v2/check?ipAddress=${enc(p.ip)}&maxAgeInDays=90`,
    auth: (url, k) => ({ url, headers: { Key: k, Accept: "application/json" } })
  },
  etherscan: {
    key: "ETHERSCAN_KEY",
    build: (p, k) => `https://api.etherscan.io/api?module=account&action=balance&address=${enc(p.address)}&tag=latest&apikey=${enc(k)}`
  },
  hibp: {
    key: "HIBP_KEY",
    build: p => `https://haveibeenpwned.com/api/v3/breachedaccount/${enc(p.email)}?truncateResponse=false`,
    auth: (url, k) => ({ url, headers: { "hibp-api-key": k } })
  },
  veriphone: {
    key: "VERIPHONE_KEY",
    build: (p, k) => `https://api.veriphone.io/v2/verify?phone=${enc(p.phone)}&key=${enc(k)}`
  },
  ipqs_phone: {
    key: "IPQS_KEY",
    build: (p, k) => `https://ipqualityscore.com/api/json/phone/${enc(k)}/${enc(p.phone)}`
  }
};

/* ------------------------------------------------------------------ *
 * Web search.
 *
 * There is no free, keyless search API that reliably serves a datacenter IP, so
 * this scrapes the no-JavaScript endpoints of several engines and takes the
 * first that answers. DuckDuckGo alone was not enough: it starts returning a bot
 * challenge after two or three queries from a hosted server, and an agent that
 * fires parallel searches trips that immediately.
 *
 * Three defences, all of them here rather than in the client so nothing can skip
 * them: results are cached, outbound requests are serialised with a minimum gap,
 * and a challenged engine falls through to the next one.
 *
 * None of the markup below is an API contract, so every parser is deliberately
 * loose and reports "blocked" rather than "empty" when it recognises nothing —
 * an empty result set and a bot wall mean very different things to an
 * investigation.
 * ------------------------------------------------------------------ */

const stripTags = t => String(t)
  .replace(/<[^>]+>/g, "")
  .replace(/&amp;/g, "&").replace(/&#x27;|&#0?39;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const CHALLENGE = /anomaly|unusual traffic|challenge-platform|captcha|are you a robot|access denied/i;

/** Pulls the real destination out of an engine's redirect wrapper. */
function unwrap(href) {
  const m = /[?&](?:uddg|url|r)=([^&"]+)/.exec(href);
  if (m) { try { return decodeURIComponent(m[1]); } catch { /* fall through */ } }
  return href.startsWith("//") ? "https:" + href : href;
}

/*
 * Attribute order in these pages is not stable and is nobody's contract, so pull
 * every anchor apart first rather than matching href and class in a fixed order.
 */
function anchors(html) {
  const out = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const href = (/href="([^"]*)"/.exec(attrs) || /href='([^']*)'/.exec(attrs) || [])[1] || "";
    const cls = (/class="([^"]*)"/.exec(attrs) || /class='([^']*)'/.exec(attrs) || [])[1] || "";
    // Kept even without an href: snippet elements are anchors with none.
    out.push({ href, cls, text: m[2] });
  }
  return out;
}

function parseDuckDuckGo(html) {
  const all = anchors(html);
  const results = all.filter(a => a.href && /\bresult__a\b/.test(a.cls)).slice(0, 12)
    .map(a => ({ title: stripTags(a.text), url: unwrap(a.href), snippet: "" }));
  const snippets = all.filter(a => /\bresult__snippet\b/.test(a.cls)).map(a => stripTags(a.text));
  results.forEach((r, i) => { if (snippets[i]) r.snippet = snippets[i]; });
  return results.filter(r => r.title);
}

function parseDuckDuckGoLite(html) {
  const results = anchors(html).filter(a => a.href && /\bresult-link\b/.test(a.cls)).slice(0, 12)
    .map(a => ({ title: stripTags(a.text), url: unwrap(a.href), snippet: "" }));
  const sre = /<td[^>]*class="[^"]*\bresult-snippet\b[^"]*"[^>]*>([\s\S]*?)<\/td>/g;
  for (let i = 0; i < results.length; i++) {
    const sm = sre.exec(html);
    if (sm) results[i].snippet = stripTags(sm[1]);
  }
  return results.filter(r => r.title);
}

function parseMojeek(html) {
  const out = [];
  // Mojeek wraps each result title in an <h2> holding the link; the snippet is
  // the <p class="s"> that follows it.
  const re = /<h2>\s*(<a\b[^>]*>[\s\S]*?<\/a>)\s*<\/h2>([\s\S]{0,900}?)(?=<h2>|<\/li>|$)/g;
  let m;
  while ((m = re.exec(html)) && out.length < 12) {
    const a = anchors(m[1]).find(x => x.href);
    if (!a) continue;
    const sm = /<p[^>]*class="[^"]*\bs\b[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(m[2]);
    const title = stripTags(a.text);
    if (title) out.push({ title, url: unwrap(a.href), snippet: sm ? stripTags(sm[1]) : "" });
  }
  return out;
}

const SEARCH_ENGINES = [
  { name: "DuckDuckGo", url: q => `https://html.duckduckgo.com/html/?q=${enc(q)}`, parse: parseDuckDuckGo },
  { name: "DuckDuckGo Lite", url: q => `https://lite.duckduckgo.com/lite/?q=${enc(q)}`, parse: parseDuckDuckGoLite },
  { name: "Mojeek", url: q => `https://www.mojeek.com/search?q=${enc(q)}`, parse: parseMojeek }
];

const SEARCH_CACHE = new Map();          // query -> { at, value }
const SEARCH_CACHE_MS = 15 * 60 * 1000;
const SEARCH_MIN_GAP_MS = 1200;          // between outbound requests, whatever the engine
let searchChain = Promise.resolve();
let lastSearchAt = 0;

/** Serialises outbound searches and keeps a floor on the gap between them. */
function queueSearch(fn) {
  const run = searchChain.then(async () => {
    const since = Date.now() - lastSearchAt;
    if (since < SEARCH_MIN_GAP_MS) await sleep(SEARCH_MIN_GAP_MS - since);
    try { return await fn(); } finally { lastSearchAt = Date.now(); }
  });
  // Keep the chain alive even if this link rejects.
  searchChain = run.then(() => {}, () => {});
  return run;
}

async function runSearch(rawQuery) {
  const q = String(rawQuery || "").trim().slice(0, 300);
  if (!q) throw Object.assign(new Error("Empty query"), { status: 400 });

  const hit = SEARCH_CACHE.get(q);
  if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return { ...hit.value, cached: true };

  // A configured Brave key beats every scrape, and isn't rate-limited this way.
  if (process.env.BRAVE_KEY) {
    try {
      const out = await runLookup("brave_search", { q });
      const results = (out.body?.web?.results || []).slice(0, 10).map(r => ({
        title: stripTags(r.title), url: r.url, snippet: stripTags(r.description || "")
      }));
      if (results.length) {
        const value = { engine: "Brave", results, tried: ["Brave"] };
        SEARCH_CACHE.set(q, { at: Date.now(), value });
        return value;
      }
    } catch { /* fall through to the scrapers */ }
  }

  const tried = [];
  for (const engine of SEARCH_ENGINES) {
    tried.push(engine.name);
    try {
      const out = await queueSearch(() => fetchOnce(engine.url(q), {
        headers: {
          "User-Agent": UPSTREAM_UA,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9"
        },
        redirect: "follow"
      }, 20000));

      const html = typeof out.body?.raw === "string" ? out.body.raw : "";
      if (!out.ok || !html) continue;
      const results = engine.parse(html);
      if (results.length) {
        const value = { engine: engine.name, results, tried };
        SEARCH_CACHE.set(q, { at: Date.now(), value });
        return value;
      }
      // No results AND challenge markers means blocked; no results alone might
      // genuinely be no results, but another engine is cheap enough to ask.
      if (!CHALLENGE.test(html)) continue;
    } catch { /* try the next engine */ }
  }

  return { blocked: true, tried, results: [] };
}

/** Which proxied sources are usable right now — the client uses this to decide. */
function availableSources() {
  const out = {};
  for (const [name, src] of Object.entries(SOURCES)) {
    out[name] = !src.key || !!process.env[src.key];
  }
  return out;
}

/*
 * A transient upstream failure is not a dead end — but the agent only finds that
 * out if it burns a step retrying, so retries happen here instead. 429 and the
 * 5xx family are the load-shedding codes; everything else is a real answer and
 * comes straight back.
 */
const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const LOOKUP_CACHE = new Map();   // cacheKey -> { at, value }

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchOnce(url, init, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 20000) }; }
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function runLookup(name, params) {
  const src = SOURCES[name];
  if (!src) throw Object.assign(new Error(`Unknown source: ${name}`), { status: 400 });

  let key;
  if (src.key) {
    key = process.env[src.key];
    if (!key) {
      throw Object.assign(
        new Error(`${name} is not configured on the server (set ${src.key})`),
        { status: 503 }
      );
    }
  }

  const ck = src.cacheKey && src.cacheKey(params || {});
  if (ck) {
    const hit = LOOKUP_CACHE.get(ck);
    if (hit && Date.now() - hit.at < (src.cacheMs || 300000)) return hit.value;
  }

  let url = src.build(params || {}, key);
  let headers = {
    // Nominatim and a few others reject requests without a real UA.
    "User-Agent": "Aware-OSINT/1.0 (+https://github.com/tacticalfunds/Aware)",
    Accept: "application/json",
    ...(src.headers || {})
  };
  if (src.auth) {
    const a = src.auth(url, key);
    url = a.url;
    headers = { ...headers, ...a.headers };
  }

  const init = { headers, redirect: "follow" };
  if (src.method === "POST") {
    init.method = "POST";
    init.body = src.body(params || {});
    init.headers = { ...headers, "Content-Type": src.contentType || "application/json" };
  }

  // The primary URL first, then each mirror, then one more pass over all of them
  // with a growing pause — a rate limit usually clears in a few seconds.
  const endpoints = [url, ...(src.mirrors || [])];
  const timeout = src.timeout || 15000;
  const attempts = src.mirrors ? endpoints.length * 2 : 2;
  let last = null;

  for (let i = 0; i < attempts; i++) {
    const target = endpoints[i % endpoints.length];
    if (i > 0) await sleep(Math.min(4000, 400 * 2 ** Math.floor(i / endpoints.length)));
    try {
      const out = await fetchOnce(target, init, timeout);
      if (out.ok || !RETRYABLE.has(out.status)) {
        if (ck && out.ok) LOOKUP_CACHE.set(ck, { at: Date.now(), value: out });
        return out;
      }
      last = Object.assign(new Error(`Upstream ${name}: HTTP ${out.status}`), { status: 502, code: out.status });
    } catch (err) {
      last = Object.assign(
        new Error(err.name === "AbortError"
          ? `Upstream ${name} timed out after ${timeout / 1000}s`
          : err.message),
        { status: 502 }
      );
    }
  }
  // The agent is told the server retries for it, so the error has to say what was
  // actually spent — otherwise a single "HTTP 429" reads like one unlucky call.
  if (last && attempts > 1) {
    last.message += ` (after ${attempts} attempts across ${endpoints.length} endpoint${endpoints.length > 1 ? "s" : ""})`;
  }
  throw last;
}


/* ------------------------------------------------------------------ *
 * Username enumeration (WhatsMyName)
 *
 * data/wmn-data.json gives, per site, a URL template and how to tell a hit
 * from a miss. This is what Sherlock/Maigret do; doing it server-side is the
 * only way it can work at all, since the browser can't read cross-origin
 * responses. Requests are capped and throttled — this fans out to hundreds of
 * third-party sites and shouldn't hammer them.
 * ------------------------------------------------------------------ */

let WMN = null;
function loadWmn() {
  if (WMN) return WMN;
  try {
    WMN = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "wmn-data.json"), "utf8"));
  } catch {
    WMN = { sites: [] };
  }
  return WMN;
}

const USERNAME_VALID = /^[A-Za-z0-9._-]{2,64}$/;

async function checkSite(site, username) {
  const url = site.uri_check.replace(/\{account\}/g, encodeURIComponent(username));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  try {
    const res = await fetch(url, {
      headers: {
        // Sites gate on a browser-shaped UA; without one many 403 and every
        // result becomes a false negative.
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8"
      },
      redirect: "follow",
      signal: controller.signal
    });

    // A hit needs the expected code AND, when specified, the expected string.
    if (res.status !== site.e_code) return null;
    if (site.e_string) {
      const body = await res.text();
      if (!body.includes(site.e_string)) return null;
      if (site.m_string && body.includes(site.m_string)) return null;
    }
    return { name: site.name, url, category: site.cat };
  } catch {
    return null; // timeout / DNS / TLS — indistinguishable from "no account"
  } finally {
    clearTimeout(timer);
  }
}

async function enumerateUsername(username, { categories, limit } = {}) {
  if (!USERNAME_VALID.test(username || "")) {
    throw Object.assign(new Error("Username must be 2-64 chars of A-Z a-z 0-9 . _ -"), { status: 400 });
  }
  const data = loadWmn();
  let sites = data.sites || [];

  // Sites behind CAPTCHA/Cloudflare answer with a challenge page, which reads
  // as "not found" — reporting that as a real negative would be misleading.
  sites = sites.filter(s => !(s.protection || []).some(p => /captcha|cloudflare/i.test(p)));
  if (categories?.length) {
    const want = new Set(categories.map(c => c.toLowerCase()));
    sites = sites.filter(s => want.has((s.cat || "").toLowerCase()));
  }
  // Skip adult sites unless explicitly requested.
  if (!categories?.length) sites = sites.filter(s => !/nsfw/i.test(s.cat || ""));

  const cap = Math.min(Number(limit) || 90, 250);
  const checked = sites.slice(0, cap);

  const found = [];
  const CONCURRENCY = 12;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, checked.length) }, async () => {
      while (cursor < checked.length) {
        const site = checked[cursor++];
        const hit = await checkSite(site, username);
        if (hit) found.push(hit);
      }
    })
  );

  return {
    username,
    checked: checked.length,
    available_sites: sites.length,
    found: found.sort((a, b) => a.name.localeCompare(b.name))
  };
}

/* ------------------------------------------------------------------ *
 * Image fetch.
 *
 * Finding a photo of a candidate location is only half of it — the model has to
 * be able to look at it, which means the bytes have to reach the browser and go
 * back up as an image block. Browsers can't read cross-origin image bytes, so
 * the fetch happens here.
 *
 * Strictly allowlisted by host: these are the image CDNs behind the photo
 * sources above and nothing else. Anything not on the list is refused, so this
 * cannot be used to reach an arbitrary URL.
 * ------------------------------------------------------------------ */

const UPSTREAM_UA = "AwareOSINT/1.0 (+https://github.com/tacticalfunds/Aware)";

const IMAGE_HOSTS = [
  /^upload\.wikimedia\.org$/,
  /^commons\.wikimedia\.org$/,
  /^api\.openverse\.org$/,
  /^([a-z0-9-]+\.)*mapillary\.com$/,
  /^scontent[a-z0-9.-]*\.fbcdn\.net$/,
  /^([a-z0-9-]+\.)*staticflickr\.com$/
];

const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

async function fetchImage(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl)); } catch { throw Object.assign(new Error("Not a URL"), { status: 400 }); }
  if (u.protocol !== "https:") throw Object.assign(new Error("HTTPS only"), { status: 400 });
  if (!IMAGE_HOSTS.some(re => re.test(u.hostname))) {
    throw Object.assign(new Error(`Host not allowed for image fetch: ${u.hostname}`), { status: 403 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(u.toString(), {
      headers: { "User-Agent": UPSTREAM_UA, Accept: "image/*" },
      redirect: "follow",
      signal: controller.signal
    });
    if (!res.ok) throw Object.assign(new Error(`Upstream ${res.status}`), { status: 502 });

    const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!IMAGE_TYPES.has(type)) {
      throw Object.assign(new Error(`Not a supported image type: ${type || "unknown"}`), { status: 415 });
    }
    const declared = Number(res.headers.get("content-length"));
    if (declared && declared > IMAGE_MAX_BYTES) {
      throw Object.assign(new Error(`Image too large: ${Math.round(declared / 1024)} KB`), { status: 413 });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    // Re-check after download: content-length is optional and can lie.
    if (buf.length > IMAGE_MAX_BYTES) {
      throw Object.assign(new Error(`Image too large: ${Math.round(buf.length / 1024)} KB`), { status: 413 });
    }
    return { media_type: type, bytes: buf.length, data: buf.toString("base64") };
  } catch (err) {
    if (err.status) throw err;
    throw Object.assign(
      new Error(err.name === "AbortError" ? "Image fetch timed out" : err.message),
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ *
 * Basemap tiles.
 *
 * The plan view draws on real aerial imagery, which a browser cannot fetch
 * cross-origin into an SVG without tainting it. Same reasoning as the lookup
 * proxy: the client asks for a layer name and z/x/y, never a URL.
 *
 * Both upstreams are free to use with attribution (rendered on the diagram).
 * Requests are cached in memory so redrawing a diagram, or two diagrams over
 * the same block, does not re-hit them — OpenStreetMap's tile usage policy
 * asks for exactly that, and for an identifying User-Agent.
 * ------------------------------------------------------------------ */

const BASEMAPS = {
  // Esri World Imagery. Note the y/x order — Esri puts row before column.
  satellite: {
    url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    maxZoom: 19
  },
  street: {
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    maxZoom: 19
  }
};

const TILE_CACHE = new Map();     // "layer/z/x/y" -> {type, body}
const TILE_CACHE_MAX = 400;       // ~10 MB of 256px JPEG/PNG

async function serveTile(res, parts) {
  const [layer, zs, xs, ys] = parts;
  const map = BASEMAPS[layer];
  const z = Number(zs), x = Number(xs), y = Number(String(ys).replace(/\.(png|jpg|jpeg)$/i, ""));

  if (!map) {
    res.writeHead(404, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: `Unknown basemap "${layer}"` }));
    return;
  }
  const n = 2 ** z;
  const valid = Number.isInteger(z) && z >= 0 && z <= map.maxZoom &&
    Number.isInteger(x) && x >= 0 && x < n &&
    Number.isInteger(y) && y >= 0 && y < n;
  if (!valid) {
    res.writeHead(400, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: "Tile coordinates out of range" }));
    return;
  }

  const key = `${layer}/${z}/${x}/${y}`;
  const hit = TILE_CACHE.get(key);
  if (hit) {
    res.writeHead(200, { "Content-Type": hit.type, "Cache-Control": "public, max-age=86400" });
    res.end(hit.body);
    return;
  }

  try {
    const upstream = await fetch(map.url(z, x, y), {
      headers: { "User-Agent": UPSTREAM_UA, Accept: "image/*" },
      signal: AbortSignal.timeout(12000)
    });
    if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
    const type = upstream.headers.get("content-type") || "image/png";
    if (!type.startsWith("image/")) throw new Error(`upstream returned ${type}`);
    const body = Buffer.from(await upstream.arrayBuffer());

    if (TILE_CACHE.size >= TILE_CACHE_MAX) TILE_CACHE.delete(TILE_CACHE.keys().next().value);
    TILE_CACHE.set(key, { type, body });

    res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=86400" });
    res.end(body);
  } catch (err) {
    // The client draws its abstract grid instead, so this is a degraded render,
    // not a broken one.
    res.writeHead(502, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: `Tile fetch failed: ${err.message}` }));
  }
}

/* ------------------------------------------------------------------ *
 * Static file serving
 * ------------------------------------------------------------------ */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8"
};

function serveStatic(req, res, pathname) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const filePath = path.join(ROOT, rel);

  // Keep traversal inside the project directory.
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== path.join(ROOT, "index.html")) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}

/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (pathname === "/api/sources") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      proxy: true,
      sources: availableSources(),
      basemaps: Object.keys(BASEMAPS),
      search: { available: true, keyed: !!process.env.BRAVE_KEY,
                engines: (process.env.BRAVE_KEY ? ["Brave"] : []).concat(SEARCH_ENGINES.map(e => e.name)) },
      username_sites: (loadWmn().sites || []).length
    }));
    return;
  }

  if (pathname === "/api/username") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "POST only" }));
      return;
    }
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 8192) req.destroy(); });
    req.on("end", async () => {
      try {
        const { username, categories, limit } = JSON.parse(raw || "{}");
        const out = await enumerateUsername(username, { categories, limit });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(out));
      } catch (err) {
        res.writeHead(err.status || 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === "/api/lookup") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "POST only" }));
      return;
    }
    let raw = "";
    req.on("data", c => {
      raw += c;
      if (raw.length > 64 * 1024) req.destroy(); // no reason for a big body here
    });
    req.on("end", async () => {
      try {
        const { source, params } = JSON.parse(raw || "{}");
        const result = await runLookup(source, params);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(err.status || 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === "/api/search") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "POST only" }));
      return;
    }
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 2048) req.destroy(); });
    req.on("end", async () => {
      try {
        const { query } = JSON.parse(raw || "{}");
        const out = await runSearch(query);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...out }));
      } catch (err) {
        res.writeHead(err.status || 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname === "/api/image") {
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "POST only" }));
      return;
    }
    let raw = "";
    req.on("data", c => { raw += c; if (raw.length > 4096) req.destroy(); });
    req.on("end", async () => {
      try {
        const { url } = JSON.parse(raw || "{}");
        const out = await fetchImage(url);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, ...out }));
      } catch (err) {
        res.writeHead(err.status || 500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  if (pathname.startsWith("/api/tile/")) {
    const parts = pathname.slice("/api/tile/".length).split("/");
    if (parts.length !== 4) {
      res.writeHead(400, { "Content-Type": "application/json" })
        .end(JSON.stringify({ error: "Expected /api/tile/{layer}/{z}/{x}/{y}" }));
      return;
    }
    await serveTile(res, parts);
    return;
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  const configured = Object.entries(availableSources()).filter(([, v]) => v).length;
  console.log(`Aware listening on :${PORT} — ${configured}/${Object.keys(SOURCES).length} proxy sources available`);
});

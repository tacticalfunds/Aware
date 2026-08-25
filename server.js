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
    build: () => `https://overpass-api.de/api/interpreter`,
    method: "POST",
    body: p => `data=${enc(p.query)}`,
    contentType: "application/x-www-form-urlencoded"
  },

  // --- credentialed; key comes from the server env, never the browser ---
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

/** Which proxied sources are usable right now — the client uses this to decide. */
function availableSources() {
  const out = {};
  for (const [name, src] of Object.entries(SOURCES)) {
    out[name] = !src.key || !!process.env[src.key];
  }
  return out;
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

  let url = src.build(params || {}, key);
  let headers = {
    // Nominatim and a few others reject requests without a real UA.
    "User-Agent": "Aware-OSINT/1.0 (+https://github.com/tacticalfunds/Aware)",
    Accept: "application/json"
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 20000) }; }
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    throw Object.assign(
      new Error(err.name === "AbortError" ? "Upstream timed out after 15s" : err.message),
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
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

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  const configured = Object.entries(availableSources()).filter(([, v]) => v).length;
  console.log(`Aware listening on :${PORT} — ${configured}/${Object.keys(SOURCES).length} proxy sources available`);
});

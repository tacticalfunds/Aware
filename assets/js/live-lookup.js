/**
 * Live Lookup — actually queries a handful of OSINT data sources that expose
 * genuine public JSON APIs reachable directly from a browser, instead of just
 * linking out. Results are rendered as distinct "⚡ live" cards in chat.
 *
 * Honesty matters more than coverage here: most of the 116 tools in the
 * directory are consumer websites with no public API (people search, reverse
 * phone lookup, social media, reverse image search...) — querying those
 * automatically would mean scraping, which breaks their terms of service and
 * isn't something this site does. Only sources with a real, documented API
 * are wired up:
 *
 *   No key required:
 *     - DNS records            (Google DNS-over-HTTPS)
 *     - IP geolocation / ASN   (ipinfo.io)
 *     - Certificate/subdomain  (crt.sh)
 *     - Bitcoin address        (blockchain.info)
 *     - urlscan.io scan history
 *     - Phone numbers          (offline: libphonenumber + NANP area-code table)
 *
 *   Optional key (added in AI settings, stored only in localStorage, same
 *   pattern as the Claude key):
 *     - Shodan host lookup
 *     - VirusTotal domain/IP reputation
 *     - AbuseIPDB IP abuse reports
 *     - Etherscan ETH address balance
 *     - Have I Been Pwned breach check
 */

const LIVE_PATTERNS = {
  ipv4: /\b((?:25[0-5]|2[0-4]\d|1?\d{1,2})(?:\.(?:25[0-5]|2[0-4]\d|1?\d{1,2})){3})\b/,
  btc: /\b(bc1[ac-hj-np-z02-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/,
  eth: /\b(0x[a-fA-F0-9]{40})\b/,
  email: /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/,
  domain: /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})\b/i,
  // Candidate only — a digit run is far too weak on its own, so every hit is
  // confirmed by libphonenumber before it counts as a phone target.
  phoneCandidate: /(\+?\d[\d\s().-]{7,18}\d)/g
};

/** Parses a phone number with libphonenumber; returns null if it isn't valid. */
function parsePhone(raw, defaultCountry) {
  const lib = self.libphonenumber;
  if (!lib) return null;
  try {
    // Bare national numbers need a region; assume US/NANP unless it's already +E.164.
    const p = raw.trim().startsWith("+")
      ? lib.parsePhoneNumberFromString(raw)
      : lib.parsePhoneNumberFromString(raw, defaultCountry || "US");
    return p && p.isValid() ? p : null;
  } catch {
    return null;
  }
}

function extractTargets(text) {
  const targets = [];
  const email = text.match(LIVE_PATTERNS.email);
  const ip = text.match(LIVE_PATTERNS.ipv4);
  const btc = text.match(LIVE_PATTERNS.btc);
  const eth = text.match(LIVE_PATTERNS.eth);

  if (email) targets.push({ type: "email", value: email[1] });
  if (ip) targets.push({ type: "ip", value: ip[1] });
  if (btc) targets.push({ type: "btc", value: btc[1] });
  if (eth) targets.push({ type: "eth", value: eth[1] });

  // Phone: test each digit run and keep the first that libphonenumber validates.
  // Skip if an IP/BTC/ETH already claimed those digits, so "8.8.8.8" or a wallet
  // address can't be misread as a number.
  const claimed = [ip?.[1], btc?.[1], eth?.[1]].filter(Boolean).join(" ");
  for (const m of text.matchAll(LIVE_PATTERNS.phoneCandidate)) {
    const raw = m[1];
    if (claimed.includes(raw.trim())) continue;
    const parsed = parsePhone(raw);
    if (parsed) { targets.push({ type: "phone", value: parsed.number, parsed }); break; }
  }

  // Only look for a bare domain if we didn't already find one inside the email address.
  const domainMatch = text.match(LIVE_PATTERNS.domain);
  if (domainMatch) {
    const candidate = domainMatch[1].toLowerCase();
    const isEmailDomain = email && email[1].toLowerCase().endsWith("@" + candidate);
    const isIp = LIVE_PATTERNS.ipv4.test(candidate);
    if (!isEmailDomain && !isIp) targets.push({ type: "domain", value: candidate });
  }

  return targets.slice(0, 2); // cap fan-out per message
}

async function fetchJson(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ---------- No-key sources ---------- */

async function lookupDNS(domain) {
  const types = ["A", "AAAA", "MX", "TXT"];
  const results = await Promise.all(
    types.map(t =>
      fetchJson(`https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${t}`).catch(() => null)
    )
  );
  const lines = [];
  types.forEach((t, i) => {
    const answers = results[i]?.Answer || [];
    if (answers.length) lines.push(`${t}: ${answers.map(a => a.data).slice(0, 5).join(", ")}`);
  });
  if (lines.length === 0) return { ok: true, empty: true, summary: "No DNS records found." };
  return { ok: true, summary: lines.join("\n") };
}

async function lookupCrtSh(domain) {
  const data = await fetchJson(`https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`);
  const names = new Set();
  for (const row of data) {
    String(row.name_value || "").split("\n").forEach(n => names.add(n.trim().toLowerCase()));
  }
  names.delete(domain);
  const list = [...names].filter(n => n.endsWith(domain)).slice(0, 15);
  if (list.length === 0) return { ok: true, empty: true, summary: "No subdomains found in certificate logs." };
  return { ok: true, summary: `${list.length} subdomain(s) seen in certificate logs:\n${list.join(", ")}` };
}

async function lookupIP(ip) {
  const data = await fetchJson(`https://ipinfo.io/${encodeURIComponent(ip)}/json`);
  const lines = [
    data.org && `Org/ASN: ${data.org}`,
    (data.city || data.region || data.country) && `Location: ${[data.city, data.region, data.country].filter(Boolean).join(", ")}`,
    data.hostname && `Hostname: ${data.hostname}`,
    data.loc && `Coordinates: ${data.loc}`
  ].filter(Boolean);
  return { ok: true, summary: lines.join("\n") || "No details returned." };
}

async function lookupBTC(address) {
  const data = await fetchJson(`https://blockchain.info/rawaddr/${encodeURIComponent(address)}?cors=true`);
  const btc = sats => (sats / 1e8).toFixed(8);
  const lines = [
    `Balance: ${btc(data.final_balance)} BTC`,
    `Total received: ${btc(data.total_received)} BTC`,
    `Total sent: ${btc(data.total_sent)} BTC`,
    `Transactions: ${data.n_tx}`
  ];
  return { ok: true, summary: lines.join("\n") };
}

async function lookupUrlscan(domain) {
  const data = await fetchJson(`https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(domain)}`);
  const total = data.total || 0;
  if (total === 0) return { ok: true, empty: true, summary: "No prior scans found on urlscan.io." };
  const recent = (data.results || []).slice(0, 3).map(r => `${r.page?.url || r.task?.url} (${(r.task?.time || "").slice(0, 10)})`);
  return { ok: true, summary: `${total} scan(s) on record. Most recent:\n${recent.join("\n")}` };
}

const PHONE_TYPE_LABELS = {
  MOBILE: "mobile",
  FIXED_LINE: "landline",
  FIXED_LINE_OR_MOBILE: "landline or mobile (not distinguishable from the numbering plan)",
  TOLL_FREE: "toll-free",
  PREMIUM_RATE: "premium rate",
  SHARED_COST: "shared cost",
  VOIP: "VoIP",
  PERSONAL_NUMBER: "personal number",
  PAGER: "pager",
  UAN: "universal access number",
  VOICEMAIL: "voicemail"
};

/**
 * Everything derivable from the number itself, with no network call: validity,
 * country, line type from the numbering plan, and — for NANP numbers — the
 * geographic area the code was assigned to.
 */
function lookupPhoneOffline(raw) {
  const p = typeof raw === "object" && raw?.isValid ? raw : parsePhone(String(raw));
  if (!p) {
    return { ok: true, empty: true, summary: "Not a valid phone number in any known numbering plan." };
  }

  const lines = [
    `E.164: ${p.number}`,
    `National format: ${p.formatNational()}`,
    `Country: ${p.country || "unknown"} (+${p.countryCallingCode})`
  ];

  const type = p.getType();
  lines.push(`Line type: ${type ? PHONE_TYPE_LABELS[type] || type.toLowerCase() : "not specified by the numbering plan"}`);

  if ((p.country === "US" || p.country === "CA") && typeof NANP_AREA_CODES !== "undefined") {
    const areaCode = p.nationalNumber.slice(0, 3);
    const entry = NANP_AREA_CODES[areaCode];
    if (entry) {
      const [region, country, cities] = entry;
      lines.push(`Area code ${areaCode}: ${region}, ${country}`);
      if (cities) lines.push(`Cities in that area code: ${cities.split("|").join(", ")}`);
    }
  }

  lines.push("Note: this is numbering-plan data only. Numbers port between carriers, so it does not establish the current carrier or the subscriber.");
  return { ok: true, summary: lines.join("\n") };
}

/* ---------- Optional-key sources ---------- */

async function lookupVeriphone(e164, key) {
  const data = await fetchJson(
    `https://api.veriphone.io/v2/verify?phone=${encodeURIComponent(e164)}&key=${encodeURIComponent(key)}`
  );
  if (data.status !== "success") throw new Error(data.message || "Veriphone error");
  const lines = [
    `Valid: ${data.phone_valid}`,
    data.phone_type && `Type: ${data.phone_type}`,
    data.carrier && `Carrier: ${data.carrier}`,
    data.phone_region && `Region: ${data.phone_region}`,
    data.country && `Country: ${data.country}`
  ].filter(Boolean);
  return { ok: true, summary: lines.join("\n") };
}

async function lookupAbstractPhone(e164, key) {
  const data = await fetchJson(
    `https://phonevalidation.abstractapi.com/v1/?api_key=${encodeURIComponent(key)}&phone=${encodeURIComponent(e164)}`
  );
  const lines = [
    `Valid: ${data.valid}`,
    data.type && `Type: ${data.type}`,
    data.carrier && `Carrier: ${data.carrier}`,
    data.location && `Location: ${data.location}`,
    data.country?.name && `Country: ${data.country.name}`
  ].filter(Boolean);
  return { ok: true, summary: lines.join("\n") };
}

async function lookupIPQSPhone(e164, key) {
  const data = await fetchJson(
    `https://ipqualityscore.com/api/json/phone/${encodeURIComponent(key)}/${encodeURIComponent(e164)}`
  );
  if (data.success === false) throw new Error(data.message || "IPQualityScore error");
  const lines = [
    `Fraud score: ${data.fraud_score}/100`,
    data.recent_abuse !== undefined && `Recent abuse reported: ${data.recent_abuse}`,
    data.risky !== undefined && `Risky: ${data.risky}`,
    data.carrier && `Carrier: ${data.carrier}`,
    data.line_type && `Line type: ${data.line_type}`,
    data.city && `Location: ${[data.city, data.region, data.country].filter(Boolean).join(", ")}`,
    data.active !== undefined && `Active: ${data.active}`
  ].filter(Boolean);
  return { ok: true, summary: lines.join("\n") };
}

async function lookupShodan(ip, key) {
  const data = await fetchJson(`https://api.shodan.io/shodan/host/${encodeURIComponent(ip)}?key=${encodeURIComponent(key)}`);
  const ports = (data.ports || []).slice(0, 12).join(", ");
  const lines = [
    data.org && `Org: ${data.org}`,
    data.os && `OS: ${data.os}`,
    ports && `Open ports: ${ports}`,
    data.vulns?.length && `⚠ Known vulns: ${data.vulns.slice(0, 5).join(", ")}`
  ].filter(Boolean);
  return { ok: true, summary: lines.join("\n") || "No details returned." };
}

async function lookupVirusTotal(target, type, key) {
  const path = type === "ip" ? "ip_addresses" : "domains";
  const data = await fetchJson(`https://www.virustotal.com/api/v3/${path}/${encodeURIComponent(target)}`, {
    headers: { "x-apikey": key }
  });
  const stats = data?.data?.attributes?.last_analysis_stats;
  if (!stats) return { ok: true, empty: true, summary: "No analysis data returned." };
  return {
    ok: true,
    summary: `Malicious: ${stats.malicious} · Suspicious: ${stats.suspicious} · Harmless: ${stats.harmless} · Undetected: ${stats.undetected}`
  };
}

async function lookupAbuseIPDB(ip, key) {
  const data = await fetchJson(`https://api.abuseipdb.com/api/v2/check?ipAddress=${encodeURIComponent(ip)}&maxAgeInDays=90`, {
    headers: { Key: key, Accept: "application/json" }
  });
  const d = data.data;
  if (!d) return { ok: true, empty: true, summary: "No data returned." };
  const lines = [
    `Abuse confidence: ${d.abuseConfidenceScore}%`,
    `Reports: ${d.totalReports}`,
    d.isp && `ISP: ${d.isp}`,
    d.countryCode && `Country: ${d.countryCode}`
  ].filter(Boolean);
  return { ok: true, summary: lines.join("\n") };
}

async function lookupEtherscan(address, key) {
  const data = await fetchJson(
    `https://api.etherscan.io/api?module=account&action=balance&address=${encodeURIComponent(address)}&tag=latest&apikey=${encodeURIComponent(key)}`
  );
  if (data.status !== "1") throw new Error(data.message || "Etherscan error");
  const eth = (Number(data.result) / 1e18).toFixed(6);
  return { ok: true, summary: `Balance: ${eth} ETH` };
}

async function lookupHIBP(email, key) {
  const res = await fetch(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}?truncateResponse=false`, {
    headers: { "hibp-api-key": key }
  });
  if (res.status === 404) return { ok: true, empty: true, summary: "No breaches found for this address." };
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const breaches = await res.json();
  const list = breaches.slice(0, 8).map(b => `${b.Title || b.Name} (${(b.BreachDate || "").slice(0, 4)})`);
  return { ok: true, summary: `Found in ${breaches.length} breach(es):\n${list.join(", ")}` };
}

/* ---------- Dispatcher ---------- */

// Each entry: { source, needsKey, keyField, run(target, key) }
const LIVE_SOURCES = {
  domain: [
    { source: "DNS records (Google)", run: t => lookupDNS(t.value) },
    { source: "crt.sh certificates", run: t => lookupCrtSh(t.value) },
    { source: "urlscan.io", run: t => lookupUrlscan(t.value) },
    { source: "VirusTotal", needsKey: "virustotal", run: (t, key) => lookupVirusTotal(t.value, "domain", key) }
  ],
  ip: [
    { source: "ipinfo.io", run: t => lookupIP(t.value) },
    { source: "Shodan", needsKey: "shodan", run: (t, key) => lookupShodan(t.value, key) },
    { source: "AbuseIPDB", needsKey: "abuseipdb", run: (t, key) => lookupAbuseIPDB(t.value, key) },
    { source: "VirusTotal", needsKey: "virustotal", run: (t, key) => lookupVirusTotal(t.value, "ip", key) }
  ],
  phone: [
    { source: "Numbering plan (offline)", run: t => lookupPhoneOffline(t.parsed || t.value) },
    { source: "Veriphone", needsKey: "veriphone", run: (t, key) => lookupVeriphone(t.value, key) },
    { source: "AbstractAPI", needsKey: "abstractphone", run: (t, key) => lookupAbstractPhone(t.value, key) },
    { source: "IPQualityScore", needsKey: "ipqs", run: (t, key) => lookupIPQSPhone(t.value, key) }
  ],
  btc: [{ source: "blockchain.info", run: t => lookupBTC(t.value) }],
  eth: [{ source: "Etherscan", needsKey: "etherscan", run: (t, key) => lookupEtherscan(t.value, key) }],
  email: [{ source: "Have I Been Pwned", needsKey: "hibp", run: (t, key) => lookupHIBP(t.value, key) }]
};

/**
 * Runs every applicable live source for the detected targets in `text`.
 * `keys` is an object like { shodan, virustotal, abuseipdb, etherscan, hibp }.
 * Returns an array of { target, source, status: 'ok'|'empty'|'error'|'skipped', summary }.
 */
async function runLiveLookups(text, keys = {}) {
  const targets = extractTargets(text);
  if (targets.length === 0) return [];

  const jobs = [];
  for (const target of targets) {
    for (const src of LIVE_SOURCES[target.type] || []) {
      if (src.needsKey && !keys[src.needsKey]) {
        jobs.push(Promise.resolve({ target, source: src.source, status: "skipped" }));
        continue;
      }
      jobs.push(
        // Promise.resolve so a source can be synchronous — the offline phone
        // lookup returns a plain object, and calling .then() on it would throw.
        Promise.resolve()
          .then(() => src.run(target, src.needsKey ? keys[src.needsKey] : undefined))
          .then(r => ({
            target,
            source: src.source,
            status: r.empty ? "empty" : "ok",
            summary: r.summary
          }))
          .catch(err => ({
            target,
            source: src.source,
            status: "error",
            error: err.message || String(err)
          }))
      );
    }
  }
  return Promise.all(jobs);
}

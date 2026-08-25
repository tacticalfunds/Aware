/**
 * Autonomous investigation agent.
 *
 * You give it a task (text, optionally with an image) and it runs its own
 * loop: decides which lookups to run, executes them, reads the results,
 * decides what to do next, and writes up what it found.
 *
 * Requires the user's own Anthropic API key — the local keyword matcher can't
 * reason about a task or chain steps. Without a key the UI explains this rather
 * than pretending to investigate.
 *
 * Tool surface: the live-lookup functions (real HTTP calls to APIs reachable
 * from a browser) plus a search over the local tool directory, so the agent can
 * hand back specific manual tools for the many sources that have no API.
 */

/*
 * A geolocation that verifies its own candidates costs steps: find anchors, pull
 * photos of each, compare, discard, try the next. Twelve was not enough to get
 * past the first candidate — a run could spend the whole budget on upstream
 * retries and never reach a conclusion.
 */
const AGENT_MAX_STEPS = 26;
const AGENT_MAX_HISTORY = 40;

/**
 * Caps conversation growth without corrupting it. A tool_use block must always keep
 * the tool_result that answers it, so this only ever cuts at a plain user turn —
 * never between a tool call and its result, and never leaving a leading tool_result.
 */
function trimAgentHistory(messages) {
  while (messages.length > AGENT_MAX_HISTORY) {
    const cut = messages.findIndex(
      (m, i) =>
        i > 0 &&
        m.role === "user" &&
        (typeof m.content === "string" ||
          !m.content.some(b => b.type === "tool_result"))
    );
    if (cut <= 0) break; // nothing safe to drop
    messages.splice(0, cut);
  }
}

/* ---------- tool definitions handed to the model ---------- */

// Grouped tool modules live in assets/js/tools/ and register themselves through
// a {GROUP}_TOOLS / {GROUP}_EXECUTORS pair. Geolocation is the first such group.
const TOOL_GROUPS = [
  { tools: typeof GEO_TOOLS !== "undefined" ? GEO_TOOLS : [],
    executors: typeof GEO_EXECUTORS !== "undefined" ? GEO_EXECUTORS : {} },
  { tools: typeof IMAGE_TOOLS !== "undefined" ? IMAGE_TOOLS : [],
    executors: typeof IMAGE_EXECUTORS !== "undefined" ? IMAGE_EXECUTORS : {} },
  { tools: typeof METADATA_TOOLS !== "undefined" ? METADATA_TOOLS : [],
    executors: typeof METADATA_EXECUTORS !== "undefined" ? METADATA_EXECUTORS : {} },
  { tools: typeof VISUAL_TOOLS !== "undefined" ? VISUAL_TOOLS : [],
    executors: typeof VISUAL_EXECUTORS !== "undefined" ? VISUAL_EXECUTORS : {} },
  { tools: typeof PHOTO_TOOLS !== "undefined" ? PHOTO_TOOLS : [],
    executors: typeof PHOTO_EXECUTORS !== "undefined" ? PHOTO_EXECUTORS : {} }
];

const GROUPED_EXECUTORS = Object.assign({}, ...TOOL_GROUPS.map(g => g.executors));

const AGENT_TOOLS = [
  ...TOOL_GROUPS.flatMap(g => g.tools),
  {
    name: "dns_lookup",
    description: "Look up live DNS records (A, AAAA, MX, TXT) for a domain. Use to confirm a domain resolves, find its mail provider, or read SPF/verification TXT records.",
    input_schema: {
      type: "object",
      properties: { domain: { type: "string", description: "Bare domain, e.g. example.com" } },
      required: ["domain"]
    }
  },
  {
    name: "cert_subdomains",
    description: "Search Certificate Transparency logs (crt.sh) for subdomains of a domain. Good for mapping an organisation's public attack surface.",
    input_schema: {
      type: "object",
      properties: { domain: { type: "string" } },
      required: ["domain"]
    }
  },
  {
    name: "ip_info",
    description: "Geolocation, ASN, hosting org and reverse hostname for an IPv4 address (ipinfo.io).",
    input_schema: {
      type: "object",
      properties: { ip: { type: "string" } },
      required: ["ip"]
    }
  },
  {
    name: "urlscan_history",
    description: "Look up prior urlscan.io scans of a domain — shows whether a site has been submitted before and what it served.",
    input_schema: {
      type: "object",
      properties: { domain: { type: "string" } },
      required: ["domain"]
    }
  },
  {
    name: "btc_address",
    description: "Balance and transaction history for a Bitcoin address (blockchain.info).",
    input_schema: {
      type: "object",
      properties: { address: { type: "string" } },
      required: ["address"]
    }
  },
  {
    name: "shodan_host",
    description: "Open ports, running services and known CVEs for an IP (Shodan). Requires the user's Shodan key; returns an error if absent.",
    input_schema: {
      type: "object",
      properties: { ip: { type: "string" } },
      required: ["ip"]
    }
  },
  {
    name: "virustotal_report",
    description: "Reputation and AV detection counts for a domain or IP (VirusTotal). Requires the user's VirusTotal key.",
    input_schema: {
      type: "object",
      properties: {
        target: { type: "string" },
        kind: { type: "string", enum: ["domain", "ip"] }
      },
      required: ["target", "kind"]
    }
  },
  {
    name: "abuseipdb_check",
    description: "Abuse reports and confidence score for an IP (AbuseIPDB). Requires the user's AbuseIPDB key.",
    input_schema: {
      type: "object",
      properties: { ip: { type: "string" } },
      required: ["ip"]
    }
  },
  {
    name: "eth_balance",
    description: "Ether balance for an Ethereum address (Etherscan). Requires the user's Etherscan key.",
    input_schema: {
      type: "object",
      properties: { address: { type: "string" } },
      required: ["address"]
    }
  },
  {
    name: "email_breaches",
    description: "Known data breaches containing an email address (Have I Been Pwned). Requires the user's HIBP key. Note HIBP usually blocks direct browser calls, so this often fails even with a valid key.",
    input_schema: {
      type: "object",
      properties: { email: { type: "string" } },
      required: ["email"]
    }
  },
  {
    name: "phone_lookup",
    description: "Analyse a phone number. Always returns offline numbering-plan facts (validity, country, line type, and for US/Canada numbers the geographic area the code was assigned to). If the user has configured a Veriphone, AbstractAPI or IPQualityScore key, also returns live carrier, location and fraud/spam-risk data. Use this whenever a phone number appears in the task.",
    input_schema: {
      type: "object",
      properties: {
        number: { type: "string", description: "The number, ideally in E.164 (+19144262906). A bare 10-digit number is assumed to be US/NANP." }
      },
      required: ["number"]
    }
  },
  {
    name: "domain_registration",
    description: "Registration data for a domain via RDAP (the machine-readable successor to WHOIS): registrar, creation/expiry dates, status flags and contacts where published. Use to establish how old a domain is and who registered it — a domain registered days ago is a strong phishing/scam signal.",
    input_schema: {
      type: "object",
      properties: { domain: { type: "string" } },
      required: ["domain"]
    }
  },
  {
    name: "wayback_history",
    description: "What the Wayback Machine holds for a URL — how far back snapshots go and how many there are. Use to see what a site looked like before it changed, or to date when it first appeared.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "Domain or full URL" } },
      required: ["url"]
    }
  },
  {
    name: "github_lookup",
    description: "GitHub account intelligence: profile (name, bio, company, location, email if public, join date) and recent repositories, or a user search by name/handle. A very productive pivot for a username or developer.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string", description: "Exact account to profile" },
        search: { type: "string", description: "Search users instead, by name or partial handle" }
      }
    }
  },
  {
    name: "reddit_lookup",
    description: "Reddit account age and karma for a username, or a site-wide search for a term. Useful for username pivots and for finding mentions of a phone number, domain or scam.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string" },
        search: { type: "string" }
      }
    }
  },
  {
    name: "web_mentions",
    description: "Searches Hacker News (via Algolia) and Wikipedia only — NOT the web at large. Good for tech discussion and encyclopedic reference; useless for local businesses, street names or anything regional. For those use web_search instead, and do not read an empty result here as 'nothing exists'.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    }
  },
  {
    name: "vin_decode",
    description: "Decodes a 17-character VIN via the free official NHTSA database: make, model, year, plant, body type, engine. Works for vehicles sold in the US.",
    input_schema: {
      type: "object",
      properties: { vin: { type: "string" } },
      required: ["vin"]
    }
  },
  {
    name: "username_enumeration",
    description:
      "Checks whether a username exists across hundreds of sites (the WhatsMyName dataset — the same technique as Sherlock/Maigret), running server-side. " +
      "This is usually the highest-yield pivot from a handle: each hit is another profile to read. " +
      "Optionally narrow by category (social, coding, gaming, finance, dating, blog, tech, video, music, art, shopping, news, business, political, hobby, images, health, archived, misc).",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string" },
        categories: { type: "array", items: { type: "string" }, description: "Optional category filter." },
        limit: { type: "integer", description: "How many sites to check (default 90, max 250)." }
      },
      required: ["username"]
    }
  },
  {
    name: "network_ownership",
    description:
      "Who an IP address actually belongs to: the registered netblock owner (RDAP), plus ASN, prefix and the hosting/transit provider (BGPView). " +
      "Goes beyond ip_info's geolocation — use it to establish whether a host sits on a corporate network, a hosting provider or a residential ISP.",
    input_schema: {
      type: "object",
      properties: {
        ip: { type: "string" },
        asn: { type: "string", description: "Look up an AS number directly instead, e.g. AS15169." }
      }
    }
  },
  {
    name: "malware_url_check",
    description: "Checks a hostname against abuse.ch URLhaus for known malware-distribution or phishing URLs. Free, no key. Use on any domain that looks suspicious.",
    input_schema: {
      type: "object",
      properties: { host: { type: "string", description: "Hostname, no scheme." } },
      required: ["host"]
    }
  },
  {
    name: "bluesky_lookup",
    description: "Public Bluesky profile for a handle (display name, bio, follower/post counts, join-adjacent data). Free, no auth.",
    input_schema: {
      type: "object",
      properties: { handle: { type: "string", description: "e.g. alice.bsky.social" } },
      required: ["handle"]
    }
  },
  {
    name: "request_manual_lookup",
    description:
      "Hand a lookup to the user for a tool you cannot call yourself — which is most of the 3,400-tool directory (sites with no API, or that need a login, or block automated access). " +
      "Build the exact prefilled URL so they only have to click it, tell them precisely what to copy back, and the conversation pauses until they paste it. " +
      "Their pasted text comes back to you as this tool's result, so continue the analysis from it. " +
      "Use this instead of ending your turn with a list of links — a link the user has to figure out how to use is not a completed step. " +
      "Prefer your own callable tools first; this is for what they cannot cover.",
    input_schema: {
      type: "object",
      properties: {
        tool_name: { type: "string", description: "Name of the tool, ideally exactly as it appears in the directory." },
        url: { type: "string", description: "Exact URL, with the query prefilled wherever the site supports it (e.g. https://www.bing.com/search?q=%22914-426-2906%22)." },
        what_to_copy: { type: "string", description: "Precisely what to copy back — which field, section or table. Be specific." },
        why: { type: "string", description: "One line on what this establishes for the investigation." }
      },
      required: ["tool_name", "url", "what_to_copy"]
    }
  },
  {
    name: "search_tool_directory",
    description: "Search this site's directory of 3,400+ OSINT tools by keyword. Use this for anything you cannot query directly — reverse image search, people search, geolocation references, plate/VIN databases, social media — and cite the specific tools back to the user so they can run them by hand.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords, e.g. 'reverse image search' or 'satellite imagery'" },
        limit: { type: "integer", description: "Max results (default 8)" }
      },
      required: ["query"]
    }
  }
];

/* ---------- executing a tool call ---------- */

async function executeAgentTool(name, input, liveKeys, ctx = {}) {
  // Tools contributed by a group module (assets/js/tools/*) handle themselves.
  if (GROUPED_EXECUTORS[name]) return GROUPED_EXECUTORS[name](input, ctx);

  const needKey = k => {
    if (!liveKeys[k]) throw new Error(`No ${k} API key configured — the user can add one in AI settings.`);
    return liveKeys[k];
  };

  switch (name) {
    case "dns_lookup":       return (await lookupDNS(input.domain)).summary;
    case "cert_subdomains":  return (await lookupCrtSh(input.domain)).summary;
    case "ip_info":          return (await lookupIP(input.ip)).summary;
    case "urlscan_history":  return (await lookupUrlscan(input.domain)).summary;
    case "btc_address":      return (await lookupBTC(input.address)).summary;
    case "shodan_host":      return (await lookupShodan(input.ip, needKey("shodan"))).summary;
    case "virustotal_report":return (await lookupVirusTotal(input.target, input.kind, needKey("virustotal"))).summary;
    case "abuseipdb_check":  return (await lookupAbuseIPDB(input.ip, needKey("abuseipdb"))).summary;
    case "eth_balance":      return (await lookupEtherscan(input.address, needKey("etherscan"))).summary;
    case "email_breaches":   return (await lookupHIBP(input.email, needKey("hibp"))).summary;
    case "phone_lookup": {
      // Offline analysis always runs; keyed enrichment is best-effort on top of it.
      const parts = [(await lookupPhoneOffline(input.number)).summary];
      const enrich = [
        ["veriphone", "Veriphone", k => lookupVeriphone(input.number, k)],
        ["abstractphone", "AbstractAPI", k => lookupAbstractPhone(input.number, k)],
        ["ipqs", "IPQualityScore", k => lookupIPQSPhone(input.number, k)]
      ];
      for (const [keyName, label, fn] of enrich) {
        if (!liveKeys[keyName]) continue;
        try {
          parts.push(`${label}: ${(await fn(liveKeys[keyName])).summary}`);
        } catch (err) {
          parts.push(`${label}: lookup failed (${err.message})`);
        }
      }
      if (!enrich.some(([k]) => liveKeys[k])) {
        parts.push("No phone-API key configured, so carrier/spam data was not retrieved — recommend manual tools for that.");
      }
      return parts.join("\n\n");
    }
    case "domain_registration": {
      const d = await Proxy.lookup("rdap_domain", { domain: input.domain });
      const ev = Object.fromEntries((d.events || []).map(e => [e.eventAction, (e.eventDate || "").slice(0, 10)]));
      const registrar = (d.entities || []).find(e => (e.roles || []).includes("registrar"));
      const regName = registrar?.vcardArray?.[1]?.find(f => f[0] === "fn")?.[3];
      return [
        `Domain: ${d.ldhName || input.domain}`,
        regName && `Registrar: ${regName}`,
        ev.registration && `Registered: ${ev.registration}`,
        ev.expiration && `Expires: ${ev.expiration}`,
        ev["last changed"] && `Last changed: ${ev["last changed"]}`,
        (d.status || []).length && `Status: ${d.status.join(", ")}`,
        (d.nameservers || []).length && `Nameservers: ${d.nameservers.map(n => n.ldhName).join(", ")}`
      ].filter(Boolean).join("\n");
    }
    case "wayback_history": {
      const rows = await Proxy.lookup("wayback_cdx", { url: input.url, limit: 25 });
      if (!Array.isArray(rows) || rows.length < 2) return "No Wayback Machine snapshots found.";
      const data = rows.slice(1); // first row is the column header
      const stamp = s => `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
      const first = data[0][1], last = data[data.length - 1][1];
      return `${data.length} snapshot(s) sampled. Earliest: ${stamp(first)}. Most recent: ${stamp(last)}.\n` +
        `Browse: https://web.archive.org/web/*/${input.url}`;
    }
    case "github_lookup": {
      if (input.search) {
        const r = await Proxy.lookup("github_search_users", { q: input.search });
        if (!r.items?.length) return "No GitHub users matched.";
        return r.items.map(u => `${u.login} — https://github.com/${u.login}`).join("\n");
      }
      const u = await Proxy.lookup("github_user", { username: input.username });
      const repos = await Proxy.lookup("github_user_repos", { username: input.username }).catch(() => []);
      return [
        `Account: ${u.login}${u.name ? ` (${u.name})` : ""}`,
        u.bio && `Bio: ${u.bio}`,
        u.company && `Company: ${u.company}`,
        u.location && `Location: ${u.location}`,
        u.email && `Public email: ${u.email}`,
        u.blog && `Link: ${u.blog}`,
        `Joined: ${(u.created_at || "").slice(0, 10)} · ${u.public_repos} repos · ${u.followers} followers`,
        Array.isArray(repos) && repos.length &&
          `Recent repos: ${repos.slice(0, 8).map(r => r.name).join(", ")}`
      ].filter(Boolean).join("\n");
    }
    case "reddit_lookup": {
      if (input.search) {
        const r = await Proxy.lookup("reddit_search", { q: input.search });
        const posts = r?.data?.children || [];
        if (!posts.length) return "No Reddit posts matched.";
        return posts.slice(0, 8).map(c =>
          `r/${c.data.subreddit}: ${c.data.title} — https://reddit.com${c.data.permalink}`).join("\n");
      }
      const r = await Proxy.lookup("reddit_user", { username: input.username });
      const d = r?.data;
      if (!d) return "No such Reddit account.";
      return [
        `u/${d.name}`,
        `Created: ${new Date(d.created_utc * 1000).toISOString().slice(0, 10)}`,
        `Karma: ${d.link_karma} post / ${d.comment_karma} comment`,
        d.is_employee && "Reddit employee account"
      ].filter(Boolean).join("\n");
    }
    case "web_mentions": {
      const [hn, wiki] = await Promise.all([
        Proxy.lookup("hackernews", { q: input.query }).catch(() => null),
        Proxy.lookup("wikipedia", { q: input.query }).catch(() => null)
      ]);
      const parts = [];
      const hits = hn?.hits?.filter(h => h.title) || [];
      if (hits.length) {
        parts.push("Hacker News:\n" + hits.slice(0, 5).map(h =>
          `- ${h.title} (${(h.created_at || "").slice(0, 10)}) https://news.ycombinator.com/item?id=${h.objectID}`).join("\n"));
      }
      const w = wiki?.query?.search || [];
      if (w.length) {
        parts.push("Wikipedia:\n" + w.slice(0, 5).map(a =>
          `- ${a.title} — https://en.wikipedia.org/wiki/${encodeURIComponent(a.title.replace(/ /g, "_"))}`).join("\n"));
      }
      return parts.length ? parts.join("\n\n") : "No mentions found on Hacker News or Wikipedia.";
    }
    case "vin_decode": {
      const r = await Proxy.lookup("nhtsa_vin", { vin: input.vin });
      const v = r?.Results?.[0];
      if (!v) return "No VIN data returned.";
      const f = [
        v.ErrorText && !/^0/.test(v.ErrorCode) && `Note: ${v.ErrorText}`,
        v.Make && `Make: ${v.Make}`,
        v.Model && `Model: ${v.Model}`,
        v.ModelYear && `Year: ${v.ModelYear}`,
        v.BodyClass && `Body: ${v.BodyClass}`,
        v.EngineCylinders && `Engine: ${v.EngineCylinders} cyl${v.DisplacementL ? ` ${v.DisplacementL}L` : ""}`,
        v.FuelTypePrimary && `Fuel: ${v.FuelTypePrimary}`,
        v.PlantCity && `Assembly plant: ${[v.PlantCity, v.PlantState, v.PlantCountry].filter(Boolean).join(", ")}`,
        v.Manufacturer && `Manufacturer: ${v.Manufacturer}`
      ].filter(Boolean);
      return f.length ? f.join("\n") : "VIN decoded but no fields populated — check the VIN is 17 characters.";
    }
    case "username_enumeration": {
      const res = await fetch("/api/username", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: input.username, categories: input.categories, limit: input.limit })
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Enumeration failed (${res.status})`);
      if (!d.found.length) {
        return `Checked ${d.checked} sites for "${d.username}" — no accounts found. Note this is not proof of absence: sites behind CAPTCHA/Cloudflare are skipped, and timeouts read as misses.`;
      }
      return `Found "${d.username}" on ${d.found.length} of ${d.checked} sites checked:\n` +
        d.found.map(f => `- ${f.name} (${f.category}): ${f.url}`).join("\n") +
        `\n\nEach is a profile worth reading. Sites behind CAPTCHA/Cloudflare were skipped, so this is a floor, not a ceiling.`;
    }
    case "network_ownership": {
      if (input.asn) {
        const a = await Proxy.lookup("bgpview_asn", { asn: input.asn });
        const d = a?.data;
        if (!d) return "No ASN data returned.";
        return [
          `AS${d.asn} — ${d.name || ""} ${d.description_short ? `(${d.description_short})` : ""}`,
          d.country_code && `Country: ${d.country_code}`,
          d.website && `Website: ${d.website}`,
          d.email_contacts?.length && `Contacts: ${d.email_contacts.join(", ")}`
        ].filter(Boolean).join("\n");
      }
      const [rdap, bgp] = await Promise.all([
        Proxy.lookup("rdap_ip", { ip: input.ip }).catch(() => null),
        Proxy.lookup("bgpview_ip", { ip: input.ip }).catch(() => null)
      ]);
      const out = [];
      if (rdap) {
        const org = (rdap.entities || []).map(e => e.vcardArray?.[1]?.find(f => f[0] === "fn")?.[3]).filter(Boolean);
        out.push([
          `Netblock: ${rdap.startAddress}–${rdap.endAddress}${rdap.name ? ` (${rdap.name})` : ""}`,
          org.length && `Registered to: ${org.join(", ")}`,
          rdap.country && `Country: ${rdap.country}`,
          (rdap.status || []).length && `Status: ${rdap.status.join(", ")}`
        ].filter(Boolean).join("\n"));
      }
      const b = bgp?.data;
      if (b) {
        const pfx = b.prefixes?.[0];
        out.push([
          pfx?.asn && `ASN: AS${pfx.asn.asn} — ${pfx.asn.name || ""} ${pfx.asn.description || ""}`.trim(),
          pfx?.prefix && `Announced prefix: ${pfx.prefix}`,
          b.ptr_record && `Reverse DNS: ${b.ptr_record}`,
          pfx?.country_code && `Prefix country: ${pfx.country_code}`
        ].filter(Boolean).join("\n"));
      }
      return out.filter(Boolean).join("\n\n") || "No ownership data returned.";
    }
    case "malware_url_check": {
      const d = await Proxy.lookup("urlhaus", { host: input.host });
      if (d.query_status === "no_results") return `${input.host}: no entries in URLhaus. Not evidence of safety — only that abuse.ch hasn't recorded it.`;
      if (d.query_status !== "ok") return `URLhaus returned: ${d.query_status}`;
      const urls = d.urls || [];
      return [
        `${input.host} IS listed in URLhaus.`,
        d.firstseen && `First seen: ${d.firstseen}`,
        `${d.url_count || urls.length} malicious URL(s) recorded.`,
        urls.slice(0, 5).map(u => `- ${u.url} [${u.url_status}] ${(u.tags || []).join(",")}`).join("\n")
      ].filter(Boolean).join("\n");
    }
    case "bluesky_lookup": {
      const d = await Proxy.lookup("bluesky_profile", { handle: input.handle });
      return [
        `@${d.handle}${d.displayName ? ` — ${d.displayName}` : ""}`,
        d.description && `Bio: ${d.description}`,
        `Followers: ${d.followersCount} · Following: ${d.followsCount} · Posts: ${d.postsCount}`,
        d.did && `DID: ${d.did}`,
        d.createdAt && `Created: ${String(d.createdAt).slice(0, 10)}`
      ].filter(Boolean).join("\n");
    }
    case "request_manual_lookup": {
      if (!ctx.onManualRequest) {
        return "No interactive channel available, so this lookup can't be handed to the user right now.";
      }
      // Resolves when the user pastes results or skips — this is what turns a
      // dead-end link into a step the investigation can actually continue from.
      const reply = await ctx.onManualRequest({
        tool_name: input.tool_name,
        url: input.url,
        what_to_copy: input.what_to_copy,
        why: input.why || ""
      });
      if (reply && reply.skipped) {
        return `The user skipped this lookup${reply.note ? `: ${reply.note}` : "."} Continue without it and note it as unchecked.`;
      }
      return `Results the user pasted from ${input.tool_name}:\n\n${reply.text}`;
    }
    case "search_tool_directory": {
      const hits = searchTools(input.query, input.limit || 8);
      if (!hits.length) return "No matching tools in the directory.";
      return hits.map(t => `${t.name} — ${t.url}${t.desc ? ` — ${t.desc}` : ""} [${t.category}]`).join("\n");
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/* ---------- system prompt ---------- */

const AGENT_SYSTEM = `You are the Aware OSINT investigator: an autonomous research agent embedded in an OSINT tool directory.

The user gives you an investigative task, sometimes with an image. Work it yourself:
plan, call your tools, read what comes back, follow the leads, and report.

Structure every investigation in these four phases, using these exact headings so the
interface can render them:

**Plan** — what specifically you are trying to establish. Two or three lines, not an essay.

**Tools** — name the exact tools you're using and why. Name them as they appear in the
directory when you're citing directory entries, and say plainly which ones you can run
yourself versus which need the user.

**Findings** — the results. Put each concrete extracted fact in a blockquote so it stands
out from your commentary:
> Registrar: NameCheap, registered 2026-08-02 (11 days old)
Follow each block with what it means for the investigation.

**Assessment** — what you established, what you couldn't, your confidence in each, and the
concrete next step. Never pad this with what you would have found.

Method:
- Run your own tools first and actually run them — don't describe what they'd return.
- For anything you can't call, use request_manual_lookup: build the exact prefilled URL,
  say precisely what to copy back, and the conversation pauses for their paste. Do not
  end a turn with a bare list of links; that pushes the work back onto the user, which
  is the thing this tool exists to avoid.
- Don't ask permission between steps — the user has already asked you to investigate.
- Pull identifiers out of the task yourself (domains, IPs, wallet addresses, emails)
  and look them up. If an image is attached, describe what you can actually see in
  it that is investigatively useful: signage, languages, architecture, road markings,
  vehicle models, vegetation, terrain, sun/shadow direction, business names.
- When an image is attached, its EXIF metadata is given to you in the task text —
  you cannot see it in the pixels. If it carries GPS, start there: it is the fastest
  route to a location, but it is editable and social platforms strip it, so verify it
  against the visible scene with osm_nearby and against shadows with sun_position
  rather than accepting it. A Software tag naming an editor means the file has been
  re-saved and is worth flagging.
- Show your working visually. Once you have identified the useful details, call
  annotate_image to box them on the photo so the user can check what you read. Once
  you have located any anchor, call plot_triangulation — it draws your working over
  real aerial imagery of the site. Always pass the camera object: the sight lines,
  view cone and error ellipse are the whole point of the diagram, and without them it
  is a scatter of dots. Both make the reasoning inspectable instead of asking the user
  to take it on trust.
- On any image whose origin or location is unknown, run reverse_image_search early —
  it queries five engines at once and is usually the fastest route to an answer.
  When the results come back, say explicitly what corroborates across two or more
  engines versus what only one returned, and treat a TinEye first-seen date that
  predates the image's claimed origin as a serious finding.
- Geolocating a photo is not finished when you name the street or district. Work it
  to a camera position, like this:

  1. List EVERY legible name in the frame — every shop, restaurant, bar, parlour,
     station, hoarding, van livery. Do not stop at the first one you recognise, and
     include partial reads, marking them as partial.
  2. Run osm_find_named on each one in turn. Every name that resolves is a separate
     anchor. Two anchors is a line; three is a fix.
  3. Use geo_measure between anchors for the distance and bearing of the line they
     sit on. Combine that with how they are arranged in the frame — which is left of
     which, which is nearer, what is occluded by what — to work out which side of
     that line the camera was on and roughly which way it pointed.
  4. Propose the camera position explicitly with geo_measure in project mode
     (from an anchor, along a bearing, for an estimated distance), give the
     coordinates, then run elevation AT THAT POINT — the camera's ground height, not
     the district's.
  5. Sanity-check the result with osm_nearby: everything visible in the photo should
     exist near your proposed point, and anything prominent that is mapped there but
     absent from the photo is evidence against it.
  6. Draw it: plot_triangulation with every anchor AND the camera object — lat, lon,
     the bearing you derived in step 3, and uncertainty_m. The tool hands back the
     distance and bearing to each anchor; read them. If that order does not match the
     left-to-right order of the features in the photo, your station is wrong: move it
     and plot again.

  State the camera position with an honest error radius (a few metres if three
  anchors agree, tens of metres from one anchor and a guessed distance), and say
  which anchors carried the conclusion. If only one name resolves, say you have a
  bearing but not a fix rather than presenting a point as if it were confirmed.

- LOOK AT THE PLACE. A candidate you have only named is not verified. Before you
  report any location, call place_photos on it — by coordinates if you have them,
  by name if you don't — and street_imagery for the view from the ground. Those
  come back as photographs you can actually see. Compare them against the attached
  image and say, feature by feature, what matches and what doesn't: the building
  shape, the roofline, the sign, the kerb, the street furniture.

  A match confirms. A mismatch KILLS the candidate — say so, drop it, and go to the
  next one. Do not report a place you never looked at, and never let a plausible
  story about a neighbourhood stand in for a photograph of it.

- Keep going on your own evidence. Every result is a lead into the next search:
  an address gives you coordinates, coordinates give you photos, a photo gives you
  a second business name, that name gives you another anchor. When you have several
  candidate districts, work them one at a time — photos first — instead of listing
  all three and asking the user which to pursue. You have the budget to check them
  all, so check them.

  A guess from architecture alone is the weakest thing you can produce. If that is
  all you have, it is the START of the work, not the end: search for the specific
  detail (web_search the exact sign text, the truck-restriction wording, the unusual
  roofline), pull photos of your top candidate, and let the pixels settle it.

- Tool failures are not answers. Overpass rate-limits and times out; the server
  already retries across mirrors before you ever see an error, so a failure that
  reaches you means that route is genuinely unavailable right now. Route around it:
  geocode an address instead of searching a name, use place_photos or web_search,
  or come back to it a step later. Never end an investigation with "the backend was
  down" while other tools were still untried, and never present an unchecked
  candidate as though the outage confirmed it.

- The other geo tools need coordinates before they can run. Once you have a camera
  position, verify it with sun_position against visible shadows and weather_history
  against a claimed date. If nothing yields a candidate at all, say so plainly rather
  than guessing coordinates.
- Chain your findings. An MX record naming a provider, a subdomain hinting at a
  staging host, an ASN placing a server in a country — each should suggest the next check.
- Most OSINT sources have no browser-callable API. For those, use search_tool_directory
  and hand the user specific named tools with URLs, plus what to search for in each.
- Say plainly when a lookup fails or returns nothing. Never present an inference as
  a confirmed fact, and never invent a result you did not get from a tool.
- Never imply you can run something you can't. If a capability needs a key the user
  hasn't set, or has no API at all, say that in one line the first time it comes up —
  don't describe what a tool "would" return as if you had run it. If the user then
  says "you do it", the honest answer is which specific thing is missing (a named API
  key, or that no browser-callable API exists for it), not a general apology.
- You keep the conversation. Follow-ups continue the same investigation — when the
  user adds context or asks for more, act on it with your tools rather than restating
  a list of links.

Finish with a short report: what you established, what you couldn't, your confidence,
and the concrete next steps a human should take by hand.

Scope limits — these are firm, and deliberately narrow. Ordinary OSINT is the job;
don't hedge or ask for justification on routine requests.

- When the user is investigating their own asset — their own phone number, email,
  domain, account or vehicle — that is a self-audit, which is entirely legitimate and
  a common reason people use OSINT tools. Help directly and fully: run what you have,
  and tell them what's exposed and how to get it removed. Do not ask them to justify
  looking up their own number.
- Geolocating a photo (working out where it was taken) is core OSINT work and is fine.
- Do NOT extract, enumerate, or run lookups on identifiers belonging to uninvolved
  people who merely appear in a scene — in particular, do not read off the licence
  plates of cars in a car park, street or crowd shot and look up their registrations,
  and do not attempt to identify bystanders' faces. That is bulk collection on people
  who are not the subject of the investigation. Say so briefly, and offer what you can
  legitimately do instead: geolocate the scene, establish when it was taken, or look up
  ONE specific vehicle the user has a stated lawful reason to investigate (their own
  vehicle, a hit-and-run, a vehicle already named in a public news story).
- Decline tasks aimed at stalking, harassing, or covertly monitoring a private
  individual. State the reason in one sentence and stop; don't lecture.`;

/* ---------- the loop ---------- */

/**
 * @param {object} opts
 * @param {string} opts.apiKey  user's Anthropic API key
 * @param {string} opts.model
 * @param {string} opts.task    the user's instruction
 * @param {{media_type:string,data:string}|null} opts.image  base64 image, no data: prefix
 * @param {object} opts.liveKeys
 * @param {(ev:object)=>void} opts.onEvent  step callback for the UI trace
 */
async function runInvestigation({ apiKey, model, task, image, liveKeys = {}, onEvent = () => {}, history = [], onManualRequest = null, onVisual = null }) {
  const content = [];
  if (image) {
    content.push({ type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } });
  }
  content.push({ type: "text", text: task });

  // `history` is the caller's live conversation array — appending to it directly is
  // what lets follow-up turns ("it's my own number", "now check X") keep the earlier
  // findings and the tool surface, instead of restarting cold every message.
  const messages = history;
  messages.push({ role: "user", content });
  trimAgentHistory(messages);

  // Haiku 4.5 predates adaptive thinking and the effort control; sending either 400s.
  const supportsThinking = !/haiku/i.test(model);

  for (let step = 0; step < AGENT_MAX_STEPS; step++) {
    const body = {
      model,
      max_tokens: 8000,
      system: AGENT_SYSTEM,
      tools: AGENT_TOOLS,
      messages
    };
    if (supportsThinking) {
      body.thinking = { type: "adaptive", display: "summarized" };
      body.output_config = { effort: "high" };
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Claude API ${res.status}: ${detail.slice(0, 300)}`);
    }

    const data = await res.json();

    // Safety classifiers can decline; surface it rather than looping.
    if (data.stop_reason === "refusal") {
      onEvent({ type: "refusal", text: data.stop_details?.explanation || "The request was declined." });
      return;
    }

    for (const block of data.content || []) {
      if (block.type === "thinking" && block.thinking) onEvent({ type: "thinking", text: block.thinking });
      if (block.type === "text" && block.text) onEvent({ type: "text", text: block.text });
    }

    messages.push({ role: "assistant", content: data.content });

    if (data.stop_reason !== "tool_use") {
      onEvent({ type: "done" });
      return;
    }

    const calls = (data.content || []).filter(b => b.type === "tool_use");
    // Parallel calls come back in one turn and their results must go back in ONE
    // user message, or the model learns to stop batching them.
    const results = await Promise.all(calls.map(async call => {
      onEvent({ type: "tool_call", name: call.name, input: call.input });
      try {
        const out = await executeAgentTool(call.name, call.input, liveKeys, { onManualRequest, onVisual });

        // An executor that found photographs returns { text, images }. Those go
        // back as image blocks inside the tool result, which is what lets the
        // model look at a candidate location instead of just reading its name.
        if (out && typeof out === "object" && Array.isArray(out.images)) {
          onEvent({ type: "tool_result", name: call.name, ok: true, text: out.text, images: out.images });
          return {
            type: "tool_result",
            tool_use_id: call.id,
            content: [
              ...out.images.map(img => ({
                type: "image",
                source: { type: "base64", media_type: img.media_type, data: img.data }
              })),
              { type: "text", text: String(out.text || "(no data)") }
            ]
          };
        }

        onEvent({ type: "tool_result", name: call.name, ok: true, text: out });
        return { type: "tool_result", tool_use_id: call.id, content: String(out || "(no data)") };
      } catch (err) {
        const msg = err.message || String(err);
        onEvent({ type: "tool_result", name: call.name, ok: false, text: msg });
        return { type: "tool_result", tool_use_id: call.id, content: `Error: ${msg}`, is_error: true };
      }
    }));

    messages.push({ role: "user", content: results });
  }

  onEvent({ type: "text", text:
    `_Stopped after ${AGENT_MAX_STEPS} tool steps to bound cost — this is a budget limit, not a conclusion. ` +
    `Say **continue** and I'll pick up from where the working left off._` });
  onEvent({ type: "done" });
}

/**
 * Merges the parsed upstream lists with the existing hand-written directory and
 * emits assets/js/tools-data.js.
 *
 * Hand-written entries win on URL collision — they have better descriptions and tags.
 */
const fs = require("fs");
const path = require("path");

const parsed = require("./parsed.json");
const REPO = path.join(__dirname, "..");

/* ---- target taxonomy ---- */
const CATEGORIES = [
  ["search-engines", "Search Engines & Dorking", "🔍"],
  ["username", "Username Search", "🧑‍💻"],
  ["email-breach", "Email & Breach Data", "📧"],
  ["phone", "Phone Number Lookup", "📱"],
  ["people", "People Search & Public Records", "🪪"],
  ["social-media", "Social Media Intelligence", "💬"],
  ["twitter", "Twitter / X", "🐦"],
  ["telegram", "Telegram", "✈️"],
  ["facebook", "Facebook", "📘"],
  ["instagram", "Instagram", "📸"],
  ["youtube", "YouTube", "▶️"],
  ["reddit", "Reddit", "🤖"],
  ["tiktok", "TikTok", "🎵"],
  ["linkedin", "LinkedIn & Professional Networks", "💼"],
  ["messaging", "Messaging & Chat Platforms", "💌"],
  ["images", "Image & Reverse Image Search", "🖼️"],
  ["video", "Video, Audio & Streaming", "🎬"],
  ["media-forensics", "Image & Video Forensics", "🔬"],
  ["geolocation", "Geolocation & GEOINT", "🗺️"],
  ["vehicle", "Vehicle, License Plate & VIN", "🚗"],
  ["aviation", "Aviation & Flight Tracking", "✈️"],
  ["maritime", "Maritime & Vessel Tracking", "🚢"],
  ["rail", "Rail & Ground Transport", "🚂"],
  ["military", "Military, Conflict & Crisis", "🎖️"],
  ["domain-network", "Domain, DNS & Network Infrastructure", "🌐"],
  ["scan-iot", "Internet Scanning & IoT", "📡"],
  ["archives", "Website & Web Archives", "🗄️"],
  ["metadata", "Metadata, Files & Documents", "🧬"],
  ["paste-code", "Paste Sites & Code Search", "📋"],
  ["jobs-professional", "Jobs & Resumes", "🧾"],
  ["academic", "Academic & Research", "🎓"],
  ["wireless-rf", "Wireless, RF & Networks", "📶"],
  ["darkweb", "Dark Web", "🕸️"],
  ["crypto", "Cryptocurrency & Blockchain", "🪙"],
  ["business", "Business & Corporate Records", "🏢"],
  ["government", "Government & Legal Records", "⚖️"],
  ["news", "News, Forums & Monitoring", "📰"],
  ["media-verification", "Fact Checking & Verification", "✅"],
  ["threat-intel", "Threat Intelligence & Malware", "🛡️"],
  ["pentest", "Pentest, Dorks & Vulnerabilities", "🐛"],
  ["privacy-opsec", "Privacy, OPSEC & Sock Puppets", "🥸"],
  ["data-analysis", "Data, Datasets & Analysis", "📊"],
  ["gaming", "Gaming Platforms", "🎮"],
  ["frameworks", "Frameworks & All-in-One Platforms", "🧰"]
];

/* ---- section -> category rules (ordered; first match wins) ---- */
const RULES = [
  [/^twitter$/i, "twitter"],
  [/^telegram$/i, "telegram"],
  [/^facebook$/i, "facebook"],
  [/^instagram$/i, "instagram"],
  [/^youtube$/i, "youtube"],
  [/^reddit$/i, "reddit"],
  [/^tiktok$/i, "tiktok"],
  [/linkedin|^xing$/i, "linkedin"],
  [/discord|whatsapp|skype|^kik$|^slack$|twitch|messaging-app|snap ?chat|clubhouse/i, "messaging"],

  [/vehicle|automobile|license plate|^transport$/i, "vehicle"],
  [/aviation|flight track|drone/i, "aviation"],
  [/maritime|marine|cargo track/i, "maritime"],
  [/railway|^routes$/i, "rail"],
  [/military|politics, conflicts|conflict|crisis/i, "military"],

  [/font|favicon|face recognition|image search|reverse image|image analy|image editing|^memes$|visual search/i, "images"],
  [/forensic|plagiarism|fakes/i, "media-forensics"],
  [/video|movies|netflix|live stream|audio|sound|music|spotify|tv\/radio|downloader|onlyfans|pornhub/i, "video"],

  [/geospatial|satellite|aerial|street view|webcam|^nature$|lost places|urban and industrial|sun and lunar|geolocation|social media and photos/i, "geolocation"],

  [/nickname|username/i, "username"],
  [/e-?mail|breach|leak|password|protonmail|office365|mbox/i, "email-breach"],
  [/phone|imei/i, "phone"],
  [/people invest|contact search|deceased|expert search/i, "people"],

  [/domain|dns|subdomain|website analy|website technology|website traffic|backlink|redirect|unshorten|similar sites|broken link|cloudfare|cookies analy|browser analy/i, "domain-network"],
  [/scan engines|attack surface|iot|cloud, iot/i, "scan-iot"],
  [/archive|web history|website capture|warc|offline browsing/i, "archives"],
  [/metadata|^files$|file search|filesharing|document and slides|exif|directories|public buckets/i, "metadata"],
  [/pastebin|^code$|code search|source code|github|paste sites/i, "paste-code"],

  [/job search/i, "jobs-professional"],
  [/academic|^science$|udemy|duolingo/i, "academic"],
  [/rf & sigint|sigint/i, "wireless-rf"],
  [/darknet|dark ?web/i, "darkweb"],
  [/crypto|nft|^iban$|bank information/i, "crypto"],
  [/company|business|brand\/trademark|tender|real estate|classifieds|stolen property|^amazon$|patreon/i, "business"],
  [/arrest|inmate|court|public records/i, "government"],
  [/news|web monitoring|trends|blog search|rss|^events$|wikipedia|q&a sites|forums|discussion boards/i, "news"],
  [/fact check|censorship|takedown|copyright/i, "media-verification"],
  [/threat|cyber threat maps|scams/i, "threat-intel"],
  [/dork|pentest|vulnerabilit|bugbounty|wordlist/i, "pentest"],
  [/privacy|sock puppet|browsers|vpn|virtual machines|linux distribution|os emulator|apps and programs/i, "privacy-opsec"],
  [/data and statistics|dataset|databases and data|infographic|visuali|text analy|translation|analytics|automation|scrapers|extractors|parsers|browser extensions|keywords/i, "data-analysis"],
  [/gaming|^steam$|^xbox$|minecraft/i, "gaming"],

  [/social network|socmint|social media|russian speaking|other communities|mastodon|vkontakte|^vk$|tumblr|pinterest|parler|bluesky|google\+|flickr|4chan|fidonet|usenet/i, "social-media"],
  [/search engine|meta search|^universal|google dork|tools for google|tools for duckduckgo|^yandex$|specialty|speciality/i, "search-engines"]
];

const FALLBACK = "frameworks"; // toolkits, awesome-lists, blogs, "Other", misc

function mapSection(section) {
  for (const [re, cat] of RULES) if (re.test(section)) return cat;
  return FALLBACK;
}

/* ---- read existing hand-written data ---- */
const existingSrc = fs.readFileSync(path.join(REPO, "assets/js/tools-data.js"), "utf8");
const sandbox = {};
new Function("exports", existingSrc + "\nexports.C = OSINT_CATEGORIES;")(sandbox);
const existing = sandbox.C;

const normUrl = u => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "")
  .replace(/\/+$/, "").replace(/[?#].*$/, "");

const seen = new Set();
const buckets = {};
CATEGORIES.forEach(([id]) => (buckets[id] = []));

// 1. hand-written entries first — they keep their curated category, desc and tags.
let keptExisting = 0;
for (const cat of existing) {
  const targetId = buckets[cat.id] ? cat.id : FALLBACK;
  for (const t of cat.tools) {
    const k = normUrl(t.url);
    if (seen.has(k)) continue;
    seen.add(k);
    buckets[targetId].push({ name: t.name, url: t.url, desc: t.desc, tags: t.tags, curated: true });
    keptExisting++;
  }
}

// 2. upstream entries appended into their mapped category.
const STOP = new Set(["the","and","for","with","from","that","this","your","you","are","its","all","can","has","was","not","but","out","use","get","who","how","new","one","two","more","most","other","also","their","them","they","it's","a","an","of","to","in","on","at","by","or","is","be","as"]);
function makeTags(name, desc, section, catId) {
  const tags = new Set();
  cleanWords(section).forEach(w => tags.add(w));
  cleanWords(catId.replace(/-/g, " ")).forEach(w => tags.add(w));
  cleanWords(name).slice(0, 3).forEach(w => tags.add(w));
  cleanWords(desc).slice(0, 6).forEach(w => tags.add(w));
  return [...tags].slice(0, 12);
}
function cleanWords(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w));
}

let added = 0, skippedDupe = 0;
for (const e of parsed) {
  const k = normUrl(e.url);
  if (seen.has(k)) { skippedDupe++; continue; }
  seen.add(k);
  const catId = mapSection(e.section);
  buckets[catId].push({
    name: e.name,
    url: e.url,
    desc: e.desc,
    tags: makeTags(e.name, e.desc, e.section, catId),
    section: e.section
  });
  added++;
}

/* ---- emit ---- */
const q = s => JSON.stringify(s);
let out = `/**
 * OSINT tool directory.
 *
 * Two provenance tiers:
 *  - Hand-written entries (curated: true) — description and tags written by hand,
 *    URL checked at time of writing.
 *  - Imported entries — merged from the public awesome-OSINT collections listed in
 *    the README (edwardtay/awesome-OSINT, cipher387/osint_stuff_tool_collection,
 *    jivoi/awesome-osint, Ph055a/OSINT_Collection), deduplicated by normalized URL.
 *    Descriptions come from those lists; individual links are NOT independently
 *    verified, so some will have rotted. Treat a dead link as expected, not a bug.
 *
 * Each tool: { name, url, desc, tags, curated?, section? }
 *   tags     drive the directory search and the local chatbot matcher
 *   section  original upstream heading, kept as a searchable provenance hint
 */
const OSINT_CATEGORIES = [\n`;

for (const [id, name, icon] of CATEGORIES) {
  const tools = buckets[id];
  if (!tools.length) continue;
  out += `  {\n    id: ${q(id)},\n    name: ${q(name)},\n    icon: ${q(icon)},\n    tools: [\n`;
  out += tools.map(t => {
    const bits = [`name: ${q(t.name)}`, `url: ${q(t.url)}`, `desc: ${q(t.desc || "")}`, `tags: ${JSON.stringify(t.tags || [])}`];
    if (t.curated) bits.push("curated: true");
    if (t.section) bits.push(`section: ${q(t.section)}`);
    return `      { ${bits.join(", ")} }`;
  }).join(",\n");
  out += `\n    ]\n  },\n`;
}
out = out.replace(/,\n$/, "\n");
out += `];

// Flat index used by the chatbot / search for fast lookups.
const OSINT_TOOLS_FLAT = OSINT_CATEGORIES.flatMap(cat =>
  cat.tools.map(tool => ({ ...tool, category: cat.name, categoryId: cat.id, categoryIcon: cat.icon }))
);
`;

fs.writeFileSync(path.join(REPO, "assets/js/tools-data.js"), out);

const total = Object.values(buckets).reduce((n, b) => n + b.length, 0);
console.log(`kept hand-written: ${keptExisting}`);
console.log(`imported new:      ${added}   (skipped ${skippedDupe} url dupes)`);
console.log(`TOTAL:             ${total} tools in ${CATEGORIES.filter(([id]) => buckets[id].length).length} categories\n`);
CATEGORIES.forEach(([id, name]) => {
  const b = buckets[id];
  if (b.length) console.log(`  ${String(b.length).padStart(4)}  ${name}`);
});
console.log(`\nfile size: ${(out.length / 1024).toFixed(0)} KB`);

/**
 * Parses the downloaded awesome-OSINT markdown lists into {name,url,desc,section}.
 * One unified pass per file: shared header tracking (ATX `##` *and* Setext `===`
 * underlines, which cipher387 switches to halfway through) plus both table-row and
 * bullet entry formats, so a section can never leak across a header style change.
 */
const fs = require("fs");
const path = require("path");

const DIR = path.join(__dirname, "lists");

function cleanSection(s) {
  return s
    .replace(/\[.*?\]\(.*?\)/g, "")
    .replace(/\[↑\]/g, "")
    .replace(/[#*_`]/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(s) {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/!\[.*?\]\(.*?\)/g, "")
    .replace(/\[(.*?)\]\(.*?\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const REJECT_URL = /^(#|\/|mailto:|javascript:)/i;
const REJECT_HOST = /(awesome\.re|shields\.io|img\.shields|badge|rawgit\.com|sindresorhus\/awesome|contributor-covenant|creativecommons\.org|paypal|patreon|buymeacoffee|ko-fi|twitter\.com\/intent|github\.com\/[^/]+\/[^/]+\/(stargazers|network|issues|blob|commits)$)/i;
const REJECT_NAME = /^(back to top|top|table of contents|contents|menu|home|index|contributing|license|credits|readme|previous|next|here|link|website|site|\.\.\.|[-—–↑\s]*)$/i;

function makeEntry(name, url, desc, section) {
  name = cleanText(name);
  desc = cleanText(desc || "");
  if (!name || !url) return null;
  if (!/^https?:\/\//i.test(url)) return null;
  if (REJECT_URL.test(url) || REJECT_HOST.test(url)) return null;
  if (REJECT_NAME.test(name)) return null;
  if (name.length > 60) name = name.slice(0, 57).trim() + "…";
  if (desc.length > 155) desc = desc.slice(0, 152).trim() + "…";
  return { name, url: url.trim(), desc, section: cleanSection(section || "") };
}

function parseFile(md) {
  const out = [];
  const lines = md.split("\n");
  let section = "";
  let inToc = false;

  const setSection = raw => {
    section = raw;
    inToc = /table of contents|^contents$|^menu$/i.test(cleanSection(raw));
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const next = lines[i + 1] || "";

    // ATX header:  ## Section
    const atx = line.match(/^#{1,6}\s+(.*)$/);
    if (atx) { setSection(atx[1]); continue; }

    // Setext header:  Section\n=======
    if (
      line.trim() && !line.trim().startsWith("|") && !/^\s*[-*+]\s/.test(line) &&
      /^(={3,}|-{3,})\s*$/.test(next.trim())
    ) {
      setSection(line);
      i++; // skip the underline
      continue;
    }

    if (inToc) continue;

    // Table row:  | [Name](url) | ... | Description |
    if (line.trim().startsWith("|")) {
      if (/^\|[\s\-:|]+\|$/.test(line.trim())) continue;
      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      if (cells.length < 2) continue;
      const link = cells[0].match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
      if (!link) continue;
      const desc = cells.slice(1).reverse().find(c => c && !/^[—\-–\s]*$/.test(c)) || "";
      const e = makeEntry(link[1], link[2], desc, section);
      if (e) out.push(e);
      continue;
    }

    // Bullet:  * [Name](url) - Description
    const b = line.match(/^\s*[-*+]\s+\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)\s*(?:[-–—:]\s*(.*))?$/);
    if (b) {
      const e = makeEntry(b[1], b[2], b[3] || "", section);
      if (e) out.push(e);
    }
  }
  return out;
}

const FILES = [
  "awesome-osint-edwardtay.md",
  "cipher387-tools.md",
  "awesome-osint-jivoi.md",
  "osint-collection.md"
];

const all = [];
for (const f of FILES) {
  const entries = parseFile(fs.readFileSync(path.join(DIR, f), "utf8"));
  console.log(`${f}: ${entries.length} entries`);
  entries.forEach(e => (e.source = f.replace(/\.md$/, "")));
  all.push(...entries);
}

// Dedupe by normalized URL; keep the single best record whole (never merge fields
// across sources, which is what previously scrambled section attribution).
function normUrl(u) {
  return u.toLowerCase()
    .replace(/^https?:\/\//, "").replace(/^www\./, "")
    .replace(/\/+$/, "").replace(/[?#].*$/, "");
}
const byUrl = new Map();
for (const e of all) {
  const k = normUrl(e.url);
  const prev = byUrl.get(k);
  if (!prev) { byUrl.set(k, e); continue; }
  const better = e.desc.length > prev.desc.length ? e : prev;
  byUrl.set(k, better);
}
const deduped = [...byUrl.values()];

console.log(`\ntotal: ${all.length} -> unique: ${deduped.length}`);
console.log(`with description: ${deduped.filter(e => e.desc).length}`);

const sections = {};
deduped.forEach(e => { sections[e.section] = (sections[e.section] || 0) + 1; });
console.log(`distinct sections: ${Object.keys(sections).length}\n`);
Object.entries(sections).sort((a, b) => b[1] - a[1]).slice(0, 40)
  .forEach(([s, n]) => console.log(`  ${String(n).padStart(4)}  ${s || "(none)"}`));

fs.writeFileSync(path.join(__dirname, "parsed.json"), JSON.stringify(deduped, null, 1));
console.log("\nwrote parsed.json");

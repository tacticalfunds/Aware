/**
 * Entity collection with provenance.
 *
 * As an investigation runs it turns up coordinates, domains, addresses, wallets
 * and place names, and until now those existed only inside prose. That makes the
 * write-up unauditable: "Larimer Street" read exactly the same whether a lookup
 * returned it or the model inferred it from architecture.
 *
 * So every entity is recorded with the tool that produced it and the step it
 * appeared at. Two entities seen in the same tool result are linked — that is a
 * genuine relation ("these came back together"), and it is the only kind of edge
 * claimed here. Nothing infers a relationship the data does not show.
 *
 * Extraction is deliberately conservative: well-formed patterns only. A missed
 * entity is a gap; a wrong one is a false lead in an evidence log.
 */

const ENTITY_PATTERNS = [
  {
    type: "coordinates",
    label: "Coordinates",
    // Four decimal places minimum — fewer is a rounded figure, not a fix.
    re: /(-?\d{1,2}\.\d{4,})\s*,\s*(-?\d{1,3}\.\d{4,})/g,
    take: m => `${Number(m[1]).toFixed(6)}, ${Number(m[2]).toFixed(6)}`,
    valid: m => Math.abs(+m[1]) <= 90 && Math.abs(+m[2]) <= 180
  },
  {
    type: "ipv4",
    label: "IP addresses",
    re: /\b((?:\d{1,3}\.){3}\d{1,3})\b/g,
    take: m => m[1],
    valid: m => m[1].split(".").every(o => +o <= 255) && !/^0\./.test(m[1])
  },
  {
    type: "email",
    label: "Email addresses",
    re: /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g,
    take: m => m[1].toLowerCase()
  },
  {
    type: "domain",
    label: "Domains",
    // Anchored on a known TLD shape; a bare "photo.jpg" must not qualify.
    re: /\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|org|net|io|co|uk|de|fr|es|nl|ru|cn|jp|gov|edu|info|biz|dev|app|xyz|me|tv|us|ca|au|it|se|no|fi|pl|br|in|za))\b/gi,
    take: m => m[1].toLowerCase(),
    valid: m => !/\.(jpe?g|png|gif|webp|svg|css|js|json|html?|txt|pdf)$/i.test(m[1])
  },
  {
    type: "btc",
    label: "Bitcoin addresses",
    re: /\b(bc1[a-z0-9]{25,62}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})\b/g,
    take: m => m[1]
  },
  {
    type: "eth",
    label: "Ethereum addresses",
    re: /\b(0x[a-fA-F0-9]{40})\b/g,
    take: m => m[1].toLowerCase()
  },
  {
    type: "url",
    label: "URLs",
    re: /\bhttps?:\/\/[^\s<>"')\]]+/g,
    take: m => m[0].replace(/[.,;:]+$/, "")
  }
];

/*
 * Names the agent asked about. A place name cannot be regexed out of prose
 * reliably, but the tool inputs say exactly which names were searched — better
 * evidence than any pattern match, and it captures the ones that did NOT resolve
 * too, which matter just as much.
 */
const NAME_INPUTS = {
  osm_find_named: i => i.name,
  geocode: i => i.place,
  place_search: i => i.query,
  place_photos: i => i.query,
  username_enumeration: i => i.username
};

function makeEntityLog() {
  return {
    items: new Map(),   // "type value" -> { type, label, value, sources, steps, first }
    // JSON-encoded [keyA, keyB] -> count. Entity keys contain spaces, so a
    // plain string separator cannot be split back apart reliably.
    links: new Map(),
    order: 0,

    add(type, label, value, tool, step) {
      const v = String(value || "").trim();
      if (!v || v.length > 200) return null;
      const key = `${type} ${v}`;
      let e = this.items.get(key);
      if (!e) {
        e = { type, label, value: v, sources: new Set(), steps: new Set(), first: this.order++ };
        this.items.set(key, e);
      }
      e.sources.add(tool);
      e.steps.add(step);
      return key;
    },

    /** Scan one tool result. Everything found here is linked to everything else. */
    observe(tool, input, text, step) {
      const found = [];

      const asked = NAME_INPUTS[tool];
      if (asked) {
        const name = asked(input || {});
        if (name) found.push(this.add("name", "Names searched", name, tool, step));
      }

      const body = typeof text === "string" ? text : "";
      for (const pat of ENTITY_PATTERNS) {
        pat.re.lastIndex = 0;
        let m, guard = 0;
        while ((m = pat.re.exec(body)) && guard++ < 400) {
          if (pat.valid && !pat.valid(m)) continue;
          found.push(this.add(pat.type, pat.label, pat.take(m), tool, step));
        }
      }

      const keys = [...new Set(found.filter(Boolean))];
      for (let i = 0; i < keys.length; i++) {
        for (let j = i + 1; j < keys.length; j++) {
          const pair = JSON.stringify([keys[i], keys[j]].sort());
          this.links.set(pair, (this.links.get(pair) || 0) + 1);
        }
      }
    },

    /** Grouped for display, most-corroborated first within each type. */
    snapshot(limit = 60) {
      const all = [...this.items.entries()]
        .map(([key, e]) => ({
          key, type: e.type, label: e.label, value: e.value,
          sources: [...e.sources], steps: [...e.steps].sort((a, b) => a - b), first: e.first
        }))
        .sort((a, b) => b.sources.length - a.sources.length || a.first - b.first)
        .slice(0, limit);

      const keep = new Set(all.map(e => e.key));
      const links = [...this.links.entries()]
        .map(([pair, count]) => {
          const [a, b] = JSON.parse(pair);
          return { a, b, count };
        })
        .filter(l => keep.has(l.a) && keep.has(l.b));

      const groups = [];
      for (const e of all) {
        let g = groups.find(x => x.type === e.type);
        if (!g) groups.push(g = { type: e.type, label: e.label, items: [] });
        g.items.push(e);
      }
      return { total: this.items.size, shown: all.length, groups, entities: all, links };
    }
  };
}

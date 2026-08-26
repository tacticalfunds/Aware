#!/usr/bin/env node
/**
 * Builds a single self-contained HTML document containing every hand-written
 * source file in the project, plus a written tour of what the site does.
 *
 * Usage:  node tools/build-codebook.js [output.html]
 *
 * Generated data (tools-data.js, wmn-data.json, area-codes.js) and vendored
 * third-party libraries are listed but not inlined — together they are ~1.5 MB
 * of material nobody reads, and two of them are rebuilt by the other scripts in
 * this directory. Everything a person would actually edit is included in full.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const OUT = process.argv[2] || path.join(ROOT, "aware-codebook.html");

/* ------------------------------------------------------------------ *
 * What goes in the book
 * ------------------------------------------------------------------ */

const SECTIONS = [
  {
    id: "shell", title: "Page shell and styling",
    blurb: "The single HTML page and everything that lays it out. There is no build step and no bundler — these files are served as-is.",
    files: [
      ["index.html", "The whole page: topbar, chat panel, directory panel, settings modal, and the script tags that load everything else in dependency order. Also carries the head script that rescues the layout on browsers which lie about their viewport width."],
      ["assets/css/styles.css", "Base styling: dark theme tokens, the two-column layout, chat, directory, agent trace, plan view, manual-handoff cards."],
      ["assets/css/compact.css", "Everything the site does differently on a phone. Kept in its own file, not an @media block, so a script can force it on when the browser misreports its width."],
      ["assets/css/narrow.css", "Extra stacking below ~560px. Loaded the same way as compact.css."]
    ]
  },
  {
    id: "server", title: "Server",
    blurb: "A dependency-free Node server that hosts the static site and proxies everything the browser cannot reach itself. The proxy is deliberately not an open one: the client names a source and passes parameters, and the server builds the upstream URL from its own table.",
    files: [
      ["server.js", "Static host, the 43-source lookup proxy with mirror failover and caching, username enumeration across 716 sites, basemap tile proxy, and the allowlisted image fetcher."],
      ["package.json", "Name, start script, engine floor. No dependencies."],
      ["railway.json", "Railway build and deploy configuration."]
    ]
  },
  {
    id: "front", title: "Front-end application",
    blurb: "Rendering, search, chat, and the client half of the proxy.",
    files: [
      ["assets/js/main.js", "UI wiring: directory rendering, search and filtering, the category jump menu and scroll-spy, chat transcript, the agent trace, image annotation and plan-view rendering, chat font and width preferences, settings."],
      ["assets/js/chatbot.js", "Local mode: keyword matching against the directory plus a library of canned investigation workflows. This is what answers when no API key is set."],
      ["assets/js/live-lookup.js", "Spots an IP, domain, Bitcoin address or email in a chat message and runs real lookups against it without involving the model."],
      ["assets/js/proxy.js", "Client half of the server proxy: capability detection, named lookups, image fetching, and direct-fetch fallback for static hosting."]
    ]
  },
  {
    id: "agent", title: "Investigation agent",
    blurb: "The autonomous half. A Claude tool-use loop with vision, conversation memory, a human-in-the-loop escape hatch, and a registry that merges tool groups from the files below.",
    files: [
      ["assets/js/agent.js", "The loop itself, the system prompt with the investigation method, the tool-group registry, history trimming, and the network and identity tools."]
    ]
  },
  {
    id: "tools", title: "Agent tool groups",
    blurb: "Each file exports a {GROUP}_TOOLS array of schemas and a matching {GROUP}_EXECUTORS map. agent.js merges whichever ones happen to be loaded, so a group can be added or removed by editing one script tag.",
    files: [
      ["assets/js/tools/geo.js", "Geocoding, place search, OSM proximity and named-feature lookups, great-circle measurement and projection, elevation, historical weather, sun and moon position."],
      ["assets/js/tools/photos.js", "Photographs of places, street-level imagery and web search. Returns actual images inside the tool result so the model can look at a candidate location instead of only naming it."],
      ["assets/js/tools/image.js", "Multi-engine reverse image search, handed to the user as a manual step."],
      ["assets/js/tools/metadata.js", "EXIF extraction in the browser, including GPS, capture time and the editing tell-tales."],
      ["assets/js/tools/visual.js", "The two tools that let the agent show its reasoning: annotated boxes over the photo, and the survey-style plan view."]
    ]
  },
  {
    id: "build", title: "Data build scripts",
    blurb: "Run by hand, not at deploy time. They regenerate the large data files that this document deliberately leaves out.",
    files: [
      ["tools/parse-lists.js", "Parses upstream OSINT markdown lists into structured records, handling the header-style switches mid-file that mis-file entries if ignored."],
      ["tools/generate-data.js", "Turns the parsed records into assets/js/tools-data.js, deduplicating by URL and assigning categories."],
      ["tools/build-areacodes.js", "Builds the offline area-code table used by the phone tools."],
      ["tools/refresh-wmn.sh", "Refreshes the WhatsMyName username-enumeration dataset."],
      ["tools/README.md", "How and when to run the above."]
    ]
  },
  {
    id: "docs", title: "Project documentation",
    files: [
      ["README.md", "The repository's own README."],
      ["KEYS.md", "Which optional API keys are worth setting and what each one unlocks."],
      [".gitignore", ""]
    ]
  }
];

/* Listed, not inlined. */
const OMITTED = [
  ["assets/js/tools-data.js", "generated", "The 3,469-tool directory. Rebuilt by tools/generate-data.js."],
  ["data/wmn-data.json", "data", "716 WhatsMyName site definitions. Refreshed by tools/refresh-wmn.sh."],
  ["assets/js/area-codes.js", "generated", "Offline area-code table. Rebuilt by tools/build-areacodes.js."],
  ["assets/vendor/libphonenumber-max.js", "third-party", "Google libphonenumber, MIT. See assets/vendor/libphonenumber-js.LICENSE."],
  ["assets/vendor/exifr-lite.umd.js", "third-party", "exifr, MIT. See assets/vendor/exifr.LICENSE."],
  ["assets/vendor/suncalc.cjs", "third-party", "SunCalc, BSD-2-Clause. See assets/vendor/suncalc.LICENSE."],
  ["assets/vendor/suncalc-global.js", "third-party", "Thin wrapper exposing SunCalc as a global for classic script loading."],
  ["package-lock.json", "generated", "npm lockfile. The project has no runtime dependencies."],
  ["tools/exif-fixture.jpg", "binary", "Hand-built JPEG with known EXIF, used to test the metadata tool."]
];

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const esc = s => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function lang(rel) {
  const e = path.extname(rel).toLowerCase();
  return { ".js": "javascript", ".css": "css", ".html": "html", ".json": "json",
           ".md": "markdown", ".sh": "shell" }[e] || "text";
}

/** Line-numbered code, as a table so line numbers don't get copied with the code. */
function codeBlock(src) {
  const lines = src.replace(/\n$/, "").split("\n");
  const gutter = lines.map((_, i) => i + 1).join("\n");
  return `<div class="code" data-lines="${lines.length}">` +
    `<pre class="gutter" aria-hidden="true">${gutter}</pre>` +
    `<pre class="src"><code>${esc(lines.join("\n"))}</code></pre></div>`;
}

function gitInfo() {
  const run = c => { try { return execSync(c, { cwd: ROOT }).toString().trim(); } catch { return ""; } };
  return {
    commit: run("git rev-parse --short HEAD"),
    branch: run("git rev-parse --abbrev-ref HEAD"),
    date: run("git log -1 --format=%cd --date=format:%Y-%m-%d")
  };
}

/* ------------------------------------------------------------------ *
 * Feature tour — read from the code where it can be, written where it can't
 * ------------------------------------------------------------------ */

function stats() {
  const s = { agentTools: 0, sources: 0, keyless: 0, wmn: 0, dirTools: 0, categories: 0 };
  try {
    const agent = read("assets/js/agent.js");
    const groups = ["geo", "photos", "image", "metadata", "visual"];
    let n = (agent.match(/^\s{4}name: "/gm) || []).length;
    for (const g of groups) {
      const src = read(`assets/js/tools/${g}.js`);
      n += (src.match(/^\s{4}name: "/gm) || []).length;
    }
    s.agentTools = n;
  } catch { /* leave at 0 */ }
  try {
    const server = read("server.js");
    const block = server.slice(server.indexOf("const SOURCES = {"), server.indexOf("/** Which proxied sources"));
    s.sources = (block.match(/^  [a-z0-9_]+: \{/gm) || []).length;
    s.keyless = s.sources - (block.match(/^\s{4}key: "/gm) || []).length;
  } catch { /* leave at 0 */ }
  try { s.wmn = (JSON.parse(read("data/wmn-data.json")).sites || []).length; } catch {}
  try {
    const d = read("assets/js/tools-data.js");
    s.dirTools = (d.match(/\{ *name:/g) || []).length;
    s.categories = (d.match(/^\s*\{\s*id: "/gm) || []).length;
  } catch {}
  return s;
}

const FEATURES = st => `
<h2 id="what">What Aware is</h2>

<p>A single web page that puts an entire OSINT toolkit behind one chat box. It does
two distinct things, and the difference between them matters:</p>

<ul>
  <li><strong>It indexes ${st.dirTools ? st.dirTools.toLocaleString() : "3,469"} tools</strong> across
      ${st.categories || 44} categories — names, descriptions and links, searchable and
      browsable. These it can point you at, not run.</li>
  <li><strong>It runs ${st.agentTools || 39} of its own tools</strong> directly, against real
      APIs, on your behalf. These have code behind them.</li>
</ul>

<p>The bridge between the two is <code>search_tool_directory</code>: when a task needs one
of the thousands it cannot call — PimEyes, Maltego, a Telegram bot — the agent
searches the directory and hands you the specific tool plus what to look for in it.</p>

<h2 id="modes">The two chat modes</h2>

<p><strong>Local mode</strong> needs no API key. A keyword matcher maps what you type onto
the directory and onto a library of canned investigation workflows. It also runs
<em>live lookups</em>: drop an IP, domain, Bitcoin address or email into the chat and it
queries DNS, ipinfo.io, crt.sh, urlscan.io and blockchain.info for real, with no
model involved.</p>

<p><strong>AI mode</strong> takes an Anthropic API key, entered in the settings modal and kept
in your browser. Every turn goes to the investigation agent — there is no separate
"chat" path that answers without tools, which was an early structural bug worth not
reintroducing.</p>

<h2 id="agent-loop">The investigation agent</h2>

<p>A Claude tool-use loop written against the Messages API directly. It carries
conversation memory across turns, runs parallel tool calls and returns their results
in a single user message, streams its thinking into a visible trace, and stops after
a bounded number of tool steps rather than running up an unbounded bill.</p>

<p>Its system prompt fixes the shape of an answer: <strong>Plan → Tools → Findings →
Assessment</strong>, with the key extracted details boxed out. It is required to
distinguish what it established from what it did not, and to give an honest error
radius rather than a confident point.</p>

<h3>Geolocating a photo</h3>

<p>The method the prompt lays out, in order:</p>

<ol>
  <li>List every legible name in the frame — every shop, bar, hoarding, van livery
      — including partial reads, marked as partial.</li>
  <li>Resolve each through <code>osm_find_named</code>. Every name that resolves is an
      anchor. Two anchors is a line; three is a fix.</li>
  <li>Measure the line the anchors sit on, and combine it with how they are arranged
      in frame to work out which side of it the camera was on.</li>
  <li>Project a camera position along that bearing, then take the elevation
      <em>at that point</em> — the camera's ground height, not the district's.</li>
  <li>Sanity-check against what OSM says should be visible from there.</li>
  <li><strong>Look at it.</strong> Pull photographs of the candidate and compare them with
      the attached image, feature by feature. A match confirms; a mismatch kills the
      candidate and it moves to the next one.</li>
  <li>Draw the plan view, read back the computed bearings, and move the station and
      re-plot if they do not match the left-to-right order of features in the photo.</li>
</ol>

<h3>Seeing, not just naming</h3>

<p>The photo tools return actual pixels. Images ride back inside the tool result as
image blocks, so on its next turn the model is comparing a photograph of the
candidate place against the photograph in hand. <code>place_photos</code> pulls geotagged
Wikimedia Commons imagery around a point, or searches by name and falls back to
Openverse where Commons is thin. <code>street_imagery</code> pulls Mapillary frames sorted by
how close their compass angle is to the derived camera bearing.</p>

<h3>Showing its working</h3>

<p><code>annotate_image</code> draws labelled, colour-coded boxes over the attached photo
marking the details a conclusion rests on. <code>plot_triangulation</code> draws a
survey-style plan view over real aerial imagery: numbered control points, a sight
line to every anchor labelled with distance and bearing, the view cone, the error
ellipse, a lat/lon graticule, scale bar and north arrow, with OpenStreetMap building
footprints and roads traced over the photography.</p>

<h3>When it cannot do something itself</h3>

<p>Most OSINT sources have no callable API. <code>request_manual_lookup</code> pauses the loop
and hands you a card with prefilled links and a note on exactly what to copy back;
your answer resumes the run as a tool result. Reverse image search and street-level
imagery without a Mapillary token both work this way.</p>

<h2 id="proxy">The server proxy</h2>

<p>Browsers cannot reach most of these APIs — CORS blocks them, and API keys have no
business being in client JavaScript. <code>server.js</code> proxies
${st.sources || 43} named sources, ${st.keyless || 34} of which work with no key at all.</p>

<p>It is <strong>not an open proxy</strong>. The client sends a source <em>name</em> and a
parameter object; the server builds the upstream URL from its own table. There is no
request shape that makes it fetch a URL of the caller's choosing.</p>

<p>Three things were learned the hard way and are now built in:</p>

<ul>
  <li><strong>Retries with mirror failover.</strong> Overpass rate-limits hard and sheds load
      under pressure. A whole investigation once spent its entire step budget on 429s
      and concluded "the backend was down" with candidates unchecked. Lookups now
      retry across mirrors with a growing backoff and cache successes, and the error
      that finally reaches the agent says how many attempts were spent.</li>
  <li><strong>Tile proxying.</strong> Aerial and street basemaps are fetched and cached
      server-side, with an identifying User-Agent, which OpenStreetMap's tile usage
      policy requires.</li>
  <li><strong>Image fetching, strictly allowlisted.</strong> Only the image CDNs behind the
      photo sources, HTTPS only, <code>image/*</code> only, 5 MB cap.</li>
</ul>

<p>It also runs username enumeration across ${st.wmn ? st.wmn.toLocaleString() : "716"} sites
from the WhatsMyName dataset, twelve at a time, skipping the ones behind a captcha or
Cloudflare where a result would be meaningless.</p>

<h2 id="directory">The directory</h2>

<p>Every category is a section with a sticky toolbar, a horizontally scrolling pill
row for jumping between them, live search across names, descriptions and tags, and a
scroll-spy that keeps the active pill in sync. Categories render collapsed to twelve
tools with a "show more" control, because several hold over two hundred.</p>

<h2 id="mobile">Phones that lie about their width</h2>

<p>Safari's <em>Request Desktop Website</em> and many in-app WebViews ignore the viewport
meta tag, lay the page out at about 980px and scale the result down. Every
<code>max-width</code> media query then resolves to the desktop layout on a phone-sized
screen — which is the correct rendering <em>for a 980px viewport</em>, so no CSS can tell
the two cases apart.</p>

<p><code>screen.width</code> and the pointer type still describe the real device. A script in
the head uses them: when they say phone and the layout viewport says desktop, it
flips <code>compact.css</code> to <code>media="all"</code>. The rules stay in one file, and the media
attributes stay in place so ordinary desktop resizing is untouched.</p>

<h2 id="deploy">Running it</h2>

<p><code>npm start</code> runs <code>server.js</code>, which serves the site <em>and</em> the proxy, so the
agent gets its full tool surface. Node 18 or newer; no dependencies to install.
Optional environment variables enable the credentialed sources for everyone using
the deployment, without anyone pasting a key into a browser:
<code>SHODAN_KEY</code>, <code>VIRUSTOTAL_KEY</code>, <code>ABUSEIPDB_KEY</code>, <code>ETHERSCAN_KEY</code>,
<code>HIBP_KEY</code>, <code>VERIPHONE_KEY</code>, <code>IPQS_KEY</code>, <code>GITHUB_TOKEN</code>,
<code>MAPILLARY_TOKEN</code>, <code>BRAVE_KEY</code>.</p>

<p>Static hosting still works, but without the server there is no proxy: the agent
falls back to the handful of CORS-friendly sources plus the manual handoff, and the
plan view draws its geometry on a plain grid instead of aerial imagery.</p>

<h2 id="limits">Deliberate limits</h2>

<p>Two capabilities were asked for and not built, and the reasons are encoded in the
agent's own system prompt rather than left to chance:</p>

<ul>
  <li><strong>Bulk licence-plate extraction</strong> from parking lots and street scenes. Those
      frames are full of uninvolved people, and reading every plate in one is mass
      surveillance of bystanders rather than an investigation.</li>
  <li><strong>Automated password-reset probing</strong> of the holehe / ignorant kind. It sends
      real emails and texts to the person being investigated, which tips them off and
      is a nuisance to them regardless of the outcome.</li>
</ul>
`;

/* ------------------------------------------------------------------ *
 * Assemble
 * ------------------------------------------------------------------ */

function build() {
  const st = stats();
  const git = gitInfo();
  const present = [];
  let totalLines = 0;

  for (const sec of SECTIONS) {
    sec.entries = [];
    for (const [rel, note] of sec.files) {
      let src;
      try { src = read(rel); } catch { continue; }   // a file may have been removed
      const lines = src.replace(/\n$/, "").split("\n").length;
      totalLines += lines;
      const anchor = "f-" + rel.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      sec.entries.push({ rel, note, src, lines, anchor, lang: lang(rel) });
      present.push(rel);
    }
  }

  const toc = SECTIONS.filter(s => s.entries.length).map(sec => `
    <li class="toc-sec"><a href="#${sec.id}">${esc(sec.title)}</a>
      <ul>${sec.entries.map(e =>
        `<li><a href="#${e.anchor}"><span class="tf">${esc(e.rel)}</span><span class="tl">${e.lines}</span></a></li>`
      ).join("")}</ul>
    </li>`).join("");

  const body = SECTIONS.filter(s => s.entries.length).map(sec => `
    <section class="filesec" id="${sec.id}">
      <h2>${esc(sec.title)}</h2>
      ${sec.blurb ? `<p class="secblurb">${esc(sec.blurb)}</p>` : ""}
      ${sec.entries.map(e => `
        <article class="file" id="${e.anchor}" data-path="${esc(e.rel)}">
          <header class="filehead">
            <h3><span class="dir">${esc(path.dirname(e.rel) === "." ? "" : path.dirname(e.rel) + "/")}</span>${esc(path.basename(e.rel))}</h3>
            <span class="meta">${e.lines} lines · ${e.lang}</span>
          </header>
          ${e.note ? `<p class="filenote">${esc(e.note)}</p>` : ""}
          ${codeBlock(e.src)}
        </article>`).join("")}
    </section>`).join("");

  const omitted = OMITTED.map(([rel, kind, why]) => {
    let size = "";
    try { size = (fs.statSync(path.join(ROOT, rel)).size / 1024).toFixed(0) + " KB"; } catch { size = "—"; }
    return `<tr><td><code>${esc(rel)}</code></td><td><span class="tag t-${kind}">${kind}</span></td>
            <td>${size}</td><td>${esc(why)}</td></tr>`;
  }).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aware — Codebook</title>
<style>
:root {
  --bg:#0b0f14; --panel:#121821; --card:#151c27; --line:#263041; --line-soft:#1c2432;
  --ink:#e7edf5; --dim:#9aa8bb; --faint:#62728a; --accent:#4fd1c5; --accent2:#2fe3c0;
  --code-bg:#0d131b; --mark:#f5a524;
}
@media print {
  :root { --bg:#fff; --panel:#fff; --card:#fff; --line:#ccc; --line-soft:#e5e5e5;
          --ink:#111; --dim:#444; --faint:#666; --accent:#0a6; --accent2:#085;
          --code-bg:#f7f7f7; }
  .sidebar, .topbar, .backtotop { display:none !important; }
  .wrap { display:block; }
  main { padding:0; }
  .file { break-inside:auto; }
  .filehead { break-after:avoid; }
  a { color:inherit; text-decoration:none; }
}
* { box-sizing:border-box; }
html,body { margin:0; padding:0; }
body {
  background:var(--bg); color:var(--ink);
  font:15px/1.62 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
}
a { color:var(--accent); text-decoration:none; }
a:hover { text-decoration:underline; }
code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.92em; }
p code, li code, td code { background:var(--code-bg); border:1px solid var(--line-soft);
  border-radius:4px; padding:1px 5px; color:var(--accent2); }

.topbar {
  position:sticky; top:0; z-index:20; background:rgba(11,15,20,.92);
  backdrop-filter:blur(8px); border-bottom:1px solid var(--line);
  padding:14px 22px; display:flex; align-items:center; gap:16px; flex-wrap:wrap;
}
.topbar h1 { font-size:17px; margin:0; font-weight:650; letter-spacing:-.01em; }
.topbar .sub { color:var(--faint); font-size:12.5px; }
.search { margin-left:auto; }
.search input {
  background:var(--card); border:1px solid var(--line); color:var(--ink);
  border-radius:8px; padding:7px 11px; font:inherit; font-size:13px; width:230px;
}
.search input:focus { outline:none; border-color:var(--accent); }

.wrap { display:grid; grid-template-columns:280px minmax(0,1fr); align-items:start; }
.sidebar {
  position:sticky; top:57px; max-height:calc(100vh - 57px); overflow:auto;
  border-right:1px solid var(--line); padding:18px 14px 40px; font-size:13px;
}
.sidebar h4 { margin:16px 0 6px; font-size:11px; letter-spacing:.09em;
  text-transform:uppercase; color:var(--faint); font-weight:600; }
.sidebar ul { list-style:none; margin:0; padding:0; }
.toc-sec > a { display:block; padding:5px 8px; border-radius:6px; font-weight:600; color:var(--ink); }
.toc-sec > a:hover { background:var(--card); text-decoration:none; }
.toc-sec ul { margin:0 0 8px 0; }
.toc-sec ul a {
  display:flex; justify-content:space-between; gap:8px; padding:3px 8px 3px 16px;
  border-radius:6px; color:var(--dim); font-family:ui-monospace,Menlo,monospace; font-size:11.5px;
}
.toc-sec ul a:hover { background:var(--card); color:var(--ink); text-decoration:none; }
.tl { color:var(--faint); flex:0 0 auto; }
.tf { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

main { padding:26px 30px 90px; max-width:1100px; }
h2 { font-size:23px; margin:44px 0 12px; letter-spacing:-.015em; scroll-margin-top:70px; }
h2:first-child { margin-top:6px; }
h3 { font-size:16.5px; margin:26px 0 8px; }
p { margin:0 0 12px; }
ul,ol { margin:0 0 14px; padding-left:22px; }
li { margin-bottom:5px; }
.lede { color:var(--dim); font-size:16px; border-left:3px solid var(--accent);
  padding-left:14px; margin:0 0 26px; }
.secblurb { color:var(--dim); margin-bottom:20px; max-width:80ch; }

.statgrid { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
  gap:10px; margin:0 0 30px; }
.stat { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:12px 14px; }
.stat b { display:block; font-size:22px; color:var(--accent2); letter-spacing:-.02em; }
.stat span { font-size:12px; color:var(--dim); }

.filesec { margin-top:52px; }
.file { margin:0 0 30px; border:1px solid var(--line); border-radius:10px;
  overflow:hidden; background:var(--panel); }
.filehead { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap;
  padding:11px 15px; background:var(--card); border-bottom:1px solid var(--line);
  position:sticky; top:57px; z-index:5; }
.file { scroll-margin-top:64px; }
.filehead h3 { margin:0; font-size:14px; font-family:ui-monospace,Menlo,monospace; font-weight:650; }
.filehead .dir { color:var(--faint); font-weight:400; }
.filehead .meta { margin-left:auto; font-size:11.5px; color:var(--faint); }
.filenote { padding:11px 15px 0; margin:0; color:var(--dim); font-size:13.5px; max-width:82ch; }

.code { display:flex; overflow-x:auto; background:var(--code-bg); margin:12px 0 0; }
.code pre { margin:0; font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  font-size:12.4px; line-height:1.55; }
.gutter { padding:14px 10px 14px 14px; text-align:right; color:var(--faint);
  border-right:1px solid var(--line-soft); user-select:none; flex:0 0 auto;
  background:var(--code-bg); position:sticky; left:0; }
.src { padding:14px 18px; flex:1 1 auto; }
.src code { white-space:pre; }

table { border-collapse:collapse; width:100%; font-size:13.5px; margin:0 0 20px; }
th,td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line-soft); vertical-align:top; }
th { color:var(--faint); font-size:11.5px; text-transform:uppercase; letter-spacing:.07em; }
.tag { font-size:11px; padding:2px 7px; border-radius:20px; border:1px solid var(--line);
  color:var(--dim); white-space:nowrap; }
.t-third-party { border-color:#7c5cff55; color:#a78bfa; }
.t-generated { border-color:#f5a52455; color:var(--mark); }
.t-data { border-color:#4fd1c555; color:var(--accent); }
.t-binary { border-color:var(--line); }

.backtotop { position:fixed; right:18px; bottom:18px; background:var(--card);
  border:1px solid var(--line); color:var(--dim); border-radius:8px;
  padding:8px 12px; font-size:12.5px; cursor:pointer; }
.backtotop:hover { color:var(--ink); border-color:var(--accent); }
.hidden { display:none !important; }

@media (max-width:900px) {
  .wrap { grid-template-columns:1fr; }
  .sidebar { position:static; max-height:none; border-right:none;
    border-bottom:1px solid var(--line); }
  main { padding:20px 16px 60px; }
  .filehead { position:static; }
  .search input { width:100%; }
  .search { margin-left:0; width:100%; }
}
</style>
</head>
<body>

<div class="topbar">
  <h1>🛰️ Aware — Codebook</h1>
  <span class="sub">${esc(git.branch || "")}${git.commit ? " · " + esc(git.commit) : ""}${git.date ? " · " + esc(git.date) : ""}</span>
  <div class="search"><input type="search" id="q" placeholder="Filter files…" aria-label="Filter files"></div>
</div>

<div class="wrap">
  <nav class="sidebar">
    <h4>Overview</h4>
    <ul class="toc-sec">
      <li><a href="#what">What Aware is</a></li>
      <li><a href="#modes">The two chat modes</a></li>
      <li><a href="#agent-loop">The investigation agent</a></li>
      <li><a href="#proxy">The server proxy</a></li>
      <li><a href="#directory">The directory</a></li>
      <li><a href="#mobile">Phones that lie</a></li>
      <li><a href="#deploy">Running it</a></li>
      <li><a href="#limits">Deliberate limits</a></li>
    </ul>
    <h4>Source</h4>
    <ul id="toc">${toc}</ul>
    <h4>Not included</h4>
    <ul class="toc-sec"><li><a href="#omitted">Generated &amp; vendored files</a></li></ul>
  </nav>

  <main>
    <p class="lede">Every hand-written source file in the Aware project, in full, with a
    tour of what the site does and why it is built this way. Generated data and vendored
    libraries are listed at the end rather than inlined.</p>

    <div class="statgrid">
      <div class="stat"><b>${(st.dirTools || 0).toLocaleString()}</b><span>tools indexed</span></div>
      <div class="stat"><b>${st.agentTools || 0}</b><span>callable by the agent</span></div>
      <div class="stat"><b>${st.sources || 0}</b><span>proxied sources</span></div>
      <div class="stat"><b>${st.keyless || 0}</b><span>need no API key</span></div>
      <div class="stat"><b>${present.length}</b><span>files included</span></div>
      <div class="stat"><b>${totalLines.toLocaleString()}</b><span>lines of source</span></div>
    </div>

    ${FEATURES(st)}

    ${body}

    <section id="omitted" class="filesec">
      <h2>Not included in this document</h2>
      <p class="secblurb">Generated data and third-party libraries. Together these are
      roughly 1.5 MB, none of it hand-edited, and two of them are rebuilt by the scripts
      above. Licences for the vendored libraries live beside them in
      <code>assets/vendor/</code>.</p>
      <table>
        <thead><tr><th>File</th><th>Kind</th><th>Size</th><th>Why it is out</th></tr></thead>
        <tbody>${omitted}</tbody>
      </table>
    </section>
  </main>
</div>

<button class="backtotop" id="top">↑ Top</button>

<script>
document.getElementById("top").addEventListener("click", () =>
  window.scrollTo({ top: 0, behavior: "smooth" }));

// Filter both the file sections and the sidebar by path.
const q = document.getElementById("q");
q.addEventListener("input", () => {
  const term = q.value.trim().toLowerCase();
  document.querySelectorAll(".file").forEach(f => {
    const hit = !term || f.dataset.path.toLowerCase().includes(term);
    f.classList.toggle("hidden", !hit);
  });
  document.querySelectorAll("#toc .toc-sec ul li").forEach(li => {
    const t = li.textContent.toLowerCase();
    li.classList.toggle("hidden", !!term && !t.includes(term));
  });
  document.querySelectorAll(".filesec").forEach(sec => {
    if (sec.id === "omitted") return;
    const any = [...sec.querySelectorAll(".file")].some(f => !f.classList.contains("hidden"));
    sec.classList.toggle("hidden", !any);
  });
});
</script>
</body>
</html>`;
}

fs.writeFileSync(OUT, build());
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`Wrote ${OUT} (${kb} KB)`);

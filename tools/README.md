# Dataset build scripts

`assets/js/tools-data.js` is generated, not edited by hand. These two scripts
rebuild it from the upstream awesome-OSINT collections.

## Rebuild

```sh
cd tools
mkdir -p lists

curl -sSL -o lists/awesome-osint-edwardtay.md https://raw.githubusercontent.com/edwardtay/awesome-OSINT/main/README.md
curl -sSL -o lists/cipher387-tools.md         https://raw.githubusercontent.com/cipher387/osint_stuff_tool_collection/main/README.md
curl -sSL -o lists/awesome-osint-jivoi.md     https://raw.githubusercontent.com/jivoi/awesome-osint/master/README.md
curl -sSL -o lists/osint-collection.md        https://raw.githubusercontent.com/Ph055a/OSINT_Collection/master/README.md

node parse-lists.js     # lists/*.md  -> parsed.json
node generate-data.js   # parsed.json + existing curated entries -> ../assets/js/tools-data.js
```

## What each does

**`parse-lists.js`** — one unified pass per file. The four lists use different
markdown conventions, so the parser handles all of them together:

- headings as both ATX (`## Section`) *and* Setext (`Section` underlined with
  `===`) — cipher387 switches styles halfway through, and missing that silently
  attributes ~600 lines to the wrong section
- entries as both table rows (`| [Name](url) | Description |`) and bullets
  (`* [Name](url) - Description`)
- skips tables of contents, badges, anchors and non-tool meta links

Deduplicates by normalized URL (protocol, `www.`, trailing slash and query
stripped), keeping whichever copy has the longer description — as a whole record,
never merging fields across sources, which would scramble section attribution.

**`generate-data.js`** — maps the ~260 upstream section headings onto this site's
44 categories via ordered regex rules (first match wins; anything unmatched lands
in Frameworks/All-in-One). Existing hand-written entries are read back out of the
current `tools-data.js` and win on URL collision, so their curated descriptions and
tags survive a rebuild.

## Adding tools by hand

Hand-written entries are preserved across rebuilds, so you can add them straight
to `assets/js/tools-data.js`. Mark them so they're recognized as curated:

```js
{ name: "Tool Name", url: "https://…", desc: "One-line description.",
  tags: ["keyword", "…"], curated: true }
```

Tags feed both the directory search and the local chatbot matcher.

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

## Rebuilding the phone area-code table

`assets/js/area-codes.js` maps NANP area codes to region and cities, and is built
from the public
[Area-Code-Geolocation-Database](https://github.com/ravisorg/Area-Code-Geolocation-Database):

```sh
cd tools
curl -sSL -o lists/areacodes.csv    https://raw.githubusercontent.com/ravisorg/Area-Code-Geolocation-Database/master/us-area-code-cities.csv
curl -sSL -o lists/areacodes-ca.csv https://raw.githubusercontent.com/ravisorg/Area-Code-Geolocation-Database/master/ca-area-code-cities.csv
node build-areacodes.js
```

`assets/vendor/libphonenumber-max.js` is the unmodified browser bundle from
`libphonenumber-js` (Apache-2.0, license alongside it). Update it with
`npm pack libphonenumber-js` and copy `bundle/libphonenumber-max.js`.

## Adding tools by hand

Hand-written entries are preserved across rebuilds, so you can add them straight
to `assets/js/tools-data.js`. Mark them so they're recognized as curated:

```js
{ name: "Tool Name", url: "https://…", desc: "One-line description.",
  tags: ["keyword", "…"], curated: true }
```

Tags feed both the directory search and the local chatbot matcher.

## build-codebook.js

Builds `aware-codebook.html`: a single self-contained document holding every
hand-written source file in the project, plus a written tour of what the site
does. Open it in a browser, or print it to PDF.

```
npm run codebook              # writes aware-codebook.html in the repo root
node tools/build-codebook.js path/to/out.html
```

Generated data and vendored libraries are listed in the document but not inlined
— together they are ~1.5 MB of material nobody reads, and two of them are rebuilt
by the other scripts here. The counts on the cover (tools indexed, tools the agent
can call, proxied sources) are read out of the source at build time, so they stay
honest as the project changes.

The output is gitignored. Rebuild it after changes rather than committing a copy
that goes stale.

## build-bundle.js

Builds `aware-bundle.txt`: every hand-written source file concatenated into one
plain-text file, for pasting somewhere whole — another assistant, a gist, an
email.

```
npm run bundle                     # writes aware-bundle.txt in the repo root
node tools/build-bundle.js out.txt --all
```

Each file sits between `>>>>> FILE: <path>` and `<<<<< END: <path>` markers.
Everything strictly between them is the file, byte for byte — the end marker is
there so trailing blank lines are unambiguous and a naive split is exact. The
round trip is verified: extracting all 25 files reproduces them byte-identically
and the rebuilt tree boots.

By default the generated data and vendored libraries are listed but not included
— `tools-data.js` alone is 869 KB, which takes the bundle past anything you could
paste. `--all` includes them, at which point it is an archive rather than
something to paste.

The file manifest is shared with `build-codebook.js` through `manifest.js`, so the
two can never disagree about what "all the code" means.

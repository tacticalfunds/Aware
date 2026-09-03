/**
 * Which files make up the project, and which are deliberately left out.
 *
 * Shared by build-codebook.js (the HTML document) and build-bundle.js (the plain
 * text bundle) so the two can never disagree about what "all the code" means.
 */

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
      ["server.js", "Static host, the 55-source lookup proxy with mirror failover, caching, response-size ceilings and per-source body reduction, username enumeration across 716 sites, basemap tile proxy, and the allowlisted image fetcher."],
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
      ["assets/js/agent.js", "The loop itself, the system prompt with the investigation method, the tool-group registry, history trimming, model routing, cost metering, and the network and identity tools."],
      ["assets/js/entities.js", "Collects the coordinates, domains, addresses and names an investigation turns up, each tagged with the tool that produced it and the step it appeared at, so the write-up can be audited rather than taken on trust."]
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
      ["assets/js/tools/visual.js", "The two tools that let the agent show its reasoning: annotated boxes over the photo, and the survey-style plan view."],
      ["assets/js/tools/records.js", "Public-record lookups the agent runs itself rather than linking to: academic output, ORCID researchers, the GLEIF company register, CVEs, npm and PyPI packages, GitLab and fediverse accounts, books, and country reference data."]
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

module.exports = { SECTIONS, OMITTED };

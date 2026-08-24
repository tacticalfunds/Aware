/**
 * Aware OSINT Concierge — a chat interface over the OSINT_TOOLS_FLAT directory.
 *
 * Two modes:
 *  - Local mode (default, no key required): keyword/intent matching against the
 *    tool database plus a small library of pre-written investigation workflows.
 *  - AI mode (optional): if the user supplies their own Anthropic API key, we
 *    call the Claude API directly from the browser so responses become free-form
 *    natural language, grounded on the same tool database as context.
 */

const STOPWORDS = new Set([
  "a","an","the","is","are","was","were","to","for","of","in","on","at","by","with",
  "i","me","my","how","do","does","can","you","help","find","need","want","please",
  "someone's","someones","it","and","or","that","this","what","which","who","using"
]);

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s@._-]/g, " ")
    .split(/\s+/)
    .filter(t => t && !STOPWORDS.has(t));
}

// Hand-written investigation workflows: matched by trigger keywords, each
// chains several categories together in a sensible investigative order.
const WORKFLOWS = [
  {
    triggers: ["investigate a person", "find someone", "background check", "who is this person", "locate a person", "person of interest"],
    title: "Investigating a person",
    steps: [
      { text: "Start broad: run their name through people-search engines.", categoryId: "people" },
      { text: "Check usernames they're known to use across platforms.", categoryId: "username" },
      { text: "Pivot to social media profiles for activity and connections.", categoryId: "social-media" },
      { text: "If you have an email or phone, check it for breaches and reputation.", categoryId: "email-breach" }
    ]
  },
  {
    triggers: ["username", "handle", "social media account", "find their profile"],
    title: "Tracing a username across platforms",
    steps: [
      { text: "Run automated username enumeration first.", categoryId: "username" },
      { text: "Confirm hits manually on the matching social platforms.", categoryId: "social-media" },
      { text: "Reverse-search their profile photo to find reused images.", categoryId: "images" }
    ]
  },
  {
    triggers: ["email address", "breach", "leaked password", "data leak", "pwned"],
    title: "Investigating an email address",
    steps: [
      { text: "Check it against known breach databases.", categoryId: "email-breach" },
      { text: "See which accounts/services the email is registered on.", categoryId: "email-breach" },
      { text: "Search the domain side if it's a company address.", categoryId: "domain-network" }
    ]
  },
  {
    triggers: ["phone number", "caller id", "who called me"],
    title: "Investigating a phone number",
    steps: [
      { text: "Run a reverse phone lookup for name/carrier.", categoryId: "phone" },
      { text: "Cross-check the number against breach/leak databases.", categoryId: "email-breach" },
      { text: "Search the raw number in quotes on general search engines.", categoryId: "search-engines" }
    ]
  },
  {
    triggers: ["verify an image", "reverse image", "is this photo real", "fake photo", "photoshopped", "manipulated image", "deepfake"],
    title: "Verifying an image",
    steps: [
      { text: "Reverse-image search to find the earliest/original source.", categoryId: "images" },
      { text: "Run forensic analysis to check for edits (ELA, clone detection).", categoryId: "images" },
      { text: "If it's outdoors, use shadows/landmarks to verify location and time.", categoryId: "geolocation" }
    ]
  },
  {
    triggers: ["geolocate", "where was this taken", "find the location", "geoint", "satellite"],
    title: "Geolocating a photo or video",
    steps: [
      { text: "Look for landmarks, signage and terrain, then cross-reference maps/satellite imagery.", categoryId: "geolocation" },
      { text: "Use sun position/shadow calculators to narrow down time of day.", categoryId: "geolocation" },
      { text: "Check street-level imagery services for a visual match.", categoryId: "geolocation" }
    ]
  },
  {
    triggers: ["domain", "website owner", "who owns this site", "ip address", "subdomain", "server"],
    title: "Investigating a domain or IP",
    steps: [
      { text: "Pull WHOIS registration and DNS history.", categoryId: "domain-network" },
      { text: "Enumerate subdomains and exposed infrastructure.", categoryId: "domain-network" },
      { text: "Check the site's past versions in web archives.", categoryId: "archives" },
      { text: "Scan for malware/reputation issues if it looks suspicious.", categoryId: "threat-intel" }
    ]
  },
  {
    triggers: ["company", "business records", "corporate", "who owns this company", "due diligence"],
    title: "Researching a company",
    steps: [
      { text: "Look up official registration and filings.", categoryId: "business" },
      { text: "Check the company's web/domain footprint.", categoryId: "domain-network" },
      { text: "Search news and media coverage for red flags.", categoryId: "media-verification" }
    ]
  },
  {
    triggers: ["crypto wallet", "bitcoin address", "ethereum address", "trace crypto", "blockchain"],
    title: "Tracing a cryptocurrency address",
    steps: [
      { text: "Look the address up on a blockchain explorer for transaction history.", categoryId: "crypto" },
      { text: "Check for entity attribution (exchange, known actor).", categoryId: "crypto" },
      { text: "Cluster related addresses that may belong to the same wallet.", categoryId: "crypto" }
    ]
  },
  {
    triggers: ["license plate", "number plate", "vin", "vehicle", "identify a car", "trace a car", "who owns this car"],
    title: "Investigating a vehicle, plate or VIN",
    steps: [
      { text: "If you only have a photo, read the plate and identify the make/model first.", categoryId: "vehicle" },
      { text: "Decode the VIN for specs, then check theft/salvage and auction history.", categoryId: "vehicle" },
      { text: "Country matters — plate formats and official registries differ per jurisdiction.", categoryId: "vehicle" },
      { text: "If the photo is your only lead, geolocate it too — background clues often beat the plate.", categoryId: "geolocation" }
    ]
  },
  {
    triggers: ["flight", "aircraft", "tail number", "track a plane", "aviation"],
    title: "Tracking an aircraft",
    steps: [
      { text: "Track the live/historical flight path by callsign or registration.", categoryId: "aviation" },
      { text: "Look up the registration for owner and airframe details.", categoryId: "aviation" },
      { text: "Photo databases can confirm the specific airframe and its liveries over time.", categoryId: "aviation" }
    ]
  },
  {
    triggers: ["ship", "vessel", "imo number", "track a boat", "maritime"],
    title: "Tracking a vessel",
    steps: [
      { text: "Track live AIS position and port-call history by name or IMO number.", categoryId: "maritime" },
      { text: "Pull registered ownership and management from the ship registry.", categoryId: "maritime" },
      { text: "Cross-check the operating company against corporate records.", categoryId: "business" }
    ]
  },
  {
    triggers: ["wifi", "ssid", "cell tower", "bssid", "wireless network"],
    title: "Geolocating a wireless network",
    steps: [
      { text: "Look the SSID/BSSID up in crowdsourced wardriving databases.", categoryId: "wireless-rf" },
      { text: "For cell IDs, map the tower against open cell databases.", categoryId: "wireless-rf" },
      { text: "Confirm the resulting location against maps and imagery.", categoryId: "geolocation" }
    ]
  },
  {
    triggers: ["dark web", "onion site", "darknet"],
    title: "Searching the dark web",
    steps: [
      { text: "You'll need Tor Browser to reach .onion sites at all.", categoryId: "darkweb" },
      { text: "Use a dark-web-specific search engine rather than Google.", categoryId: "darkweb" },
      { text: "Cross-check any leaked data found against breach databases.", categoryId: "email-breach" }
    ]
  },
  {
    triggers: ["fake news", "verify a video", "fact check", "misinformation", "is this true"],
    title: "Verifying news or a video",
    steps: [
      { text: "Run the video/image through a verification toolset first.", categoryId: "media-verification" },
      { text: "Check if it's already been fact-checked.", categoryId: "media-verification" },
      { text: "Reverse-search key frames as images to find the original.", categoryId: "images" }
    ]
  }
];

function findWorkflow(query) {
  const q = query.toLowerCase();
  let best = null, bestScore = 0;
  for (const wf of WORKFLOWS) {
    for (const trig of wf.triggers) {
      if (q.includes(trig)) {
        const score = trig.length;
        if (score > bestScore) { bestScore = score; best = wf; }
      }
    }
  }
  return best;
}

function scoreTool(tool, tokens) {
  const haystack = `${tool.name} ${tool.desc} ${tool.category} ${tool.tags.join(" ")}`.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (haystack.includes(t)) score += 1;
    if (tool.tags.includes(t)) score += 2;
    if (tool.name.toLowerCase().includes(t)) score += 2;
  }
  return score;
}

function searchTools(query, limit = 6) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const scored = OSINT_TOOLS_FLAT
    .map(tool => ({ tool, score: scoreTool(tool, tokens) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.tool);
}

function findCategoryMention(query) {
  const q = query.toLowerCase();
  return OSINT_CATEGORIES.find(cat =>
    q.includes(cat.name.toLowerCase()) || q.includes(cat.id.replace(/-/g, " "))
  ) || null;
}

const GREETINGS = ["hi", "hello", "hey", "yo", "sup", "hiya"];
const THANKS = ["thanks", "thank you", "thx", "appreciate"];

/**
 * Produces a structured local response: { text, toolCards: Tool[] }
 */
function buildLocalResponse(query) {
  const q = query.trim().toLowerCase();

  if (GREETINGS.some(g => q === g || q.startsWith(g + " ") || q.startsWith(g + "!"))) {
    return {
      text: "Hey — I'm the Aware OSINT concierge. Tell me what you're trying to investigate (a person, an email, a domain, an image, a crypto address...) and I'll point you at the right tools, or ask \"what can you help with\" for a tour.",
      toolCards: []
    };
  }
  if (THANKS.some(t => q.includes(t))) {
    return { text: "Anytime. Good luck with the investigation — ping me if you need another angle.", toolCards: [] };
  }
  if (q.includes("what can you") || q.includes("what do you do") || q.includes("help me") && q.length < 20) {
    return {
      text: `I can recommend tools from a directory of ${OSINT_TOOLS_FLAT.length}+ OSINT resources across ${OSINT_CATEGORIES.length} categories — things like people search, username tracing, breach/email lookups, geolocation, domain recon, dark web, and crypto tracing. Just describe your task in plain English, e.g. "how do I find who owns this domain" or "verify if this photo is real".`,
      toolCards: []
    };
  }

  const category = findCategoryMention(q);
  const workflow = findWorkflow(q);

  if (workflow) {
    const toolCards = [];
    const lines = workflow.steps.map(step => {
      const cat = OSINT_CATEGORIES.find(c => c.id === step.categoryId);
      const pick = cat ? cat.tools.slice(0, 2) : [];
      toolCards.push(...pick);
      return `• ${step.text}`;
    });
    const dedup = Array.from(new Map(toolCards.map(t => [t.url, t])).values());
    return {
      text: `**${workflow.title}** — here's a workflow:\n${lines.join("\n")}`,
      toolCards: dedup.slice(0, 6)
    };
  }

  if (category) {
    return {
      text: `${category.icon} **${category.name}** — here are tools in that category:`,
      toolCards: category.tools.slice(0, 8)
    };
  }

  const matches = searchTools(q, 6);
  if (matches.length > 0) {
    return {
      text: `Here's what I found that's relevant:`,
      toolCards: matches
    };
  }

  return {
    text: "I couldn't match that to anything specific. Try naming what you have (an email, username, phone, domain, image, crypto address...) or what you're trying to do (verify, locate, trace, background check). You can also browse categories in the directory below.",
    toolCards: []
  };
}

/**
 * AI mode: calls the Claude API directly from the browser using a
 * user-supplied API key (never sent anywhere except the official Anthropic
 * endpoint, and only ever stored in this browser's localStorage).
 */
async function askClaude(apiKey, model, history, userQuery) {
  const candidates = searchTools(userQuery, 20);
  const contextLines = candidates
    .map(t => `- ${t.name} (${t.category}) — ${t.url} — ${t.desc}`)
    .join("\n");

  const systemPrompt = `You are the Aware OSINT concierge, embedded in an OSINT tools directory website.
Help the user pick the right open-source-intelligence tools and outline a short investigative workflow.
Only recommend tools that are legitimate and used for lawful research, journalism, security research, or
personal safety — decline anything about stalking, harassment, or targeting private individuals without
a lawful basis, and say so briefly.
When relevant, ground your answer in this subset of the site's tool directory (cite tool names and URLs
as markdown links). If nothing here fits, answer from general OSINT knowledge instead.

Relevant tools for this query:
${contextLines || "(no close matches found in the directory)"}

Keep answers concise (under ~180 words) and practical.`;

  const messages = [...history, { role: "user", content: userQuery }];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    body: JSON.stringify({
      model,
      max_tokens: 600,
      system: systemPrompt,
      messages
    })
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Claude API error ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.content || []).map(b => b.text || "").join("").trim();
  return text || "(empty response)";
}

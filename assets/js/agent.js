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

const AGENT_MAX_STEPS = 12;
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

const AGENT_TOOLS = [
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

async function executeAgentTool(name, input, liveKeys) {
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

Method:
- Start by stating briefly what you're going to check, then use tools. Don't ask
  permission between steps — the user has already asked you to investigate.
- Pull identifiers out of the task yourself (domains, IPs, wallet addresses, emails)
  and look them up. If an image is attached, describe what you can actually see in
  it that is investigatively useful: signage, languages, architecture, road markings,
  vehicle models, vegetation, terrain, sun/shadow direction, business names.
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
async function runInvestigation({ apiKey, model, task, image, liveKeys = {}, onEvent = () => {}, history = [] }) {
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
        const out = await executeAgentTool(call.name, call.input, liveKeys);
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

  onEvent({ type: "text", text: `_Stopped after ${AGENT_MAX_STEPS} steps to bound cost. Ask me to continue if you want more._` });
  onEvent({ type: "done" });
}

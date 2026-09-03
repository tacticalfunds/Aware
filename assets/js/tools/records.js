/**
 * Public-record lookups.
 *
 * The directory lists 3,469 tools and the agent could only ever hand you a link
 * to almost all of them. These are the entries that turned out to have a
 * genuinely key-free API, so the agent runs them itself instead: academic
 * output, corporate identity, vulnerabilities, package registries, books,
 * country reference data and fediverse accounts.
 *
 * Everything here needs no credentials at all. Anything requiring a key belongs
 * in the keyed section of server.js, and anything with no API at all stays a
 * handoff through request_manual_lookup.
 */

/** Shortens a field to something readable in a tool result without losing sense. */
const clip = (v, n = 160) => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};

/*
 * "No such record" is an answer, not a failure. These registries 404 rather than
 * returning an empty result, and letting that surface as a thrown tool error tells
 * the agent the lookup broke — so it retries, or hedges, instead of recording the
 * absence it was actually given.
 */
async function orNothing(promise, missing) {
  try {
    return await promise;
  } catch (err) {
    if (err && err.status === 404) return { __missing: missing };
    throw err;
  }
}

const RECORD_TOOLS = [
  {
    name: "academic_search",
    description:
      "Searches scholarly literature by topic, title or author name across OpenAlex (~250M works) and Crossref. " +
      "Use it to place a person in a field, date a piece of research, find an institutional affiliation, or resolve a DOI to its metadata. " +
      "An author's publication record is often the most reliable public timeline of where they worked and when.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Title, topic or author name." },
        doi: { type: "string", description: "A specific DOI to resolve instead of searching." },
        limit: { type: "number", description: "Results to return, 1-20. Default 8." }
      }
    }
  },
  {
    name: "researcher_lookup",
    description:
      "Finds a researcher's ORCID record and OpenAlex profile by name: their institutions, publication counts and identifiers. " +
      "ORCID iDs are self-registered and persistent, so they tie a name to a body of work more firmly than a search engine can.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Researcher name, e.g. 'Jane Q. Smith'." },
        limit: { type: "number", description: "Results to return, 1-20. Default 8." }
      },
      required: ["name"]
    }
  },
  {
    name: "company_lookup",
    description:
      "Looks up a company in the Global LEI index — the registry banks and regulators use to identify legal entities. " +
      "Returns the registered legal name, jurisdiction, registered address and status, and the parent relationships where they are declared. " +
      "Stronger than a web search for corporate identity: an LEI is issued against verified registration documents.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Legal or trading name." },
        lei: { type: "string", description: "A specific 20-character LEI to fetch instead of searching." },
        limit: { type: "number", description: "Results to return, 1-20. Default 8." }
      }
    }
  },
  {
    name: "cve_lookup",
    description:
      "Looks up a vulnerability in the US National Vulnerability Database by CVE ID, or searches by keyword. " +
      "Returns the description, severity scores and publication dates. Use it when a scan result, version banner or advisory names a CVE and you need to know what it actually is.",
    input_schema: {
      type: "object",
      properties: {
        cve: { type: "string", description: "A CVE identifier, e.g. CVE-2021-44228." },
        query: { type: "string", description: "Keyword search instead of an ID." },
        limit: { type: "number", description: "Results for a keyword search, 1-20. Default 5." }
      }
    }
  },
  {
    name: "package_lookup",
    description:
      "Fetches a published package from npm or PyPI: description, versions, release dates, homepage, repository and declared maintainers. " +
      "Maintainer names and repository URLs are a common pivot from a piece of software back to the people who publish it, and the release history dates a project.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Package name." },
        ecosystem: { type: "string", enum: ["npm", "pypi"], description: "Which registry. Default npm." }
      },
      required: ["name"]
    }
  },
  {
    name: "gitlab_lookup",
    description:
      "Looks up a GitLab account by username: profile, join date, location and bio, plus their most recently updated public projects. " +
      "The counterpart to github_lookup — plenty of people use only one of the two, so a miss on GitHub is not an absence.",
    input_schema: {
      type: "object",
      properties: { username: { type: "string" } },
      required: ["username"]
    }
  },
  {
    name: "mastodon_lookup",
    description:
      "Looks up a fediverse account on a named instance: display name, bio, join date, follower and post counts, and whether it is a bot. " +
      "Fediverse handles are @user@instance, so the instance is required — it is where the account actually lives.",
    input_schema: {
      type: "object",
      properties: {
        username: { type: "string", description: "The local part, without the leading @." },
        instance: { type: "string", description: "The instance hostname, e.g. mastodon.social." }
      },
      required: ["username", "instance"]
    }
  },
  {
    name: "book_search",
    description:
      "Searches Open Library by title, author or subject: editions, publication years, publishers and identifiers. " +
      "Useful for dating an edition seen in a photograph, or placing an author's output in time.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number", description: "Results to return, 1-20. Default 8." }
      },
      required: ["query"]
    }
  },
  {
    name: "country_facts",
    description:
      "Reference data for a country: official names, capital, region, languages, currencies, calling code, timezones, driving side and neighbours. " +
      "In a geolocation this settles the mechanical questions early — which side of the road, what the phone prefix looks like, which languages a sign might be in.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "Country name, common or official." } },
      required: ["name"]
    }
  }
];

const RECORD_EXECUTORS = {
  async academic_search(input) {
    if (input.doi) {
      const body = await orNothing(Proxy.lookup("crossref", { doi: input.doi }), true);
      const w = body?.__missing ? null : body?.message;
      if (!w) return `No Crossref record for DOI ${input.doi}.`;
      return [
        `${clip(w.title?.[0] || "(untitled)", 200)}`,
        `DOI: ${w.DOI}`,
        w.author?.length ? `Authors: ${w.author.slice(0, 12).map(a => clip(`${a.given || ""} ${a.family || ""}`.trim(), 60)).join(", ")}` : null,
        w["container-title"]?.[0] ? `Published in: ${clip(w["container-title"][0])}` : null,
        w.published?.["date-parts"]?.[0]
          ? `Date: ${w.published["date-parts"][0].map((n, i) => (i ? String(n).padStart(2, "0") : n)).join("-")}`
          : null,
        w.publisher ? `Publisher: ${clip(w.publisher)}` : null,
        w.URL ? `URL: ${w.URL}` : null
      ].filter(Boolean).join("\n");
    }

    const q = String(input.query || "").trim();
    if (!q) return "academic_search needs a query or a doi.";
    const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 20);

    const body = await Proxy.lookup("openalex_works", { q, limit });
    const works = body?.results || [];
    if (!works.length) return `No works found for “${q}” in OpenAlex.`;

    return `${body.meta?.count ?? works.length} work(s) matched “${q}” — showing ${works.length} (OpenAlex):\n\n` +
      works.map((w, i) => {
        const authors = (w.authorships || []).slice(0, 6)
          .map(a => a.author?.display_name).filter(Boolean).join(", ");
        const insts = [...new Set((w.authorships || [])
          .flatMap(a => (a.institutions || []).map(x => x.display_name)).filter(Boolean))].slice(0, 3);
        return `${i + 1}. ${clip(w.display_name, 180)}\n` +
          `   ${w.publication_year || "year unknown"}` +
          (w.cited_by_count != null ? ` · cited ${w.cited_by_count}x` : "") +
          (w.doi ? `\n   ${w.doi}` : "") +
          (authors ? `\n   Authors: ${clip(authors, 200)}` : "") +
          (insts.length ? `\n   Institutions: ${clip(insts.join(", "), 160)}` : "");
      }).join("\n");
  },

  async researcher_lookup(input) {
    const name = String(input.name || "").trim();
    if (!name) return "researcher_lookup needs a name.";
    const limit = Math.min(Math.max(Number(input.limit) || 8, 1), 20);

    const out = [];

    try {
      const orcid = await Proxy.lookup("orcid", { q: name, limit });
      const hits = orcid?.["expanded-result"] || [];
      out.push(hits.length
        ? `ORCID — ${orcid["num-found"]} record(s), showing ${hits.length}:\n` +
          hits.map(h => `  ${[h["given-names"], h["family-names"]].filter(Boolean).join(" ")} — ${h["orcid-id"]}` +
            (h["institution-name"]?.length ? `\n    ${clip(h["institution-name"].slice(0, 3).join("; "), 160)}` : "")).join("\n")
        : `ORCID — no records for “${name}”.`);
    } catch (err) {
      out.push(`ORCID lookup failed: ${err.message}`);
    }

    try {
      const oa = await Proxy.lookup("openalex_authors", { q: name, limit });
      const authors = oa?.results || [];
      out.push(authors.length
        ? `OpenAlex — ${authors.length} author profile(s):\n` +
          authors.map(a => `  ${a.display_name} — ${a.works_count} works, cited ${a.cited_by_count}x` +
            (a.last_known_institutions?.[0]?.display_name
              ? `\n    ${clip(a.last_known_institutions[0].display_name)}` +
                (a.last_known_institutions[0].country_code ? ` (${a.last_known_institutions[0].country_code})` : "")
              : "") +
            (a.orcid ? `\n    ${a.orcid}` : "")).join("\n")
        : `OpenAlex — no author profiles for “${name}”.`);
    } catch (err) {
      out.push(`OpenAlex author lookup failed: ${err.message}`);
    }

    return out.join("\n\n") +
      `\n\nA name is not an identity: several people share most names. Treat an ORCID iD or an OpenAlex ` +
      `author ID as the thing that identifies someone, and say which record you are relying on.`;
  },

  async company_lookup(input) {
    const params = input.lei ? { lei: input.lei } : { q: String(input.name || "").trim(), limit: Math.min(Number(input.limit) || 8, 20) };
    if (!params.lei && !params.q) return "company_lookup needs a name or an lei.";

    const body = await orNothing(Proxy.lookup("gleif", params), true);
    const rows = body?.__missing ? []
      : Array.isArray(body?.data) ? body.data : body?.data ? [body.data] : [];
    if (!rows.length) return `No LEI record found for ${input.lei || `“${input.name}”`}.`;

    return `${rows.length} LEI record(s):\n\n` + rows.map((r, i) => {
      const a = r.attributes || {};
      const e = a.entity || {};
      const addr = e.legalAddress || {};
      return `${i + 1}. ${clip(e.legalName?.name || "(no name)", 140)}\n` +
        `   LEI: ${a.lei}\n` +
        `   Status: ${e.status || "?"} · registration ${a.registration?.status || "?"}\n` +
        (e.jurisdiction ? `   Jurisdiction: ${e.jurisdiction}\n` : "") +
        (addr.addressLines?.length || addr.city
          ? `   Address: ${clip([...(addr.addressLines || []), addr.city, addr.region, addr.postalCode, addr.country].filter(Boolean).join(", "), 180)}\n`
          : "") +
        (e.legalForm?.id ? `   Legal form: ${e.legalForm.id}\n` : "");
    }).join("\n") +
      `\nAn LEI is issued against verified registration documents, so the legal name and address here are ` +
      `stronger evidence than a website's about page. A lapsed registration status is itself a finding.`;
  },

  async cve_lookup(input) {
    const params = input.cve ? { cve: input.cve } : { q: String(input.query || "").trim(), limit: Math.min(Number(input.limit) || 5, 20) };
    if (!params.cve && !params.q) return "cve_lookup needs a cve id or a query.";

    const body = await Proxy.lookup("nvd_cve", params);
    const items = body?.vulnerabilities || [];
    if (!items.length) return `No NVD record for ${input.cve || `“${input.query}”`}.`;

    return `${body.totalResults ?? items.length} result(s), showing ${items.length}:\n\n` +
      items.map(({ cve }) => {
        const desc = (cve.descriptions || []).find(d => d.lang === "en")?.value;
        const metric =
          cve.metrics?.cvssMetricV31?.[0] || cve.metrics?.cvssMetricV30?.[0] || cve.metrics?.cvssMetricV2?.[0];
        const cvss = metric?.cvssData;
        return `${cve.id} — published ${String(cve.published || "").slice(0, 10)}\n` +
          (cvss ? `   CVSS ${cvss.baseScore} ${cvss.baseSeverity || ""} (${cvss.version})\n` : "") +
          (desc ? `   ${clip(desc, 320)}\n` : "");
      }).join("\n");
  },

  async package_lookup(input) {
    const name = String(input.name || "").trim();
    if (!name) return "package_lookup needs a package name.";
    const eco = input.ecosystem === "pypi" ? "pypi" : "npm";

    if (eco === "pypi") {
      const body = await orNothing(Proxy.lookup("pypi_package", { name }), true);
      const i = body?.__missing ? null : body?.info;
      if (!i) return `No PyPI package named “${name}”. Try the npm registry, or a different spelling — ` +
        `PyPI names use hyphens where the import name often uses underscores.`;
      const releases = body.releaseCount ?? Object.keys(body.releases || {}).length;
      const newest = body.urls?.[0]?.upload_time_iso_8601;
      return [
        `PyPI: ${i.name} ${i.version}`,
        i.summary ? `   ${clip(i.summary, 200)}` : null,
        i.author || i.author_email ? `   Author: ${clip([i.author, i.author_email].filter(Boolean).join(" "), 120)}` : null,
        i.maintainer || i.maintainer_email ? `   Maintainer: ${clip([i.maintainer, i.maintainer_email].filter(Boolean).join(" "), 120)}` : null,
        i.home_page ? `   Home: ${i.home_page}` : null,
        i.project_urls ? `   Links: ${clip(Object.entries(i.project_urls).map(([k, v]) => `${k}=${v}`).join(", "), 240)}` : null,
        i.license ? `   Licence: ${clip(i.license, 80)}` : null,
        releases ? `   ${releases} released version(s)` + (newest ? `, latest uploaded ${newest.slice(0, 10)}` : "") : null
      ].filter(Boolean).join("\n");
    }

    const body = await orNothing(Proxy.lookup("npm_package", { name }), true);
    if (!body || body.__missing || body.error) return `No npm package named “${name}”.`;
    const latest = body["dist-tags"]?.latest;
    const v = body.versions?.[latest] || {};
    const times = body.time || {};
    return [
      `npm: ${body.name} ${latest || ""}`.trim(),
      body.description ? `   ${clip(body.description, 200)}` : null,
      times.created ? `   First published ${String(times.created).slice(0, 10)}` : null,
      latest && times[latest] ? `   Latest published ${String(times[latest]).slice(0, 10)}` : null,
      body.maintainers?.length
        ? `   Maintainers: ${clip(body.maintainers.map(m => `${m.name}${m.email ? ` <${m.email}>` : ""}`).join(", "), 240)}`
        : null,
      v.author ? `   Author: ${clip(typeof v.author === "string" ? v.author : `${v.author.name || ""} ${v.author.email || ""}`, 120)}` : null,
      body.versionCount ? `   ${body.versionCount} released version(s)` : null,
      body.repository?.url ? `   Repository: ${clip(body.repository.url, 160)}` : null,
      body.homepage ? `   Home: ${clip(body.homepage, 160)}` : null,
      body.license ? `   Licence: ${clip(body.license, 60)}` : null
    ].filter(Boolean).join("\n") +
      `\n\nMaintainer emails and the repository URL are the usual pivot from a package back to a person.`;
  },

  async gitlab_lookup(input) {
    const username = String(input.username || "").trim();
    if (!username) return "gitlab_lookup needs a username.";

    const users = await Proxy.lookup("gitlab_user", { username });
    const u = Array.isArray(users) ? users[0] : null;
    if (!u) return `No public GitLab account named “${username}”. That is not an absence — plenty of people use only GitHub.`;

    const lines = [
      `GitLab: ${u.name || u.username} (@${u.username}) — id ${u.id}`,
      u.state ? `   State: ${u.state}` : null,
      u.created_at ? `   Joined: ${String(u.created_at).slice(0, 10)}` : null,
      u.location ? `   Location: ${clip(u.location, 100)}` : null,
      u.bio ? `   Bio: ${clip(u.bio, 240)}` : null,
      u.job_title ? `   Job title: ${clip(u.job_title, 100)}` : null,
      u.organization ? `   Organisation: ${clip(u.organization, 100)}` : null,
      u.web_url ? `   Profile: ${u.web_url}` : null
    ].filter(Boolean);

    try {
      const projects = await Proxy.lookup("gitlab_user_projects", { id: u.id });
      if (Array.isArray(projects) && projects.length) {
        const shown = projects.slice(0, 10);
        lines.push(`   ${projects.length} public project(s)` +
          (shown.length < projects.length ? `, showing the ${shown.length} most recently updated:` : `, most recently updated first:`));
        for (const p of shown) {
          lines.push(`     ${p.path_with_namespace} — updated ${String(p.last_activity_at || "").slice(0, 10)}` +
            (p.description ? `\n       ${clip(p.description, 140)}` : ""));
        }
      }
    } catch { /* the profile alone is still worth returning */ }

    return lines.join("\n");
  },

  async mastodon_lookup(input) {
    // The model tends to hand over whatever form it read the handle in — a full
    // profile URL, a leading @, a trailing slash. Normalise once and report the
    // normalised handle back, so what it quotes is what was actually queried.
    const username = String(input.username || "").replace(/^@/, "");
    const instance = String(input.instance || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!username || !instance) return "mastodon_lookup needs a username and an instance hostname.";

    const a = await orNothing(Proxy.lookup("mastodon_account", { username, instance }), true);
    if (!a || a.__missing || !a.username) {
      return `No account @${username}@${instance}. The handle may live on a different instance — ` +
        `the same local name can exist on many, and they are different accounts.`;
    }

    return [
      `@${a.acct}@${instance} — ${a.display_name || "(no display name)"}`,
      a.note ? `   Bio: ${clip(a.note.replace(/<[^>]+>/g, " "), 300)}` : null,
      a.created_at ? `   Joined: ${String(a.created_at).slice(0, 10)}` : null,
      `   ${a.statuses_count} posts · ${a.followers_count} followers · ${a.following_count} following`,
      a.bot ? "   Marked as a bot by its owner" : null,
      a.locked ? "   Followers require approval" : null,
      a.url ? `   Profile: ${a.url}` : null,
      a.fields?.length
        ? `   Profile fields: ${clip(a.fields.map(f => `${f.name}=${String(f.value).replace(/<[^>]+>/g, "")}`).join(" · "), 300)}`
        : null
    ].filter(Boolean).join("\n") +
      `\n\nProfile fields often carry a personal site or another handle, and a verified one (checked by the ` +
      `instance against a link back) is much stronger than an unverified claim.`;
  },

  async book_search(input) {
    const q = String(input.query || "").trim();
    if (!q) return "book_search needs a query.";
    const body = await Proxy.lookup("openlibrary", { q, limit: Math.min(Number(input.limit) || 8, 20) });
    const docs = body?.docs || [];
    if (!docs.length) return `No Open Library results for “${q}”.`;

    return `${body.numFound ?? docs.length} result(s), showing ${docs.length}:\n\n` +
      docs.map((d, i) =>
        `${i + 1}. ${clip(d.title, 160)}` +
        (d.author_name?.length ? ` — ${clip(d.author_name.slice(0, 4).join(", "), 120)}` : "") +
        (d.first_publish_year ? `\n   First published ${d.first_publish_year}` : "") +
        (d.publisher?.length ? ` · ${clip(d.publisher.slice(0, 3).join(", "), 120)}` : "") +
        (d.isbn?.length ? `\n   ISBN: ${d.isbn.slice(0, 3).join(", ")}` : "")
      ).join("\n");
  },

  async country_facts(input) {
    const name = String(input.name || "").trim();
    if (!name) return "country_facts needs a country name.";
    const body = await Proxy.lookup("restcountries", { name });
    const rows = Array.isArray(body) ? body : [];
    if (!rows.length) return `No country matched “${name}”.`;

    return rows.slice(0, 3).map(c => {
      const langs = Object.values(c.languages || {});
      const curr = Object.entries(c.currencies || {}).map(([code, v]) => `${v.name} (${code}${v.symbol ? ` ${v.symbol}` : ""})`);
      const dial = c.idd?.root ? `${c.idd.root}${(c.idd.suffixes || [])[0] || ""}` : null;
      return [
        `${c.name?.official || c.name?.common} (${c.cca2}/${c.cca3})`,
        c.capital?.length ? `   Capital: ${c.capital.join(", ")}` : null,
        `   Region: ${[c.region, c.subregion].filter(Boolean).join(" — ")}`,
        langs.length ? `   Languages: ${langs.join(", ")}` : null,
        curr.length ? `   Currency: ${curr.join(", ")}` : null,
        dial ? `   Calling code: ${dial}` : null,
        c.car?.side ? `   Drives on the ${c.car.side}` : null,
        c.timezones?.length ? `   Timezones: ${clip(c.timezones.join(", "), 160)}` : null,
        c.latlng?.length === 2 ? `   Centre: ${c.latlng[0]}, ${c.latlng[1]}` : null,
        c.borders?.length ? `   Borders: ${c.borders.join(", ")}` : null,
        c.population != null ? `   Population: ${c.population.toLocaleString()}` : null
      ].filter(Boolean).join("\n");
    }).join("\n\n") +
      `\n\nDriving side, calling code and script are the fastest checks against what a photograph shows.`;
  }
};

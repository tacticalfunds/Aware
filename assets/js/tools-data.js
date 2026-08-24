/**
 * OSINT4ALL-style tool directory.
 * Each category has an id, display name, emoji icon, and a list of tools.
 * Each tool: { name, url, desc, tags: [ ...keywords used by the chatbot matcher ] }
 */
const OSINT_CATEGORIES = [
  {
    id: "search-engines",
    name: "Search Engines & Dorking",
    icon: "🔍",
    tools: [
      { name: "Google Advanced Search", url: "https://www.google.com/advanced_search", desc: "Full boolean/operator search for Google dorking.", tags: ["google", "dork", "search engine", "general"] },
      { name: "Bing", url: "https://www.bing.com", desc: "Alternative general search engine with different indexing.", tags: ["search engine", "general"] },
      { name: "DuckDuckGo", url: "https://duckduckgo.com", desc: "Privacy-respecting search engine, useful bang shortcuts.", tags: ["search engine", "privacy", "general"] },
      { name: "Yandex", url: "https://yandex.com", desc: "Russian search engine, strong for CIS-region results and reverse image.", tags: ["search engine", "russia", "general"] },
      { name: "Startpage", url: "https://www.startpage.com", desc: "Google results proxied through a privacy layer.", tags: ["search engine", "privacy"] },
      { name: "Search Engine Colossus", url: "https://www.searchenginecolossus.com", desc: "Directory of search engines by country.", tags: ["search engine", "international", "country"] },
      { name: "Carrot2", url: "https://search.carrot2.org", desc: "Clusters search results into topic groups for exploration.", tags: ["search engine", "clustering"] },
      { name: "Million Short", url: "https://millionshort.com", desc: "Removes the most popular sites to surface hidden results.", tags: ["search engine", "hidden results"] },
      { name: "GitHub Code Search", url: "https://github.com/search", desc: "Search public code, commits and repos for leaked secrets or usernames.", tags: ["code", "developer", "search", "secrets"] },
      { name: "OSINT Framework", url: "https://osintframework.com", desc: "Visual tree of OSINT tools organized by investigation goal.", tags: ["framework", "directory", "general"] }
    ]
  },
  {
    id: "username",
    name: "Username Search",
    icon: "🧑‍💻",
    tools: [
      { name: "Sherlock", url: "https://github.com/sherlock-project/sherlock", desc: "CLI tool that hunts a username across 400+ sites.", tags: ["username", "cli", "social media"] },
      { name: "Maigret", url: "https://github.com/soxoj/maigret", desc: "Collects a dossier on a username across thousands of sites.", tags: ["username", "cli", "dossier"] },
      { name: "WhatsMyName", url: "https://whatsmyname.app", desc: "Web-based username enumeration across hundreds of platforms.", tags: ["username", "web", "enumeration"] },
      { name: "Namechk", url: "https://namechk.com", desc: "Checks username and domain availability across services.", tags: ["username", "availability"] },
      { name: "KnowEm", url: "https://knowem.com", desc: "Username availability search across 500+ social networks.", tags: ["username", "availability", "social media"] },
      { name: "UserSearch.org", url: "https://usersearch.org", desc: "Aggregated username search across social platforms.", tags: ["username", "social media"] }
    ]
  },
  {
    id: "email-breach",
    name: "Email & Breach Data",
    icon: "📧",
    tools: [
      { name: "Have I Been Pwned", url: "https://haveibeenpwned.com", desc: "Checks an email or phone against known data breaches.", tags: ["email", "breach", "leak", "password"] },
      { name: "DeHashed", url: "https://dehashed.com", desc: "Searchable database of breached credentials and PII.", tags: ["email", "breach", "leak", "password", "database"] },
      { name: "IntelligenceX", url: "https://intelx.io", desc: "Search engine for leaks, darknet, and historical document archives.", tags: ["breach", "leak", "dark web", "documents"] },
      { name: "Hunter.io", url: "https://hunter.io", desc: "Finds and verifies professional email addresses tied to a domain.", tags: ["email", "domain", "verify"] },
      { name: "EmailRep", url: "https://emailrep.io", desc: "Reputation and risk score lookup for an email address.", tags: ["email", "reputation", "risk"] },
      { name: "Holehe", url: "https://github.com/megadose/holehe", desc: "Checks if an email is registered on 120+ sites via password-reset flows.", tags: ["email", "cli", "account discovery"] },
      { name: "GHunt", url: "https://github.com/mxrch/GHunt", desc: "OSINT against Google accounts (Gmail, Photos, Maps reviews).", tags: ["email", "google", "gmail", "account"] },
      { name: "Verify-Email.org", url: "https://verify-email.org", desc: "Simple email deliverability/validity checker.", tags: ["email", "verify"] }
    ]
  },
  {
    id: "phone",
    name: "Phone Number Lookup",
    icon: "📱",
    tools: [
      { name: "Truecaller", url: "https://www.truecaller.com", desc: "Crowdsourced caller-ID and spam lookup.", tags: ["phone", "caller id"] },
      { name: "NumLookup", url: "https://numlookup.com", desc: "Free reverse phone number lookup.", tags: ["phone", "reverse lookup"] },
      { name: "PhoneInfoga", url: "https://github.com/sundowndev/phoneinfoga", desc: "Gathers carrier, line type and footprint info for a number.", tags: ["phone", "cli", "carrier"] },
      { name: "Sync.me", url: "https://sync.me", desc: "Reverse phone lookup with caller name matching.", tags: ["phone", "reverse lookup"] },
      { name: "FreeCarrierLookup", url: "https://freecarrierlookup.com", desc: "Identifies the carrier behind a US phone number.", tags: ["phone", "carrier"] }
    ]
  },
  {
    id: "people",
    name: "People Search & Public Records",
    icon: "🪪",
    tools: [
      { name: "Pipl", url: "https://pipl.com", desc: "Deep people-search engine aggregating public records.", tags: ["people", "public records", "identity"] },
      { name: "TruePeopleSearch", url: "https://www.truepeoplesearch.com", desc: "Free US people search: addresses, relatives, phone numbers.", tags: ["people", "public records", "usa", "address"] },
      { name: "FastPeopleSearch", url: "https://www.fastpeoplesearch.com", desc: "Free lookup of US names, addresses and relatives.", tags: ["people", "public records", "usa"] },
      { name: "Spokeo", url: "https://www.spokeo.com", desc: "Aggregated people-search across social, public and marketing data.", tags: ["people", "public records"] },
      { name: "WhitePages", url: "https://www.whitepages.com", desc: "US address and phone directory lookup.", tags: ["people", "address", "phone"] },
      { name: "BeenVerified", url: "https://www.beenverified.com", desc: "Paid background-check style people search.", tags: ["people", "background check"] },
      { name: "FamilyTreeNow", url: "https://www.familytreenow.com", desc: "Free genealogy-style people and relative search.", tags: ["people", "genealogy", "relatives"] },
      { name: "PeekYou", url: "https://www.peekyou.com", desc: "Aggregates social profiles and web mentions by name.", tags: ["people", "social media", "profile"] }
    ]
  },
  {
    id: "social-media",
    name: "Social Media Intelligence",
    icon: "💬",
    tools: [
      { name: "Social Searcher", url: "https://www.social-searcher.com", desc: "Real-time search across social networks for a keyword or handle.", tags: ["social media", "monitoring", "keyword"] },
      { name: "Social Blade", url: "https://socialblade.com", desc: "Growth stats and analytics for YouTube, Twitch, Instagram, TikTok.", tags: ["social media", "analytics", "statistics"] },
      { name: "IntelTechniques Search Tools", url: "https://inteltechniques.com/tools/", desc: "Michael Bazzell's curated collection of manual OSINT search tools.", tags: ["framework", "directory", "manual search"] },
      { name: "Foller.me", url: "https://foller.me", desc: "Quick public analytics summary for any X/Twitter handle.", tags: ["twitter", "x", "analytics"] },
      { name: "Sotwe", url: "https://www.sotwe.com", desc: "Browse X/Twitter profiles and media without logging in.", tags: ["twitter", "x", "viewer"] },
      { name: "CrossLinked", url: "https://github.com/m8sec/CrossLinked", desc: "Enumerates employee names/roles from LinkedIn via search engines.", tags: ["linkedin", "employees", "company"] },
      { name: "Pixwox", url: "https://www.pixwox.com", desc: "Anonymous Instagram profile, story and post viewer.", tags: ["instagram", "viewer", "anonymous"] },
      { name: "Instaloader", url: "https://instaloader.github.io", desc: "Downloads Instagram posts, stories and metadata for analysis.", tags: ["instagram", "cli", "download"] },
      { name: "TGStat", url: "https://tgstat.com", desc: "Telegram channel/group analytics and search.", tags: ["telegram", "analytics", "channels"] },
      { name: "Telemetr.io", url: "https://telemetr.io", desc: "Telegram channel discovery and statistics.", tags: ["telegram", "analytics"] },
      { name: "Reveddit", url: "https://www.reveddit.com", desc: "Shows removed or deleted Reddit posts and comments.", tags: ["reddit", "deleted content"] },
      { name: "URLebird", url: "https://urlebird.com", desc: "Browse TikTok profiles and download videos without an account.", tags: ["tiktok", "viewer"] },
      { name: "YouTube Data Viewer", url: "https://citizenevidence.amnestyusa.org", desc: "Amnesty tool to extract thumbnails and upload time from YouTube videos.", tags: ["youtube", "video verification", "thumbnail"] }
    ]
  },
  {
    id: "images",
    name: "Image & Reverse Image Search",
    icon: "🖼️",
    tools: [
      { name: "Google Images", url: "https://images.google.com", desc: "Reverse image search and visual match via Google Lens.", tags: ["reverse image", "image search"] },
      { name: "TinEye", url: "https://tineye.com", desc: "Dedicated reverse image search engine with match history.", tags: ["reverse image"] },
      { name: "Yandex Images", url: "https://yandex.com/images", desc: "Often the strongest reverse image/face matching engine.", tags: ["reverse image", "face"] },
      { name: "Bing Visual Search", url: "https://www.bing.com/visualsearch", desc: "Microsoft's reverse image and visual search.", tags: ["reverse image"] },
      { name: "PimEyes", url: "https://pimeyes.com", desc: "Facial-recognition reverse image search across the open web.", tags: ["face", "facial recognition", "reverse image"] },
      { name: "FotoForensics", url: "https://fotoforensics.com", desc: "Error Level Analysis to detect image edits/manipulation.", tags: ["forensics", "manipulation", "ela"] },
      { name: "Forensically", url: "https://29a.ch/photo-forensics/", desc: "Suite of forensic image analysis tools (clone detection, noise, ELA).", tags: ["forensics", "manipulation", "clone detection"] }
    ]
  },
  {
    id: "geolocation",
    name: "Geolocation & GEOINT",
    icon: "🗺️",
    tools: [
      { name: "Google Earth", url: "https://earth.google.com", desc: "3D satellite imagery for terrain and building verification.", tags: ["satellite", "map", "3d"] },
      { name: "Google Maps", url: "https://maps.google.com", desc: "Street View and map search for location verification.", tags: ["map", "street view"] },
      { name: "SunCalc", url: "https://www.suncalc.org", desc: "Calculates sun/shadow position for a place and time — used to verify photo timestamps.", tags: ["shadow", "sun", "time verification"] },
      { name: "Wikimapia", url: "https://wikimapia.org", desc: "Crowd-annotated map with building and landmark names.", tags: ["map", "landmark"] },
      { name: "Mapillary", url: "https://www.mapillary.com", desc: "Crowdsourced street-level imagery, alternative to Street View.", tags: ["street view", "crowdsourced"] },
      { name: "OpenStreetMap", url: "https://www.openstreetmap.org", desc: "Open, editable world map with detailed local tagging.", tags: ["map", "open data"] },
      { name: "Overpass Turbo", url: "https://overpass-turbo.eu", desc: "Query tool for extracting structured data from OpenStreetMap.", tags: ["map", "query", "open data"] },
      { name: "Sentinel Hub EO Browser", url: "https://apps.sentinel-hub.com/eo-browser/", desc: "Free satellite imagery archive with historical date comparison.", tags: ["satellite", "imagery", "historical"] },
      { name: "NASA Worldview", url: "https://worldview.earthdata.nasa.gov", desc: "Near real-time satellite imagery of the entire planet.", tags: ["satellite", "imagery", "real time"] },
      { name: "Flightradar24", url: "https://www.flightradar24.com", desc: "Live and historical flight tracking.", tags: ["aviation", "flight tracking"] },
      { name: "ADS-B Exchange", url: "https://globe.adsbexchange.com", desc: "Unfiltered live flight tracking, including military/private aircraft.", tags: ["aviation", "flight tracking"] },
      { name: "MarineTraffic", url: "https://www.marinetraffic.com", desc: "Live and historical vessel tracking.", tags: ["marine", "ship tracking"] },
      { name: "VesselFinder", url: "https://www.vesselfinder.com", desc: "Alternative live vessel/ship tracking.", tags: ["marine", "ship tracking"] }
    ]
  },
  {
    id: "domain-network",
    name: "Domain, DNS & Network Infrastructure",
    icon: "🌐",
    tools: [
      { name: "WHOIS (DomainTools)", url: "https://whois.domaintools.com", desc: "Domain registration lookup and ownership history.", tags: ["whois", "domain", "registration"] },
      { name: "DNSDumpster", url: "https://dnsdumpster.com", desc: "Free DNS recon and subdomain mapping tool.", tags: ["dns", "subdomain", "recon"] },
      { name: "Shodan", url: "https://www.shodan.io", desc: "Search engine for internet-connected devices and exposed services.", tags: ["ip", "device", "infrastructure", "scan"] },
      { name: "Censys", url: "https://search.censys.io", desc: "Internet-wide scan data on hosts, certificates and services.", tags: ["ip", "certificate", "infrastructure", "scan"] },
      { name: "ZoomEye", url: "https://www.zoomeye.org", desc: "Cyberspace search engine for devices and web services.", tags: ["ip", "device", "scan"] },
      { name: "SecurityTrails", url: "https://securitytrails.com", desc: "Historical DNS, WHOIS and passive DNS data.", tags: ["dns", "whois", "historical"] },
      { name: "crt.sh", url: "https://crt.sh", desc: "Certificate Transparency log search — reveals subdomains.", tags: ["certificate", "subdomain", "ssl"] },
      { name: "BuiltWith", url: "https://builtwith.com", desc: "Identifies the technology stack behind a website.", tags: ["technology", "web stack"] },
      { name: "theHarvester", url: "https://github.com/laramies/theHarvester", desc: "Gathers emails, subdomains, hosts and names from public sources.", tags: ["cli", "email", "subdomain", "recon"] },
      { name: "OWASP Amass", url: "https://github.com/owasp-amass/amass", desc: "In-depth attack-surface mapping and asset discovery.", tags: ["cli", "subdomain", "recon", "attack surface"] },
      { name: "MXToolbox", url: "https://mxtoolbox.com", desc: "Mail server, DNS and blacklist diagnostic checks.", tags: ["dns", "email", "mail server"] },
      { name: "IPinfo", url: "https://ipinfo.io", desc: "IP geolocation, ASN and hosting-provider lookup.", tags: ["ip", "geolocation", "asn"] }
    ]
  },
  {
    id: "archives",
    name: "Website & Web Archives",
    icon: "🗄️",
    tools: [
      { name: "Wayback Machine", url: "https://web.archive.org", desc: "Historical snapshots of websites over time.", tags: ["archive", "history", "cache"] },
      { name: "Archive.today", url: "https://archive.ph", desc: "On-demand permanent page snapshots, resistant to takedown.", tags: ["archive", "snapshot"] },
      { name: "CachedView", url: "https://cachedview.nl", desc: "Quick access to Google/Bing cached versions of a page.", tags: ["cache", "archive"] }
    ]
  },
  {
    id: "metadata",
    name: "Metadata Analysis",
    icon: "🧬",
    tools: [
      { name: "ExifTool", url: "https://exiftool.org", desc: "The reference tool for reading/writing file metadata.", tags: ["exif", "metadata", "cli"] },
      { name: "Jeffrey's Exif Viewer", url: "https://exif.regex.info/exif.cgi", desc: "Web-based EXIF metadata viewer for images.", tags: ["exif", "metadata", "web"] },
      { name: "Metagoofil", url: "https://github.com/laramies/metagoofil", desc: "Extracts metadata from public documents on a target domain.", tags: ["metadata", "documents", "cli"] }
    ]
  },
  {
    id: "darkweb",
    name: "Dark Web",
    icon: "🕸️",
    tools: [
      { name: "Tor Browser", url: "https://www.torproject.org", desc: "Browser required to access .onion dark web sites.", tags: ["tor", "onion", "browser"] },
      { name: "Ahmia", url: "https://ahmia.fi", desc: "Search engine indexing Tor hidden services.", tags: ["tor", "onion", "search engine"] },
      { name: "DarkSearch", url: "https://darksearch.io", desc: "Dark web search engine with an API.", tags: ["tor", "onion", "search engine"] }
    ]
  },
  {
    id: "crypto",
    name: "Cryptocurrency & Blockchain",
    icon: "🪙",
    tools: [
      { name: "Etherscan", url: "https://etherscan.io", desc: "Ethereum blockchain explorer for wallets and transactions.", tags: ["ethereum", "blockchain", "wallet", "explorer"] },
      { name: "Blockchain.com Explorer", url: "https://www.blockchain.com/explorer", desc: "Bitcoin and multi-chain transaction explorer.", tags: ["bitcoin", "blockchain", "explorer"] },
      { name: "Arkham Intelligence", url: "https://platform.arkhamintelligence.com", desc: "Attributes blockchain wallets/addresses to real-world entities.", tags: ["blockchain", "wallet", "attribution"] },
      { name: "BTC.com", url: "https://btc.com", desc: "Bitcoin blockchain explorer and mining pool stats.", tags: ["bitcoin", "blockchain", "explorer"] },
      { name: "WalletExplorer", url: "https://www.walletexplorer.com", desc: "Clusters Bitcoin addresses likely belonging to the same wallet.", tags: ["bitcoin", "wallet", "clustering"] }
    ]
  },
  {
    id: "business",
    name: "Business & Corporate Records",
    icon: "🏢",
    tools: [
      { name: "OpenCorporates", url: "https://opencorporates.com", desc: "Largest open database of companies worldwide.", tags: ["company", "corporate", "registry"] },
      { name: "SEC EDGAR", url: "https://www.sec.gov/edgar/search/", desc: "US public company filings and disclosures.", tags: ["company", "sec", "filings", "usa"] },
      { name: "Crunchbase", url: "https://www.crunchbase.com", desc: "Company funding, leadership and acquisition data.", tags: ["company", "startup", "funding"] },
      { name: "Companies House (UK)", url: "https://find-and-update.company-information.service.gov.uk", desc: "UK company registry and officer records.", tags: ["company", "uk", "registry"] }
    ]
  },
  {
    id: "government",
    name: "Government & Legal Records",
    icon: "⚖️",
    tools: [
      { name: "CourtListener", url: "https://www.courtlistener.com", desc: "Free search engine for US court opinions and dockets.", tags: ["court", "legal", "usa", "records"] },
      { name: "PACER", url: "https://pacer.uscourts.gov", desc: "Official US federal court electronic records system.", tags: ["court", "legal", "usa", "federal"] },
      { name: "USA.gov", url: "https://www.usa.gov", desc: "Directory of official US government agencies and services.", tags: ["government", "usa", "directory"] }
    ]
  },
  {
    id: "media-verification",
    name: "News & Media Verification",
    icon: "📰",
    tools: [
      { name: "InVID-WeVerify", url: "https://weverify.eu/verification-plugin/", desc: "Browser plugin/toolset for verifying videos and images.", tags: ["video verification", "fact check", "plugin"] },
      { name: "Google Fact Check Explorer", url: "https://toolbox.google.com/factcheck/explorer", desc: "Searches fact-checks published across the web.", tags: ["fact check", "news"] },
      { name: "Snopes", url: "https://www.snopes.com", desc: "Long-running fact-checking and rumor investigation site.", tags: ["fact check", "news", "rumor"] },
      { name: "NewsGuard", url: "https://www.newsguardtech.com", desc: "Credibility ratings for news and information sites.", tags: ["fact check", "news", "credibility"] }
    ]
  },
  {
    id: "threat-intel",
    name: "Threat Intelligence & Malware",
    icon: "🛡️",
    tools: [
      { name: "VirusTotal", url: "https://www.virustotal.com", desc: "Scans files, URLs, domains and IPs against dozens of AV engines.", tags: ["malware", "scan", "ip", "domain", "file"] },
      { name: "urlscan.io", url: "https://urlscan.io", desc: "Sandboxes and visualizes what a URL actually loads.", tags: ["url", "scan", "sandbox"] },
      { name: "AbuseIPDB", url: "https://www.abuseipdb.com", desc: "Crowdsourced database of reported malicious IP addresses.", tags: ["ip", "abuse", "reputation"] },
      { name: "AlienVault OTX", url: "https://otx.alienvault.com", desc: "Open threat-intelligence sharing platform and IOC search.", tags: ["threat intel", "ioc", "indicators"] },
      { name: "Hybrid Analysis", url: "https://www.hybrid-analysis.com", desc: "Free automated malware sandbox analysis.", tags: ["malware", "sandbox", "analysis"] }
    ]
  },
  {
    id: "frameworks",
    name: "Frameworks & All-in-One Platforms",
    icon: "🧰",
    tools: [
      { name: "Maltego", url: "https://www.maltego.com", desc: "Link-analysis platform for visualizing OSINT relationships.", tags: ["framework", "link analysis", "graph"] },
      { name: "SpiderFoot", url: "https://www.spiderfoot.net", desc: "Automated OSINT reconnaissance across 200+ data sources.", tags: ["framework", "automation", "recon"] },
      { name: "Recon-ng", url: "https://github.com/lanmaster53/recon-ng", desc: "Modular web-recon framework with a Metasploit-like CLI.", tags: ["framework", "cli", "recon"] },
      { name: "IntelTechniques", url: "https://inteltechniques.com", desc: "Michael Bazzell's OSINT training, tools and workbook hub.", tags: ["framework", "training", "directory"] }
    ]
  }
];

// Flat index used by the chatbot / search for fast lookups.
const OSINT_TOOLS_FLAT = OSINT_CATEGORIES.flatMap(cat =>
  cat.tools.map(tool => ({ ...tool, category: cat.name, categoryId: cat.id, categoryIcon: cat.icon }))
);

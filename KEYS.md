# Optional API keys

Aware runs with no keys at all: 32 of its 42 proxied sources need none. These are
the ones worth adding anyway, in the order they actually change what the agent can
do. All of them are set as **server** environment variables, so nobody using your
deployment ever pastes a key into a browser.

Check each provider's current terms before relying on a quota — the free tiers
below are free at the time of writing, but the limits move.

---

## 1. `BRAVE_KEY` — web search that actually works

**What's broken without it.** Web search falls back to scraping the
no-JavaScript endpoints of DuckDuckGo, DuckDuckGo Lite and Mojeek. Railway is a
datacenter IP, and DuckDuckGo starts serving a bot challenge after two or three
queries from one. Results cache and requests are throttled to soften this, but all
three engines can be walled at once, and then the agent can only report "could not
check".

**What it fixes.** Brave wins outright when the key is set — a real search API, no
scraping, no rate-limit games. This is the single highest-value key for
investigation quality, because a lot of OSINT starts with a search that OSM and
Wikipedia cannot answer.

**Where.** <https://brave.com/search/api/> — free tier available; card may be
required to activate it.

---

## 2. `MAPILLARY_TOKEN` — street-level imagery the agent looks at itself

**What's broken without it.** `street_imagery` cannot run, so it hands *you* a
card with Street View / Mapillary / KartaView links and waits for you to describe
what you see. That works, but it stops the investigation dead until you answer,
and in practice it gets skipped.

**What it fixes.** The agent pulls Mapillary frames around a point itself, sorted
by how close each frame's compass angle is to the camera bearing it derived, and
compares them against your photo directly. This is the difference between naming a
street and verifying one.

**Where.** <https://www.mapillary.com/dashboard/developers> — free, no card.

---

## 3. `HIBP_KEY` — breach data

`email_breaches` cannot run without it. Have I Been Pwned charges a small monthly
fee for API access.

**Where.** <https://haveibeenpwned.com/API/Key>

---

## 4. The threat-intelligence set

Each unlocks one tool. All have free tiers; none is essential to geolocation work,
but they matter for domain and infrastructure investigations.

| Variable | Unlocks | Get one at |
|---|---|---|
| `SHODAN_KEY` | `shodan_host` — open ports and services on an IP | <https://account.shodan.io/> |
| `VIRUSTOTAL_KEY` | `virustotal_report` — file/URL/domain reputation | <https://www.virustotal.com/gui/my-apikey> |
| `ABUSEIPDB_KEY` | `abuseipdb_check` — abuse reports against an IP | <https://www.abuseipdb.com/account/api> |
| `ETHERSCAN_KEY` | `eth_balance` — Ethereum wallet balances | <https://etherscan.io/myapikey> |

---

## 5. Phone lookup

`phone_lookup` already works without a key — it parses and validates numbers
offline with libphonenumber and an area-code table. A key adds carrier and
line-type data on top.

| Variable | Adds | Get one at |
|---|---|---|
| `VERIPHONE_KEY` | carrier, line type, portability | <https://veriphone.io/> |
| `IPQS_KEY` | fraud scoring, disposable-number detection | <https://www.ipqualityscore.com/> |

---

## 6. `GITHUB_TOKEN` — code search

The other GitHub lookups (user, repos, user search) work unauthenticated.
`github_search_code` is the exception: GitHub's code search API requires auth, so
that one tool is dark without a token. Any classic personal access token with no
scopes is enough — it needs no permissions beyond being authenticated.

**Where.** <https://github.com/settings/tokens>

---

## Setting them on Railway

1. Open the project → your service → **Variables**
2. **New Variable**, paste the name and value, add
3. Railway redeploys automatically

Verify from the deployed site: `GET /api/sources` lists every source and whether
it is configured, and the server logs a line at startup naming the optional keys
that are still missing.

## Running locally

```sh
BRAVE_KEY=... MAPILLARY_TOKEN=... npm start
```

Never commit a key. `.env` files are not read by `server.js` — it reads
`process.env` directly, so pass them on the command line or export them in your
shell.

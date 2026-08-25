/**
 * Geolocation tools — every geo capability the agent can run automatically.
 *
 * Grouped here so the whole geolocation surface is in one place: the tool
 * definitions handed to the model and the code that executes them.
 *
 * Registered into the agent via GEO_TOOLS / GEO_EXECUTORS (see agent.js).
 * Other tool groups can follow the same two-export pattern.
 *
 *   geocode         place/address  -> coordinates, and the reverse   [Nominatim]
 *   place_search    fuzzy/partial place names                        [Photon]
 *   osm_nearby      what features exist around a point               [Overpass]
 *   elevation       ground height at coordinates                     [OpenTopoData]
 *   weather_history what the weather actually was, back to 1940      [Open-Meteo]
 *   sun_position    sun altitude/azimuth, shadow bearing + length    [offline]
 *   moon_position   moon altitude/azimuth, phase, rise/set           [offline]
 *
 * None of these need an API key.
 */

const COMPASS = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
const toCompass = deg => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

/** WMO weather codes as used by Open-Meteo. */
const WMO = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast",
  45: "fog", 48: "depositing rime fog",
  51: "light drizzle", 53: "moderate drizzle", 55: "dense drizzle",
  56: "light freezing drizzle", 57: "dense freezing drizzle",
  61: "slight rain", 63: "moderate rain", 65: "heavy rain",
  66: "light freezing rain", 67: "heavy freezing rain",
  71: "slight snowfall", 73: "moderate snowfall", 75: "heavy snowfall",
  77: "snow grains",
  80: "slight rain showers", 81: "moderate rain showers", 82: "violent rain showers",
  85: "slight snow showers", 86: "heavy snow showers",
  95: "thunderstorm", 96: "thunderstorm with slight hail", 99: "thunderstorm with heavy hail"
};

const isoDay = d => d.toISOString().slice(0, 10);
const fmtTime = d => (d instanceof Date && !isNaN(d) ? d.toISOString().replace(".000Z", "Z") : "n/a");

/* ------------------------------------------------------------------ *
 * Tool definitions handed to the model
 * ------------------------------------------------------------------ */

const GEO_TOOLS = [
  {
    name: "geocode",
    description: "Turns a place name or address into coordinates, or coordinates back into an address (OpenStreetMap Nominatim). Use when you have a specific, well-formed place name, or to identify what is at a known coordinate.",
    input_schema: {
      type: "object",
      properties: {
        place: { type: "string", description: "Place name or address" },
        lat: { type: "number" },
        lon: { type: "number" }
      }
    }
  },
  {
    name: "place_search",
    description: "Fuzzy place search (Photon) — far better than geocode at partial, misspelled or half-read names, which is what you usually have from a photo (a shop sign that's partly obscured, a street name at an angle). Try this when geocode returns nothing useful.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Partial or approximate name" },
        lat: { type: "number", description: "Optional: bias results near this point" },
        lon: { type: "number" }
      },
      required: ["query"]
    }
  },
  {
    name: "osm_nearby",
    description: "Queries OpenStreetMap via Overpass for features near coordinates. Use when geolocating a photo to confirm what should be visible at a candidate spot (named buildings, shops, fuel stations, towers, bridges).",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lon: { type: "number" },
        radius: { type: "integer", description: "Metres, default 300." },
        feature: { type: "string", description: "OSM key or key=value, e.g. 'amenity', 'shop=supermarket', 'man_made=tower'. Default: anything named." }
      },
      required: ["lat", "lon"]
    }
  },
  {
    name: "elevation",
    description: "Ground elevation in metres at one or more coordinates (OpenTopoData/SRTM). Use to rule candidate locations in or out: a photo showing dead-flat ground is inconsistent with a candidate on a slope, and elevation differences tell you whether a distant landmark could actually be visible.",
    input_schema: {
      type: "object",
      properties: {
        points: {
          type: "array",
          description: "Up to 20 points as {lat, lon}.",
          items: {
            type: "object",
            properties: { lat: { type: "number" }, lon: { type: "number" } },
            required: ["lat", "lon"]
          }
        }
      },
      required: ["points"]
    }
  },
  {
    name: "weather_history",
    description:
      "What the weather ACTUALLY was at a location on a past date — hourly temperature, precipitation, cloud cover, wind, and conditions (Open-Meteo archive, back to 1940, no key). " +
      "This is the strongest way to verify or break a claimed date: if an image shows clear dry ground but the record says heavy rain all day, the claimed date is wrong. " +
      "Note the archive lags roughly 5 days behind the present.",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lon: { type: "number" },
        date: { type: "string", description: "YYYY-MM-DD" },
        hour_utc: { type: "integer", description: "Optional 0-23 to highlight one hour." }
      },
      required: ["lat", "lon", "date"]
    }
  },
  {
    name: "sun_position",
    description:
      "Sun altitude and compass azimuth for a location, date and time — plus sunrise/sunset/golden hour. " +
      "Use to verify when an outdoor photo was taken: shadows fall in the OPPOSITE direction to the sun's azimuth, and shadow length relative to object height is 1/tan(altitude). " +
      "Runs offline, no network.",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lon: { type: "number" },
        datetime: { type: "string", description: "ISO 8601, e.g. 2026-06-21T16:00:00Z. Omit for the day's sun times only." }
      },
      required: ["lat", "lon"]
    }
  },
  {
    name: "moon_position",
    description:
      "Moon altitude, azimuth, illuminated fraction and phase, plus moonrise/moonset — the night-time counterpart to sun_position. " +
      "Use on night photos: a visible bright moon low in a known direction, or a claimed full moon on a night the record says was a crescent, is checkable evidence. Runs offline.",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lon: { type: "number" },
        datetime: { type: "string", description: "ISO 8601. Omit for tonight's moon times." }
      },
      required: ["lat", "lon"]
    }
  }
];

/* ------------------------------------------------------------------ *
 * Executors
 * ------------------------------------------------------------------ */

const GEO_EXECUTORS = {
  async geocode(input) {
    const r = await Proxy.lookup("nominatim",
      input.lat != null && input.lon != null ? { lat: input.lat, lon: input.lon } : { q: input.place });
    if (input.lat != null && input.lon != null) {
      return r.display_name ? `${r.display_name}\n(${r.lat}, ${r.lon})` : "No address found for those coordinates.";
    }
    if (!Array.isArray(r) || !r.length) return "No location matched. Try place_search for partial or approximate names.";
    return r.slice(0, 5).map(m => `${m.display_name} — ${m.lat}, ${m.lon}`).join("\n");
  },

  async place_search(input) {
    const r = await Proxy.lookup("photon", { q: input.query, lat: input.lat, lon: input.lon });
    const feats = r.features || [];
    if (!feats.length) return `No places matched "${input.query}".`;
    return feats.slice(0, 8).map(f => {
      const p = f.properties || {};
      const [lon, lat] = f.geometry?.coordinates || [];
      const where = [p.city || p.district, p.state, p.country].filter(Boolean).join(", ");
      const kind = p.osm_value ? ` [${p.osm_value}]` : "";
      return `${p.name || "(unnamed)"}${kind} — ${where} — ${lat}, ${lon}`;
    }).join("\n");
  },

  async osm_nearby(input) {
    const r = Number(input.radius) || 300;
    const f = input.feature || "";
    const sel = f.includes("=")
      ? `["${f.split("=")[0]}"="${f.split("=")[1]}"]`
      : f ? `["${f}"]` : `["name"]`;
    const q = `[out:json][timeout:20];(node${sel}(around:${r},${input.lat},${input.lon});way${sel}(around:${r},${input.lat},${input.lon}););out center 40;`;
    const d = await Proxy.lookup("overpass", { query: q });
    const els = d.elements || [];
    if (!els.length) return `No matching OSM features within ${r}m.`;
    return `${els.length} feature(s) within ${r}m:\n` + els.slice(0, 25).map(e => {
      const t = e.tags || {};
      const kind = t.amenity || t.shop || t.building || t.man_made || t.highway || e.type;
      return `- ${t.name || "(unnamed)"} [${kind}]`;
    }).join("\n");
  },

  async elevation(input) {
    const pts = (input.points || []).slice(0, 20);
    if (!pts.length) return "No points supplied.";
    const locations = pts.map(p => `${p.lat},${p.lon}`).join("|");
    const d = await Proxy.lookup("opentopodata", { locations });
    if (d.status !== "OK" || !Array.isArray(d.results)) {
      return `Elevation lookup failed: ${d.error || d.status || "unknown"}`;
    }
    const lines = d.results.map(r =>
      `${r.location.lat}, ${r.location.lng}: ${r.elevation == null ? "no data" : `${Math.round(r.elevation)} m`}`);
    if (d.results.length > 1) {
      const vals = d.results.map(r => r.elevation).filter(v => v != null);
      if (vals.length > 1) {
        lines.push(`\nRange: ${Math.round(Math.min(...vals))}–${Math.round(Math.max(...vals))} m ` +
          `(${Math.round(Math.max(...vals) - Math.min(...vals))} m difference)`);
      }
    }
    return lines.join("\n");
  },

  async weather_history(input) {
    const d = await Proxy.lookup("open_meteo_archive", {
      lat: input.lat, lon: input.lon, start: input.date, end: input.date
    });
    if (d.error || !d.hourly) return `No weather data returned${d.reason ? `: ${d.reason}` : "."}`;

    const daily = d.daily || {};
    const code = daily.weather_code?.[0];
    const out = [
      `Weather at ${input.lat}, ${input.lon} on ${input.date} (times UTC):`,
      code != null && `Overall: ${WMO[code] || `code ${code}`}`,
      daily.temperature_2m_max?.[0] != null &&
        `Temperature: ${daily.temperature_2m_min[0]}–${daily.temperature_2m_max[0]} °C`,
      daily.precipitation_sum?.[0] != null && `Total precipitation: ${daily.precipitation_sum[0]} mm`
    ].filter(Boolean);

    const h = d.hourly;
    const pick = i => [
      `  ${String(h.time[i]).slice(11, 16)}Z`,
      h.temperature_2m?.[i] != null && `${h.temperature_2m[i]}°C`,
      h.weather_code?.[i] != null && (WMO[h.weather_code[i]] || `code ${h.weather_code[i]}`),
      h.cloud_cover?.[i] != null && `cloud ${h.cloud_cover[i]}%`,
      h.precipitation?.[i] != null && `precip ${h.precipitation[i]}mm`,
      h.wind_speed_10m?.[i] != null && `wind ${h.wind_speed_10m[i]}km/h`
    ].filter(Boolean).join(" · ");

    if (input.hour_utc != null && h.time?.[input.hour_utc]) {
      out.push(`\nAt ${String(input.hour_utc).padStart(2, "0")}:00Z:`, pick(input.hour_utc));
    } else if (h.time?.length) {
      out.push("\nThrough the day (3-hourly):");
      for (let i = 0; i < h.time.length; i += 3) out.push(pick(i));
    }
    out.push("\nUse this to test a claimed date: visible conditions in the image should match. The archive lags ~5 days behind today.");
    return out.join("\n");
  },

  // Offline — no network. suncalc v2 returns DEGREES measured from NORTH
  // (verified against sunrise-NE / noon-due-south / sunset-NW). Do NOT apply a
  // radians conversion here; v1's radians-from-south convention does not apply.
  async sun_position(input) {
    const { lat, lon } = input;
    const day = input.datetime ? new Date(input.datetime) : new Date();
    if (isNaN(day)) throw new Error("Unparseable datetime — use ISO 8601 like 2026-06-21T16:00:00Z");
    const times = SunCalc.getTimes(day, lat, lon);
    const lines = [
      `Location: ${lat}, ${lon}`,
      `Sunrise: ${fmtTime(times.sunrise)}   Solar noon: ${fmtTime(times.solarNoon)}   Sunset: ${fmtTime(times.sunset)}`,
      `Golden hour (evening) starts: ${fmtTime(times.goldenHour)}`
    ];
    if (input.datetime) {
      const { altitude: alt, azimuth: az } = SunCalc.getPosition(day, lat, lon);
      lines.push(
        `\nAt ${fmtTime(day)}:`,
        `  Sun altitude: ${alt.toFixed(1)}°${alt < 0 ? " (below horizon — dark)" : ""}`,
        `  Sun azimuth: ${az.toFixed(1)}° from north (${toCompass(az)})`
      );
      if (alt > 0.5) {
        const shadowAz = (az + 180) % 360;
        lines.push(
          `  Shadows point: ${shadowAz.toFixed(1)}° (${toCompass(shadowAz)})`,
          `  Shadow length: ${(1 / Math.tan(alt * Math.PI / 180)).toFixed(2)}× object height`
        );
      }
    }
    return lines.join("\n");
  },

  async moon_position(input) {
    const { lat, lon } = input;
    const day = input.datetime ? new Date(input.datetime) : new Date();
    if (isNaN(day)) throw new Error("Unparseable datetime — use ISO 8601.");
    const times = SunCalc.getMoonTimes(day, lat, lon);
    const ill = SunCalc.getMoonIllumination(day);

    // phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter
    const phaseName =
      ill.phase < 0.03 || ill.phase > 0.97 ? "new moon" :
      ill.phase < 0.22 ? "waxing crescent" :
      ill.phase < 0.28 ? "first quarter" :
      ill.phase < 0.47 ? "waxing gibbous" :
      ill.phase < 0.53 ? "full moon" :
      ill.phase < 0.72 ? "waning gibbous" :
      ill.phase < 0.78 ? "last quarter" : "waning crescent";

    const lines = [
      `Location: ${lat}, ${lon}`,
      `Moonrise: ${times.rise ? fmtTime(times.rise) : "does not rise this day"}   ` +
        `Moonset: ${times.set ? fmtTime(times.set) : "does not set this day"}`,
      `Phase: ${phaseName} — ${(ill.fraction * 100).toFixed(0)}% illuminated`
    ];
    if (input.datetime) {
      const { altitude: alt, azimuth: az } = SunCalc.getMoonPosition(day, lat, lon);
      lines.push(
        `\nAt ${fmtTime(day)}:`,
        `  Moon altitude: ${alt.toFixed(1)}°${alt < 0 ? " (below horizon — not visible)" : ""}`,
        `  Moon azimuth: ${az.toFixed(1)}° from north (${toCompass(az)})`
      );
      if (alt > 0.5 && ill.fraction > 0.15) {
        const shadowAz = (az + 180) % 360;
        lines.push(`  Moon shadows would point: ${shadowAz.toFixed(1)}° (${toCompass(shadowAz)})`);
      }
    }
    lines.push("\nA night image showing the moon in a given direction/brightness can be tested against this.");
    return lines.join("\n");
  }
};

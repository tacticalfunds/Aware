/**
 * Photographs of places, street-level imagery, and web search.
 *
 * The gap these fill: the agent could *name* a candidate location but never look
 * at it. Naming "Larimer Street, Denver" and stopping there is not a
 * verification — the whole point of a geolocation is that the photo in hand and
 * the place on the map show the same thing.
 *
 * So these tools return actual pixels. Images come back inside the tool result
 * as image blocks, which means the model sees them on its next turn and can
 * compare them against the attached photo itself, rather than handing the user a
 * list of links and calling it done.
 *
 * Images are expensive in tokens (~1.1k each at 800px), so the limits are low by
 * default and every tool also returns a text list of everything it found —
 * including the candidates it did not fetch — so nothing is silently dropped.
 */

const PHOTO_FETCH_DEFAULT = 3;
const PHOTO_FETCH_MAX = 6;

/** extmetadata values are HTML fragments; the model wants the sentence, not the markup. */
function stripHtml(v) {
  if (v == null) return "";
  return String(v)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const meta = (info, field) => stripHtml(info?.extmetadata?.[field]?.value);

/** Wikimedia's query API returns pages as an object keyed by pageid, not a list. */
function commonsCandidates(body) {
  const pages = body?.query?.pages;
  if (!pages) return [];
  return Object.values(pages).map(pg => {
    const info = (pg.imageinfo || [])[0] || {};
    const coord = (pg.coordinates || [])[0];
    return {
      title: String(pg.title || "").replace(/^File:/, ""),
      thumb: info.thumburl || info.url || "",
      page: info.descriptionurl || "",
      date: meta(info, "DateTimeOriginal") || meta(info, "DateTime"),
      description: meta(info, "ImageDescription") || meta(info, "ObjectName"),
      credit: meta(info, "Artist"),
      license: meta(info, "LicenseShortName"),
      lat: coord?.lat ?? null,
      lon: coord?.lon ?? null
    };
  }).filter(c => c.thumb);
}

/**
 * Downloads thumbnails through the server so they can be handed to the model.
 * A failed fetch is skipped, not fatal — three of four photos is still a check.
 */
async function loadImages(candidates, limit) {
  const images = [];
  for (const c of candidates) {
    if (images.length >= limit) break;
    try {
      const img = await Proxy.image(c.thumb);
      images.push({ media_type: img.media_type, data: img.data, caption: c.title });
      c.shown = true;
    } catch {
      c.shown = false;
    }
  }
  return images;
}

function describe(candidates, shownCount) {
  const lines = candidates.map((c, i) => {
    const bits = [
      c.description && `“${c.description.slice(0, 160)}”`,
      c.date && `dated ${c.date}`,
      c.lat != null && `at ${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`,
      c.license,
      c.credit && `by ${c.credit.slice(0, 60)}`
    ].filter(Boolean).join(" · ");
    return `${i + 1}. ${c.shown ? "[SHOWN ABOVE] " : ""}${c.title}${bits ? ` — ${bits}` : ""}` +
      (c.page ? `\n   ${c.page}` : "");
  });
  const header = shownCount === 0
    ? `${candidates.length} photo(s) found, but none of the thumbnails could be downloaded, so there is nothing for you ` +
      `to look at — open the links yourself only if you hand them to the user. Do NOT treat this as a verification.`
    : `${candidates.length} photo(s) found; the ${shownCount === 1 ? "first one is" : `first ${shownCount} are`} ` +
      `attached above for you to look at.`;
  return `${header}\n` + lines.join("\n");
}

const PHOTO_TOOLS = [
  {
    name: "place_photos",
    description:
      "Returns actual photographs of a place — attached as images you can look at, not just links. " +
      "Search either by coordinates (every geotagged Wikimedia Commons photo within a radius) or by name (\"Rockmount Ranch Wear Denver\", \"Union Station Denver\"). " +
      "This is how you verify a candidate location instead of asserting it: pull photos of the place you think it is, and compare them against the attached image — same building, same corner, same signage, same street furniture? " +
      "Coordinate search is the stronger one when you already have a candidate point. Use it on every candidate before you commit to one, and say explicitly what matched and what didn't.",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number", description: "Latitude to search around. Use with lon." },
        lon: { type: "number", description: "Longitude to search around." },
        radius: { type: "number", description: "Search radius in metres, 10-10000. Default 500." },
        query: { type: "string", description: "Place or subject name, when you have no coordinates. Include the city." },
        show: { type: "number", description: `How many photos to attach as images, 1-${PHOTO_FETCH_MAX}. Default ${PHOTO_FETCH_DEFAULT}. Each one costs context, so raise it only when you are comparing closely.` }
      }
    }
  },
  {
    name: "street_imagery",
    description:
      "Street-level photography looking outward from a point — the ground truth for a geolocation. " +
      "Each frame carries the compass angle it was shot at, so you can pull the ones pointing the same way as your derived camera bearing and compare them with the attached photo directly. " +
      "Needs a free Mapillary token on the server; without one it hands the user Street View, Mapillary and KartaView links for those coordinates instead.",
    input_schema: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lon: { type: "number" },
        radius: { type: "number", description: "Metres around the point, 20-500. Default 120." },
        bearing: { type: "number", description: "If given, prefer frames shot within ~45° of this heading — the direction you think the camera faced." },
        show: { type: "number", description: `Frames to attach as images, 1-${PHOTO_FETCH_MAX}. Default ${PHOTO_FETCH_DEFAULT}.` }
      },
      required: ["lat", "lon"]
    }
  },
  {
    name: "web_search",
    description:
      "General web search. Use it for the things OSM does not know: a ghost sign's history, a business that has moved, a news photo of an event, a local landmark's name. " +
      "Search results are leads, not facts — follow the promising ones and say which claim came from where.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query. Be specific — include the city, the exact sign text, the year." }
      },
      required: ["query"]
    }
  }
];

const PHOTO_EXECUTORS = {
  async place_photos(input) {
    const show = Math.min(Math.max(Number(input.show) || PHOTO_FETCH_DEFAULT, 1), PHOTO_FETCH_MAX);
    const hasPoint = typeof input.lat === "number" && typeof input.lon === "number";
    if (!hasPoint && !input.query) return "Give either lat and lon, or a query naming the place.";

    let candidates = [];
    let how = "";

    if (hasPoint) {
      const radius = Math.min(Math.max(Number(input.radius) || 500, 10), 10000);
      const body = await Proxy.lookup("commons_geosearch", { lat: input.lat, lon: input.lon, radius, limit: 24 });
      candidates = commonsCandidates(body);
      how = `Wikimedia Commons, geotagged within ${radius} m of ${input.lat.toFixed(5)}, ${input.lon.toFixed(5)}`;
    }

    // Fall back to (or add) a name search when the point turned up little.
    if (input.query && candidates.length < show) {
      const body = await Proxy.lookup("commons_search", { q: input.query, limit: 12 });
      const named = commonsCandidates(body);
      candidates = candidates.concat(named.filter(n => !candidates.some(c => c.title === n.title)));
      how = how ? `${how}; plus a name search for “${input.query}”` : `Wikimedia Commons name search for “${input.query}”`;
    }

    // Commons is thin outside landmarks. Openverse indexes Flickr and friends,
    // which is where an ordinary streetscape actually lives.
    if (input.query && candidates.length < show) {
      try {
        const body = await Proxy.lookup("openverse", { q: input.query, limit: 12 });
        const ov = (body?.results || []).filter(r => r.id).map(r => ({
          title: r.title || `Openverse ${r.id}`,
          thumb: `https://api.openverse.org/v1/images/${encodeURIComponent(r.id)}/thumb/`,
          page: r.foreign_landing_url || r.url || "",
          date: "",
          description: r.source ? `via ${r.source}` : "",
          credit: r.creator || "",
          license: [r.license, r.license_version].filter(Boolean).join(" ").toUpperCase(),
          lat: null, lon: null
        }));
        candidates = candidates.concat(ov.filter(o => !candidates.some(c => c.title === o.title)));
        if (ov.length) how += `; plus Openverse for “${input.query}”`;
      } catch { /* Commons results, if any, still stand on their own */ }
    }

    if (!candidates.length) {
      return `No photos found via ${how || "Commons"}. ` +
        `Commons coverage is thin outside landmarks and city centres — this is weak evidence of absence, not evidence the place is wrong. ` +
        `Try street_imagery at the same point, or a wider radius.`;
    }

    const images = await loadImages(candidates, show);
    const text = `Source: ${how}.\n\n${describe(candidates, images.length)}` +
      (images.length
        ? `\n\nCompare these against the attached photo and say what matches and what does not — ` +
          `a matching building shape or sign is a confirmation; a mismatch is evidence against this candidate.`
        : "");
    return images.length ? { text, images } : text;
  },

  async street_imagery(input, ctx) {
    const { lat, lon } = input;
    if (typeof lat !== "number" || typeof lon !== "number") return "street_imagery needs lat and lon.";
    const radius = Math.min(Math.max(Number(input.radius) || 120, 20), 500);
    const show = Math.min(Math.max(Number(input.show) || PHOTO_FETCH_DEFAULT, 1), PHOTO_FETCH_MAX);

    if (!Proxy.has("mapillary_images")) {
      if (!ctx.onManualRequest) {
        return `No street-level imagery available: Mapillary isn't configured on this server (set MAPILLARY_TOKEN — ` +
          `it's free) and there's no interactive channel to hand the check to the user.`;
      }
      const heading = Math.round(((input.bearing ?? 0) % 360 + 360) % 360);
      const reply = await ctx.onManualRequest({
        tool_name: "Street-level imagery",
        why: `Ground-truth check on ${lat.toFixed(6)}, ${lon.toFixed(6)}. Mapillary isn't configured on this server ` +
          `(set MAPILLARY_TOKEN — the token is free), so this one needs your eyes.`,
        links: [
          { name: "Google Street View", url: `https://www.google.com/maps/@${lat},${lon},3a,75y,${heading}h,90t/data=!3m6!1e1`, note: "Widest coverage. Pan around and check the buildings against the photo." },
          { name: "Mapillary", url: `https://www.mapillary.com/app/?lat=${lat}&lng=${lon}&z=18`, note: "Crowdsourced — often covers streets Google skipped." },
          { name: "KartaView", url: `https://kartaview.org/map/@${lat},${lon},18z`, note: "Another open street-level set." }
        ],
        what_to_copy: `Does the streetscape at ${lat.toFixed(6)}, ${lon.toFixed(6)} match the attached photo? ` +
          `Note the buildings, signage, road markings — and anything that clearly does NOT match.`,
        multi: true
      });
      if (reply?.skipped) {
        return `The user skipped the street-level check at ${lat.toFixed(6)}, ${lon.toFixed(6)}. ` +
          `Note this candidate as unverified rather than treating it as confirmed, and try place_photos at the same point instead.`;
      }
      return `Street-level observations the user pasted back for ${lat.toFixed(6)}, ${lon.toFixed(6)}:\n\n${reply.text}\n\n` +
        `Weigh this against your candidate: matching buildings and signage confirm it; a clear mismatch kills it and you should move to the next candidate.`;
    }

    // Mapillary takes a bbox; convert the radius at this latitude.
    const dLat = radius / 111320;
    const dLon = radius / (111320 * Math.cos(lat * Math.PI / 180) || 1);
    const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map(v => v.toFixed(6)).join(",");

    const body = await Proxy.lookup("mapillary_images", { bbox, limit: 40 });
    let frames = (body?.data || []).map(f => {
      const g = f.computed_geometry || f.geometry || {};
      const [flon, flat] = g.coordinates || [null, null];
      return {
        title: `Mapillary ${f.id}`,
        thumb: f.thumb_1024_url || "",
        page: `https://www.mapillary.com/app/?pKey=${f.id}&focus=photo`,
        date: f.captured_at ? new Date(f.captured_at).toISOString().slice(0, 10) : "",
        description: `${f.is_pano ? "360° pano" : "flat frame"}${f.compass_angle != null ? `, facing ${Math.round(f.compass_angle)}°` : ""}`,
        compass: f.compass_angle,
        lat: flat, lon: flon
      };
    }).filter(f => f.thumb);

    if (!frames.length) return `No Mapillary coverage within ${radius} m of ${lat.toFixed(6)}, ${lon.toFixed(6)}.`;

    // Prefer frames looking the way the camera is believed to have looked.
    if (typeof input.bearing === "number") {
      const off = a => { const d = Math.abs(((a - input.bearing) % 360 + 540) % 360 - 180); return d; };
      frames = frames.filter(f => f.compass != null)
        .sort((a, b) => off(a.compass) - off(b.compass))
        .concat(frames.filter(f => f.compass == null));
    }

    const images = await loadImages(frames, show);
    const text = `Mapillary street-level frames within ${radius} m of ${lat.toFixed(6)}, ${lon.toFixed(6)}` +
      (typeof input.bearing === "number" ? `, sorted by how close their heading is to ${Math.round(input.bearing)}°` : "") +
      `.\n\n${describe(frames, images.length)}\n\n` +
      `These look outward from roughly where you think the camera stood. If the attached photo was taken here, ` +
      `the buildings should line up. Say plainly whether they do.`;
    return images.length ? { text, images } : text;
  },

  async web_search(input) {
    const q = String(input.query || "").trim();
    if (!q) return "web_search needs a query.";

    if (Proxy.has("brave_search")) {
      const body = await Proxy.lookup("brave_search", { q });
      const hits = body?.web?.results || [];
      if (!hits.length) return `No web results for “${q}”.`;
      return `Web results for “${q}” (Brave):\n\n` + hits.slice(0, 10).map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${stripHtml(r.description).slice(0, 240)}`).join("\n");
    }

    const body = await Proxy.lookup("ddg_search", { q });
    if (body?.blocked) {
      return `Web search is unavailable right now — DuckDuckGo returned a ${body.reason} to the server. ` +
        `Treat this as "could not check", NOT as "nothing found". Either hand the user a search to run with ` +
        `request_manual_lookup, or set BRAVE_KEY on the server for a keyed search that isn't rate-limited.`;
    }
    const hits = body?.results || [];
    if (!hits.length) return `No web results for “${q}”.`;
    return `Web results for “${q}” (DuckDuckGo):\n\n` + hits.map((r, i) =>
      `${i + 1}. ${r.title}\n   ${r.url}${r.snippet ? `\n   ${r.snippet.slice(0, 240)}` : ""}`).join("\n");
  }
};

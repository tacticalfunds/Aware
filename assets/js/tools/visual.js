/**
 * Visual output tools.
 *
 * These don't fetch anything — they let the agent *show* its reasoning:
 *
 *   annotate_image      boxes drawn over the attached photo, marking the exact
 *                       details the conclusion rests on
 *   plot_triangulation  a survey-style plan view drawn over real aerial imagery:
 *                       numbered control points, the camera station, labelled
 *                       sight lines, view cone and error ellipse, with OSM
 *                       building and road vectors traced over the photography
 *
 * Both hand a spec to the UI via ctx.onVisual, which renders SVG into the trace.
 * Coordinates for annotations are normalised 0-1 so they survive any display size.
 */

/* Evidence types get consistent colours so the boxes read at a glance. */
const ANNOTATION_COLORS = {
  sign: "#f5a524",       // amber  — readable text, shop names
  landmark: "#4fd1c5",   // teal   — buildings, structures
  vehicle: "#a78bfa",    // violet — cars, plates, liveries
  shadow: "#fbbf24",     // yellow — sun/shadow evidence
  terrain: "#4ade80",    // green  — vegetation, hills, ground
  person: "#94a3b8",     // slate  — people (not identified, just noted)
  other: "#60a5fa"       // blue   — anything else
};

const VISUAL_TOOLS = [
  {
    name: "annotate_image",
    description:
      "Draws labelled colour-coded boxes over the attached image, marking the specific details your conclusion rests on. " +
      "Use it once you have identified the useful features — it shows the user exactly what you read and where, so they can check your work rather than take it on trust. " +
      "Coordinates are fractions of the image (0-1) measured from the top-left, so x:0.1, y:0.2, w:0.25, h:0.1 is a box a quarter-width wide starting a tenth in from the left. " +
      "Categories colour the boxes: sign, landmark, vehicle, shadow, terrain, person, other.",
    input_schema: {
      type: "object",
      properties: {
        regions: {
          type: "array",
          description: "Up to 12 boxes.",
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Short label, e.g. 'SHOE PLAZA sign'." },
              category: { type: "string", enum: ["sign", "landmark", "vehicle", "shadow", "terrain", "person", "other"] },
              x: { type: "number" }, y: { type: "number" },
              w: { type: "number" }, h: { type: "number" },
              note: { type: "string", description: "What this detail establishes." }
            },
            required: ["label", "x", "y", "w", "h"]
          }
        }
      },
      required: ["regions"]
    }
  },
  {
    name: "plot_triangulation",
    description:
      "Draws a survey-style plan view over real aerial imagery of the site: each located anchor as a numbered control point, the camera station, a sight line to every anchor labelled with its distance and bearing, the view cone, and the error ellipse. " +
      "OpenStreetMap building footprints and roads are traced over the photography so the user can check the fix against the actual ground. " +
      "Use it once you have located one or more anchors with osm_find_named or geocode. " +
      "ALWAYS pass `camera` — an estimated station with an honest uncertainty_m is far more useful than none, and without it the diagram is just a scatter of points with nothing to show how the position was fixed. " +
      "It reports the computed distances and bearings back to you, so it doubles as a check on your geometry: the bearings must match the left-to-right order of the features in the photo.",
    input_schema: {
      type: "object",
      properties: {
        anchors: {
          type: "array",
          description: "Located features, 1-8 of them.",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              lat: { type: "number" },
              lon: { type: "number" }
            },
            required: ["name", "lat", "lon"]
          }
        },
        camera: {
          type: "object",
          description:
            "The derived camera station. Give your best estimate even when it is rough — say so with uncertainty_m rather than omitting it. " +
            "Work it out from the anchors: stand where every anchor falls in the photo's left-to-right order at a plausible distance for its apparent size.",
          properties: {
            lat: { type: "number" },
            lon: { type: "number" },
            bearing: { type: "number", description: "View direction, degrees from north." },
            fov: { type: "number", description: "Horizontal field of view in degrees, default 65." },
            uncertainty_m: { type: "number", description: "Honest error radius in metres." }
          },
          required: ["lat", "lon"]
        },
        basemap: {
          type: "string",
          enum: ["satellite", "street"],
          description: "Backdrop imagery. Satellite (default) for outdoor scenes; street for dense urban blocks where labelled roads read better."
        },
        caption: { type: "string", description: "One line on what the diagram shows and how firm the fix is." }
      },
      required: ["anchors"]
    }
  }
];

const VISUAL_EXECUTORS = {
  async annotate_image(input, ctx) {
    const regions = (input.regions || []).slice(0, 12).filter(r =>
      [r.x, r.y, r.w, r.h].every(v => typeof v === "number" && isFinite(v)));
    if (!regions.length) return "No valid regions given — each needs numeric x, y, w, h as fractions of the image.";
    if (!ctx.onVisual) return "No display channel available, so the annotated image can't be shown.";

    // Clamp into the frame so a slightly-off box can't render outside the image.
    const clean = regions.map(r => {
      const x = Math.min(Math.max(r.x, 0), 1), y = Math.min(Math.max(r.y, 0), 1);
      return {
        label: r.label, note: r.note || "",
        category: ANNOTATION_COLORS[r.category] ? r.category : "other",
        x, y,
        w: Math.min(Math.max(r.w, 0.01), 1 - x),
        h: Math.min(Math.max(r.h, 0.01), 1 - y)
      };
    });
    const shown = ctx.onVisual({ type: "annotations", regions: clean });
    if (!shown) return "There's no attached image to annotate.";
    return `Annotated the image with ${clean.length} box(es): ` +
      clean.map(r => `${r.label} [${r.category}]`).join(", ") +
      `. The user can now see exactly which details you used.`;
  },

  async plot_triangulation(input, ctx) {
    const anchors = (input.anchors || []).slice(0, 8).filter(a =>
      typeof a.lat === "number" && typeof a.lon === "number");
    if (!anchors.length) return "No valid anchors — each needs a name, lat and lon.";
    if (!ctx.onVisual) return "No display channel available, so the plan view can't be shown.";

    const camera = input.camera && typeof input.camera.lat === "number" && typeof input.camera.lon === "number"
      ? input.camera : null;
    ctx.onVisual({
      type: "triangulation", anchors, camera,
      caption: input.caption || "", basemap: input.basemap || "satellite"
    });

    // Report the geometry back so the agent can sanity-check its own reasoning.
    const R = 6371000, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
    const between = (a, b) => {
      const φ1 = rad(a.lat), φ2 = rad(b.lat), Δφ = rad(b.lat - a.lat), Δλ = rad(b.lon - a.lon);
      const h = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
      const d = 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
      const y = Math.sin(Δλ) * Math.cos(φ2);
      const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
      return { d, brg: (deg(Math.atan2(y, x)) + 360) % 360 };
    };

    const out = [`Plan view drawn over ${input.basemap === "street" ? "street" : "aerial"} imagery with ` +
      `${anchors.length} control point(s)${camera ? " and the camera station" : ""}.`];
    for (let i = 0; i < anchors.length; i++) {
      for (let j = i + 1; j < anchors.length; j++) {
        const { d, brg } = between(anchors[i], anchors[j]);
        out.push(`${anchors[i].name} → ${anchors[j].name}: ${d < 1000 ? `${d.toFixed(0)} m` : `${(d / 1000).toFixed(2)} km`} at ${brg.toFixed(0)}°`);
      }
    }
    if (camera) {
      for (const a of anchors) {
        const { d, brg } = between(camera, a);
        out.push(`Camera → ${a.name}: ${d.toFixed(0)} m at ${brg.toFixed(0)}°`);
      }
      out.push(`Check these against the photo: the bearings should match the left-to-right order of the features in frame, and nearer features should appear larger. ` +
        `If they don't, the station is wrong — move it and call this again.`);
    } else {
      out.push(`No camera station was given, so the diagram has no sight lines, no view cone and nothing showing how the position was fixed — ` +
        `which is the part worth looking at. Estimate a station from the anchors and call this again with camera {lat, lon, bearing, uncertainty_m}.`);
    }
    return out.join("\n");
  }
};

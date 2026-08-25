/**
 * Visual output tools.
 *
 * These don't fetch anything — they let the agent *show* its reasoning:
 *
 *   annotate_image      boxes drawn over the attached photo, marking the exact
 *                       details the conclusion rests on
 *   plot_triangulation  a plan (aerial) view of the located anchors, the derived
 *                       camera position and its view cone
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
      "Draws an aerial/plan view of your geolocation working: each located anchor as a labelled point, the distances and bearings between them, and — if you give one — the derived camera position with its view cone. " +
      "Use it after locating two or more anchors with osm_find_named, to show how they fix the camera position. " +
      "It also reports the computed distances back to you, so it doubles as a check on your geometry.",
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
          description: "Derived camera position, if you have one.",
          properties: {
            lat: { type: "number" },
            lon: { type: "number" },
            bearing: { type: "number", description: "View direction, degrees from north." },
            fov: { type: "number", description: "Horizontal field of view in degrees, default 65." },
            uncertainty_m: { type: "number", description: "Honest error radius in metres." }
          },
          required: ["lat", "lon"]
        },
        caption: { type: "string" }
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

    ctx.onVisual({ type: "triangulation", anchors, camera: input.camera || null, caption: input.caption || "" });

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

    const out = [`Plan view drawn with ${anchors.length} anchor(s)${input.camera ? " and the camera position" : ""}.`];
    for (let i = 0; i < anchors.length; i++) {
      for (let j = i + 1; j < anchors.length; j++) {
        const { d, brg } = between(anchors[i], anchors[j]);
        out.push(`${anchors[i].name} → ${anchors[j].name}: ${d < 1000 ? `${d.toFixed(0)} m` : `${(d / 1000).toFixed(2)} km`} at ${brg.toFixed(0)}°`);
      }
    }
    if (input.camera) {
      for (const a of anchors) {
        const { d, brg } = between(input.camera, a);
        out.push(`Camera → ${a.name}: ${d.toFixed(0)} m at ${brg.toFixed(0)}°`);
      }
      out.push(`Check these against the photo: the bearings should match the left-to-right order of the features in frame, and nearer features should appear larger.`);
    }
    return out.join("\n");
  }
};

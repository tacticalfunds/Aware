/**
 * Image metadata (EXIF).
 *
 * Claude's vision reads pixels, not file headers — so without this, a photo's
 * embedded GPS coordinates and capture time are thrown away, which is usually
 * the most direct answer to "where and when was this taken". Extraction runs in
 * the browser at attach time; the file never leaves the page for this step.
 *
 * The metadata is handed to the agent as stated fact and stored so the
 * image_metadata tool can re-read it later in the conversation.
 *
 * Treat EXIF as evidence, not proof: it is trivially editable, stripped by most
 * social platforms on upload, and a Software tag naming an editor means the file
 * has been through one. Corroborate against the visual content.
 */

/*
 * The metadata for the images sent with the current investigation, in the same
 * order the agent sees them, so "image 2" means the same thing to the tool as it
 * does in the task text. Set by the UI when a turn is sent.
 */
let INVESTIGATION_METADATA = [];   // [{ name, md }]

function setInvestigationMetadata(list) {
  INVESTIGATION_METADATA = (list || []).map(e => ({ name: e.name, md: e.metadata || null }));
}

const EXIF_FIELDS = [
  "Make", "Model", "LensModel", "Software",
  "DateTimeOriginal", "CreateDate", "ModifyDate", "OffsetTimeOriginal",
  "FocalLength", "FocalLengthIn35mmFormat", "FNumber", "ExposureTime", "ISO",
  "Orientation", "ExifImageWidth", "ExifImageHeight",
  "GPSAltitude", "GPSImgDirection", "GPSImgDirectionRef", "GPSDateStamp", "GPSTimeStamp",
  "Artist", "Copyright", "ImageDescription"
];

/**
 * Parses EXIF from a File/Blob. Returns null when there is none — which is
 * itself informative and reported as such.
 */
async function extractImageMetadata(file) {
  if (typeof exifr === "undefined") return null;
  try {
    // Deliberately no `pick`: latitude/longitude are values exifr *derives* from the
    // GPS tags, not tags themselves, so a pick list silently suppresses them and the
    // whole parse comes back empty. Filter after parsing instead.
    const raw = await exifr.parse(file, { tiff: true, exif: true, gps: true });
    if (!raw) return null;

    const md = { fields: {} };
    for (const k of EXIF_FIELDS) {
      if (raw[k] !== undefined && raw[k] !== null && raw[k] !== "") md.fields[k] = raw[k];
    }
    if (typeof raw.latitude === "number" && typeof raw.longitude === "number") {
      md.gps = { lat: raw.latitude, lon: raw.longitude, altitude: raw.GPSAltitude ?? null };
    }
    md.hasAny = !!md.gps || Object.keys(md.fields).length > 0;
    return md.hasAny ? md : null;
  } catch {
    return null;
  }
}

/** Human/model-readable summary, with the caveats that matter for an investigation. */
function formatImageMetadata(md) {
  if (!md || !md.hasAny) {
    return "No EXIF metadata present. That is expected for screenshots, and for anything downloaded from " +
      "Facebook, Instagram, X, WhatsApp or Discord — they strip it on upload. It is not by itself suspicious, " +
      "but it does mean location and capture time must come from the image content.";
  }
  const f = md.fields;
  const lines = [];

  if (md.gps) {
    lines.push(
      `GPS: ${md.gps.lat.toFixed(6)}, ${md.gps.lon.toFixed(6)}` +
      (md.gps.altitude != null ? ` (altitude ${Math.round(md.gps.altitude)} m)` : ""),
      `  -> Treat as a strong lead, not proof: EXIF GPS is editable. Verify it against the visible scene ` +
      `with osm_nearby, and against shadows with sun_position.`
    );
  }
  if (f.GPSImgDirection != null) {
    lines.push(`Camera was pointing: ${Number(f.GPSImgDirection).toFixed(1)}° ` +
      `(${f.GPSImgDirectionRef === "M" ? "magnetic" : "true"} north) — this is the recorded view bearing.`);
  }

  const when = f.DateTimeOriginal || f.CreateDate;
  if (when) {
    lines.push(`Captured: ${when instanceof Date ? when.toISOString().replace(".000Z", "Z") : when}` +
      (f.OffsetTimeOriginal ? ` (UTC offset ${f.OffsetTimeOriginal})` : " — note: usually camera local time, no timezone recorded"));
  }
  if (f.ModifyDate && String(f.ModifyDate) !== String(when)) {
    lines.push(`Last modified: ${f.ModifyDate instanceof Date ? f.ModifyDate.toISOString() : f.ModifyDate} — later than capture, so the file was re-saved.`);
  }

  const cam = [f.Make, f.Model].filter(Boolean).join(" ");
  if (cam) lines.push(`Camera: ${cam}${f.LensModel ? ` + ${f.LensModel}` : ""}`);
  if (f.Software) {
    lines.push(`Software tag: ${f.Software} — the file passed through this. If it names an editor, ` +
      `the image is not straight off the camera.`);
  }

  const shot = [
    f.FocalLength && `${f.FocalLength}mm`,
    f.FocalLengthIn35mmFormat && `(${f.FocalLengthIn35mmFormat}mm equiv)`,
    f.FNumber && `f/${f.FNumber}`,
    f.ExposureTime && `${f.ExposureTime < 1 ? `1/${Math.round(1 / f.ExposureTime)}` : f.ExposureTime}s`,
    f.ISO && `ISO ${f.ISO}`
  ].filter(Boolean).join(" · ");
  if (shot) {
    lines.push(`Exposure: ${shot}`);
    if (f.ExposureTime && f.ISO) {
      // Rough day/night read — a useful cross-check against the claimed time.
      const bright = f.ExposureTime <= 1 / 200 && f.ISO <= 400;
      const dark = f.ExposureTime >= 1 / 30 || f.ISO >= 1600;
      if (bright) lines.push(`  -> Fast shutter at low ISO indicates bright daylight.`);
      else if (dark) lines.push(`  -> Slow shutter or high ISO indicates low light — dusk, night or indoors.`);
    }
  }
  if (f.ExifImageWidth && f.ExifImageHeight) lines.push(`Dimensions: ${f.ExifImageWidth}x${f.ExifImageHeight}`);
  for (const k of ["Artist", "Copyright", "ImageDescription"]) {
    if (f[k]) lines.push(`${k}: ${f[k]}`);
  }
  return lines.join("\n");
}

const METADATA_TOOLS = [
  {
    name: "image_metadata",
    description:
      "Re-reads the EXIF metadata of the images attached to this conversation: GPS coordinates, capture time, camera make/model, lens, exposure, and the Software tag that reveals editing. " +
      "The metadata is already given to you when the images are attached — call this only to check a detail again later in the conversation. " +
      "With several images, omit `image` to get all of them: capture times that run in sequence, or one file carrying GPS while the rest do not, are findings in their own right. " +
      "If any carries GPS, that is your fastest route to a location: verify it with osm_nearby and sun_position rather than accepting it, since EXIF is editable.",
    input_schema: {
      type: "object",
      properties: {
        image: { type: "number", description: "1-based image number. Omit for all attached images." }
      }
    }
  }
];

const METADATA_EXECUTORS = {
  async image_metadata(input) {
    const all = INVESTIGATION_METADATA;
    if (!all.length) return "No images are attached to this investigation.";

    const wanted = typeof input?.image === "number"
      ? [all[Math.round(input.image) - 1]].filter(Boolean)
      : all;
    if (!wanted.length) {
      return `There is no image ${input.image} — ${all.length} image(s) are attached, numbered 1 to ${all.length}.`;
    }

    return wanted.map(entry => {
      const i = all.indexOf(entry) + 1;
      const head = all.length > 1 ? `Image ${i} — ${entry.name}:\n` : "";
      return head + formatImageMetadata(entry.md);
    }).join("\n\n");
  }
};

#!/usr/bin/env node
/**
 * Concatenates every hand-written source file into one plain-text bundle.
 *
 * Usage:  node tools/build-bundle.js [out.txt] [--all]
 *
 * For pasting somewhere whole — another assistant, a gist, an email. Files are
 * separated by a delimiter carrying the repository-relative path, so the bundle
 * can be split back into a working tree; the header explains how.
 *
 * By default the generated data and vendored libraries are listed but not
 * included: tools-data.js alone is 872 KB, which would take the bundle past a
 * megabyte and past anything you could paste. `--all` includes them, at which
 * point it is an archive rather than something to paste.
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { SECTIONS, OMITTED } = require("./manifest");

const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const ALL = args.includes("--all");
const OUT = args.find(a => !a.startsWith("--")) || path.join(ROOT, "aware-bundle.txt");

const RULE = "=".repeat(78);

function gitLine() {
  const run = c => { try { return execSync(c, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
  const parts = [run("git rev-parse --abbrev-ref HEAD"), run("git rev-parse --short HEAD"),
                 run("git log -1 --format=%cd --date=format:%Y-%m-%d")].filter(Boolean);
  return parts.join(" · ");
}

const files = [];
for (const sec of SECTIONS) {
  for (const [rel, note] of sec.files) {
    let src;
    try { src = fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { continue; }
    files.push({ rel, note, src, section: sec.title });
  }
}

if (ALL) {
  for (const [rel] of OMITTED) {
    if (files.some(f => f.rel === rel)) continue;
    let src;
    try { src = fs.readFileSync(path.join(ROOT, rel), "utf8"); } catch { continue; }
    // Binary files cannot go in a text bundle; name them and move on.
    if (/\.(jpe?g|png|gif|ico|webp)$/i.test(rel)) {
      files.push({ rel, note: "", src: `[binary file, ${src.length} bytes — not representable in a text bundle]\n`, section: "Included with --all" });
      continue;
    }
    files.push({ rel, note: "", src, section: "Included with --all" });
  }
}

const lineCount = s => s.replace(/\n$/, "").split("\n").length;
const totalLines = files.reduce((n, f) => n + lineCount(f.src), 0);

const out = [];

out.push(RULE);
out.push("AWARE — full source bundle");
out.push(gitLine());
out.push(`${files.length} files · ${totalLines.toLocaleString()} lines`);
out.push(RULE);
out.push("");
out.push("Each file sits between a pair of markers:");
out.push("");
out.push("    >>>>> FILE: <repository-relative path>");
out.push("    ==============================================================================");
out.push("    ...contents, verbatim...");
out.push("    <<<<< END: <repository-relative path>");
out.push("");
out.push("Everything strictly between them is the file, byte for byte — the end marker");
out.push("is there so that trailing blank lines are unambiguous. To rebuild the working");
out.push("tree, write each block to its path, then: npm start  (Node 18+, nothing to");
out.push("install). Anything outside a marker pair is commentary and can be discarded.");
out.push("");

if (!ALL) {
  out.push("NOT INCLUDED — generated data and vendored third-party libraries, together");
  out.push("about 1.5 MB, none of it hand-edited. Re-run this with --all to include them,");
  out.push("or regenerate the first three with the scripts in tools/:");
  out.push("");
  for (const [rel, kind, why] of OMITTED) {
    let size = "—";
    try {
      const bytes = fs.statSync(path.join(ROOT, rel)).size;
      size = bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
    } catch { /* keep the dash */ }
    out.push(`    ${rel.padEnd(38)} ${kind.padEnd(12)} ${size.padStart(7)}`);
    out.push(`      ${why}`);
  }
  out.push("");
  out.push("The site will not run without them: tools-data.js holds the 3,469-tool");
  out.push("directory and the vendor files are libphonenumber, exifr and SunCalc.");
  out.push("");
}

out.push("CONTENTS");
out.push("");
let lastSection = null;
for (const f of files) {
  if (f.section !== lastSection) {
    out.push(`  ${f.section}`);
    lastSection = f.section;
  }
  out.push(`    ${f.rel.padEnd(40)} ${String(lineCount(f.src)).padStart(5)} lines`);
}
out.push("");

for (const f of files) {
  out.push("");
  out.push(RULE);
  if (f.note) {
    // Above the FILE marker, never between it and the rule: that keeps the
    // opening sequence exactly two lines, so splitting the bundle stays trivial.
    const words = f.note.split(" ");
    let line = "";
    for (const w of words) {
      if ((line + " " + w).length > 76) { out.push(line.trim()); line = ""; }
      line += " " + w;
    }
    if (line.trim()) out.push(line.trim());
  }
  out.push(`>>>>> FILE: ${f.rel}`);
  out.push(RULE);
  out.push(f.src.replace(/\n$/, ""));
  out.push(`<<<<< END: ${f.rel}`);
}

out.push("");
out.push(RULE);
out.push("END OF BUNDLE");
out.push(RULE);

fs.writeFileSync(OUT, out.join("\n") + "\n");
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`Wrote ${OUT} — ${files.length} files, ${totalLines.toLocaleString()} lines, ${kb} KB${ALL ? " (--all)" : ""}`);

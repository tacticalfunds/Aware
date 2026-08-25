/** Builds a compact areaCode -> {region, cities[]} map from the NANP CSV files. */
const fs = require('fs');

function parseCsv(path, country) {
  const out = {};
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    // fields: areacode,city,"state",country,lat,lng  — city/state may be quoted
    const m = line.match(/^(\d{3}),(?:"([^"]*)"|([^,]*)),(?:"([^"]*)"|([^,]*)),([A-Z]{2}),/);
    if (!m) continue;
    const code = m[1];
    const city = (m[2] ?? m[3] ?? '').trim();
    const region = (m[4] ?? m[5] ?? '').trim();
    if (!out[code]) out[code] = { region, country, cities: [] };
    if (city && !out[code].cities.includes(city)) out[code].cities.push(city);
  }
  return out;
}

const us = parseCsv(require('path').join(__dirname,'lists/areacodes.csv'), 'US');
const ca = parseCsv(require('path').join(__dirname,'lists/areacodes-ca.csv'), 'CA');
const all = { ...us, ...ca };

// Keep the largest few cities per area code — enough to place it, small enough to ship.
const compact = {};
for (const [code, v] of Object.entries(all)) {
  compact[code] = [v.region, v.country, v.cities.slice(0, 6).join('|')];
}

const js = `/**
 * NANP area code -> [region, country, "city|city|..."].
 * Built from the public Area-Code-Geolocation-Database
 * (github.com/ravisorg/Area-Code-Geolocation-Database) by tools/build-areacodes.js.
 * Covers US + Canada. Geographic assignment only — it says nothing about the
 * current carrier or subscriber, since numbers port freely between carriers.
 */
const NANP_AREA_CODES = ${JSON.stringify(compact)};
`;
fs.writeFileSync(require('path').join(__dirname, '..', 'assets/js/area-codes.js'), js);
console.log('area codes:', Object.keys(compact).length, '| size:', (js.length/1024).toFixed(0)+'KB');
console.log('914 ->', JSON.stringify(compact['914']));
console.log('416 ->', JSON.stringify(compact['416']));
console.log('212 ->', JSON.stringify(compact['212']));

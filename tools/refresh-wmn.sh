#!/bin/sh
# Refreshes the WhatsMyName username-enumeration dataset used by /api/username.
# Upstream adds/removes sites regularly, so re-run this periodically.
set -e
cd "$(dirname "$0")/.."
curl -sSL -o data/wmn-data.json \
  https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json
node -e "console.log('sites:', require('./data/wmn-data.json').sites.length)"

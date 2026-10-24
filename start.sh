#!/bin/sh
# Mac / Linux: ./start.sh
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node.js 22 LTS from https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install --omit=dev
npm start

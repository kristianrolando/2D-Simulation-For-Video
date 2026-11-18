#!/bin/bash
# Double-click to open Sim Studio (backup for Sim Studio.app). Starts the local server if it is not running yet.
cd "$(dirname "$0")" || exit 1
LOG="$HOME/Library/Logs/Sim Studio.log"
URL="http://127.0.0.1:5180"
up() { curl -s --max-time 2 "$URL/api/status" 2>/dev/null | grep -q '"app":"sim-studio"'; }
if ! up; then
  command -v node >/dev/null || { echo "Node.js tidak ditemukan. Pasang Node.js 23.6 atau lebih baru."; read -r -p "Tekan Enter…"; exit 1; }
  [ -d node_modules ] || npm install --no-audit --no-fund
  nohup node apps/server/server.ts >> "$LOG" 2>&1 &
  for _ in $(seq 1 50); do up && break; sleep 0.3; done
fi
up && open "$URL" || { echo "Studio tidak mau menyala. Lihat $LOG"; read -r -p "Tekan Enter…"; exit 1; }

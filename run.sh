#!/usr/bin/env bash
# Serve Route Art Studio locally and open it.
set -euo pipefail
PORT="${PORT:-8899}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if curl -sf -o /dev/null "http://127.0.0.1:$PORT/index.html" 2>/dev/null; then
  echo "Already serving on port $PORT"
else
  echo "Serving $DIR on http://127.0.0.1:$PORT"
  (cd "$DIR" && exec python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
  sleep 1
fi

open "http://127.0.0.1:$PORT/index.html"
echo "Open: http://127.0.0.1:$PORT/index.html"
echo "Stop the server with:  pkill -f 'http.server $PORT'"

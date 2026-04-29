#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Activate venv
if [ -f "venv/bin/activate" ]; then
  source venv/bin/activate
else
  echo "⚠ No venv found. Run ./setup.sh first."
  exit 1
fi

echo "Starting Studio backend on http://127.0.0.1:8765 ..."
echo "Open your browser to http://127.0.0.1:8765"
echo "Press Ctrl+C to stop."
echo ""

cd backend
uvicorn main:app --host 127.0.0.1 --port 8765 --reload

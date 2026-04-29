#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
  echo "venv not found — run ./setup.sh first"
  exit 1
fi

source venv/bin/activate
cd backend
exec uvicorn main:app --host 127.0.0.1 --port 8765 --reload

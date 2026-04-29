#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[studio]${NC} $*"; }
warn()  { echo -e "${YELLOW}[warn]${NC} $*"; }
error() { echo -e "${RED}[error]${NC} $*"; exit 1; }

# ── 1. Python version check ───────────────────────────────────────
info "Checking Python version…"
PYTHON=$(command -v python3.11 || command -v python3.12 || command -v python3 || true)
[ -z "$PYTHON" ] && error "Python 3.11+ not found. Install it and re-run setup."

PY_VER=$($PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
[ "$PY_MAJOR" -lt 3 ] || [ "$PY_MINOR" -lt 11 ] && \
  error "Python 3.11+ required, found $PY_VER"
info "Python $PY_VER ✓"

# ── 2. Virtual environment ────────────────────────────────────────
if [ ! -d "venv" ]; then
  info "Creating virtual environment…"
  $PYTHON -m venv venv
fi
source venv/bin/activate
info "venv activated ✓"

# ── 3. Detect GPU ─────────────────────────────────────────────────
HAS_GPU=false
if command -v nvidia-smi &>/dev/null; then
  if nvidia-smi --query-gpu=name --format=csv,noheader &>/dev/null; then
    HAS_GPU=true
    info "NVIDIA GPU detected ✓"
  fi
fi

# ── 4. Install PyTorch ────────────────────────────────────────────
info "Installing PyTorch…"
if $HAS_GPU; then
  pip install --upgrade torch torchaudio --index-url https://download.pytorch.org/whl/cu121
else
  warn "No GPU found — installing CPU-only PyTorch (MusicGen will be slow)"
  pip install --upgrade torch torchaudio --index-url https://download.pytorch.org/whl/cpu
fi

# ── 5. Install requirements ───────────────────────────────────────
info "Installing Python requirements…"
pip install --upgrade pip
pip install -r backend/requirements.txt

# ── 6. Install audiocraft (MusicGen) ─────────────────────────────
info "Installing audiocraft (Meta MusicGen)…"
pip install git+https://github.com/facebookresearch/audiocraft.git

# ── 7. Salamander Grand Piano soundfont ──────────────────────────
mkdir -p soundfonts
SF2="soundfonts/grand-piano.sf2"
if [ ! -f "$SF2" ]; then
  info "Downloading Salamander Grand Piano soundfont (~170 MB)…"
  # Try archive.org mirror of the freely-licensed Salamander Grand Piano
  SF2_URL="https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/SalamanderGrandPianoV3+20200602.tar.xz"
  ARCHIVE="soundfonts/salamander.tar.xz"

  if command -v curl &>/dev/null; then
    curl -L "$SF2_URL" -o "$ARCHIVE" 2>/dev/null || true
  elif command -v wget &>/dev/null; then
    wget -q "$SF2_URL" -O "$ARCHIVE" || true
  fi

  if [ -f "$ARCHIVE" ]; then
    tar -xf "$ARCHIVE" -C soundfonts/ 2>/dev/null || true
    rm -f "$ARCHIVE"
    # Find the extracted SF2 and rename it
    FOUND=$(find soundfonts -name "*.sf2" | head -1)
    if [ -n "$FOUND" ]; then
      mv "$FOUND" "$SF2"
      info "Soundfont installed ✓"
    else
      warn "Could not extract SF2. Place a Grand Piano .sf2 at: $SF2"
    fi
  else
    warn "Soundfont download failed. MIDI render will be disabled."
    warn "Manually place a Grand Piano SF2 at: soundfonts/grand-piano.sf2"
  fi
else
  info "Soundfont already present ✓"
fi

# ── 8. Electron dependencies ──────────────────────────────────────
if command -v npm &>/dev/null; then
  info "Installing Electron dependencies…"
  cd electron && npm install --no-audit --no-fund && cd ..
  info "Electron ready ✓"
else
  warn "npm not found — skipping Electron install. Install Node.js to enable desktop packaging."
fi

# ── Done ──────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Studio setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Run the web server:   ./run.sh"
echo "  Open in browser:      http://127.0.0.1:8765"
if command -v npm &>/dev/null; then
echo "  Run as desktop app:   cd electron && npm start"
fi
echo ""

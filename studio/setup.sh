#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║        Studio DAW — Setup            ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ── 1. Python check ───────────────────────────────────────

echo "→ Checking Python version..."
if command -v python3.11 &>/dev/null; then
  PYTHON=python3.11
elif command -v python3 &>/dev/null; then
  PYVER=$(python3 -c "import sys; print(sys.version_info[:2])")
  if python3 -c "import sys; assert sys.version_info >= (3,10)" 2>/dev/null; then
    PYTHON=python3
  else
    echo "  ✗ Python 3.10+ required. Found: $PYVER"
    exit 1
  fi
else
  echo "  ✗ Python 3 not found. Install Python 3.11+ and re-run."
  exit 1
fi
echo "  ✓ Using $($PYTHON --version)"

# ── 2. Virtual environment ────────────────────────────────

echo ""
echo "→ Creating virtual environment at studio/venv/..."
if [ ! -d "venv" ]; then
  $PYTHON -m venv venv
  echo "  ✓ venv created"
else
  echo "  ✓ venv already exists"
fi

source venv/bin/activate

# ── 3. PyTorch (GPU or CPU) ───────────────────────────────

echo ""
echo "→ Detecting GPU..."
if command -v nvidia-smi &>/dev/null && nvidia-smi &>/dev/null; then
  CUDA_VER=$(nvidia-smi | grep "CUDA Version" | awk '{print $9}' | cut -d. -f1)
  echo "  ✓ NVIDIA GPU detected (CUDA $CUDA_VER)"
  echo "  Installing PyTorch with CUDA support..."
  pip install --quiet torch torchaudio --index-url https://download.pytorch.org/whl/cu118
else
  echo "  ℹ No GPU detected — installing CPU-only PyTorch"
  echo "    (MusicGen generation will be slow: ~10-20 min per 30s clip)"
  pip install --quiet torch torchaudio --index-url https://download.pytorch.org/whl/cpu
fi
echo "  ✓ PyTorch installed"

# ── 4. Backend requirements ───────────────────────────────

echo ""
echo "→ Installing backend requirements..."
pip install --quiet -r backend/requirements.txt
echo "  ✓ Requirements installed"

# ── 5. audiocraft (MusicGen) ─────────────────────────────

echo ""
echo "→ Installing audiocraft (Meta MusicGen)..."
if python -c "import audiocraft" 2>/dev/null; then
  echo "  ✓ audiocraft already installed"
else
  pip install --quiet git+https://github.com/facebookresearch/audiocraft.git
  echo "  ✓ audiocraft installed"
fi

# ── 6. FluidSynth check ───────────────────────────────────

echo ""
echo "→ Checking FluidSynth..."
if command -v fluidsynth &>/dev/null; then
  echo "  ✓ FluidSynth found: $(fluidsynth --version 2>&1 | head -1)"
else
  echo "  ⚠ FluidSynth not found. MIDI rendering will be unavailable."
  if [[ "$OSTYPE" == "darwin"* ]]; then
    echo "    Install with: brew install fluidsynth"
  else
    echo "    Install with: sudo apt install fluidsynth"
  fi
fi

# ── 7. Salamander Grand Piano soundfont ──────────────────

echo ""
echo "→ Checking soundfonts..."
mkdir -p soundfonts
SF2_PATH="soundfonts/salamander.sf2"
if [ -f "$SF2_PATH" ]; then
  echo "  ✓ Salamander Grand Piano already downloaded"
else
  echo "  Downloading Salamander Grand Piano soundfont (~35MB)..."
  SF2_URL="https://freepats.zenvoid.org/Piano/SalamanderGrandPiano/SalamanderGrandPianoV3+20161209_48khz24bit.tar.xz"
  TMPFILE="/tmp/salamander.tar.xz"
  if curl -L --silent --show-error -o "$TMPFILE" "$SF2_URL"; then
    tar -xJf "$TMPFILE" -C /tmp/
    # Find the sf2 file and copy it
    SF2_FOUND=$(find /tmp -name "*.sf2" 2>/dev/null | head -1)
    if [ -n "$SF2_FOUND" ]; then
      cp "$SF2_FOUND" "$SF2_PATH"
      echo "  ✓ Soundfont downloaded"
    else
      echo "  ⚠ Could not extract soundfont. Download manually from freepats.zenvoid.org"
    fi
    rm -f "$TMPFILE"
  else
    echo "  ⚠ Download failed. You can add a .sf2 file manually to studio/soundfonts/salamander.sf2"
  fi
fi

# ── 8. Node / Electron ────────────────────────────────────

echo ""
echo "→ Installing Electron dependencies..."
if command -v npm &>/dev/null; then
  cd electron
  npm install --silent
  cd ..
  echo "  ✓ Electron dependencies installed"
else
  echo "  ⚠ npm not found — skipping Electron setup. Install Node.js to enable desktop packaging."
fi

# ── Done ──────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════╗"
echo "║         Setup complete! ✓            ║"
echo "╚══════════════════════════════════════╝"
echo ""
echo "To run Studio:"
echo "  ./run.sh"
echo ""
echo "Then open http://127.0.0.1:8765 in your browser."
echo ""
echo "To run as a desktop app:"
echo "  cd electron && npm start"
echo ""

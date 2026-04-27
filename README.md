# Music Augmentation Tool

Record a rough idea. Describe a style. Get back a fully produced version — your performance stays, AI fills in everything else.

## Requirements

- Python 3.11+
- ffmpeg (required by pydub)
- A [Replicate](https://replicate.com) API token

### Install ffmpeg

**Windows:** `winget install ffmpeg` or download from https://ffmpeg.org/download.html  
**Mac:** `brew install ffmpeg`  
**Linux:** `sudo apt install ffmpeg`

## Setup

```bash
# 1. Clone and enter the project
cd music-tools

# 2. Create and activate a virtual environment
python -m venv venv
source venv/bin/activate        # Mac/Linux
venv\Scripts\activate           # Windows

# 3. Install Python dependencies
pip install -r backend/requirements.txt

# 4. Configure your API token
cp .env.example .env
# Edit .env and replace "your_token_here" with your Replicate token

# 5. Start the backend
cd backend
uvicorn main:app --reload

# 6. Open the frontend
# Open frontend/index.html in your browser
```

## Verify it's running

```bash
curl http://localhost:8000/health
# → {"status":"ok"}
```

## Notes on demucs + torch

If you hit torch version conflicts installing from requirements.txt, install torch first:

```bash
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu
pip install demucs basic-pitch
```

## Usage

1. Open `frontend/index.html` in your browser
2. Record up to 15 seconds from your microphone
3. Set your BPM and describe a style ("trap drums", "john bonham rock kit")
4. Hit Generate and wait ~30-60 seconds
5. Play back and download your augmented WAV

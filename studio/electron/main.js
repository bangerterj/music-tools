const { app, BrowserWindow, Tray, Menu, nativeImage, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const PORT = 8765;
const BACKEND_URL = `http://127.0.0.1:${PORT}`;
const HEALTH_URL = `${BACKEND_URL}/health`;
const MAX_WAIT_MS = 45000;
const POLL_INTERVAL_MS = 500;

let mainWindow = null;
let splashWindow = null;
let tray = null;
let backendProcess = null;

// ── Backend ────────────────────────────────────────────────

function findPython() {
  // Look for venv python relative to this file (studio/electron/main.js)
  const studioDir = path.join(__dirname, '..');
  const candidates = [
    path.join(studioDir, 'venv', 'bin', 'python3'),
    path.join(studioDir, 'venv', 'bin', 'python'),
    path.join(studioDir, 'venv', 'Scripts', 'python.exe'), // Windows
    'python3',
    'python',
  ];
  for (const p of candidates) {
    if (p.startsWith('/') || p.includes('\\')) {
      if (fs.existsSync(p)) return p;
    } else {
      return p; // system path — hope for the best
    }
  }
  return 'python3';
}

function startBackend() {
  const python = findPython();
  const backendDir = path.join(__dirname, '..', 'backend');

  console.log(`Starting backend: ${python} -m uvicorn main:app --host 127.0.0.1 --port ${PORT}`);

  backendProcess = spawn(
    python,
    ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(PORT)],
    {
      cwd: backendDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    }
  );

  backendProcess.stdout.on('data', (d) => console.log('[backend]', d.toString().trim()));
  backendProcess.stderr.on('data', (d) => console.error('[backend]', d.toString().trim()));

  backendProcess.on('exit', (code) => {
    console.log(`Backend exited with code ${code}`);
  });
}

function pollHealth(resolve, reject, deadline) {
  if (Date.now() > deadline) {
    reject(new Error('Backend did not start in time'));
    return;
  }
  http.get(HEALTH_URL, (res) => {
    if (res.statusCode === 200) resolve();
    else setTimeout(() => pollHealth(resolve, reject, deadline), POLL_INTERVAL_MS);
  }).on('error', () => {
    setTimeout(() => pollHealth(resolve, reject, deadline), POLL_INTERVAL_MS);
  });
}

function waitForBackend() {
  return new Promise((resolve, reject) => {
    pollHealth(resolve, reject, Date.now() + MAX_WAIT_MS);
  });
}

// ── Splash window ─────────────────────────────────────────

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 280,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: { nodeIntegration: false },
  });

  // Inline splash HTML
  const splashHTML = `
    <!DOCTYPE html>
    <html>
    <head>
    <meta charset="UTF-8">
    <style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body {
        background: #141414;
        color: #e8e8e8;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100vh;
        border-radius: 10px;
        overflow: hidden;
        border: 1px solid #333;
      }
      h1 { font-size: 36px; font-weight: 700; color: #4CAF50; letter-spacing: 0.08em; }
      p { font-size: 13px; color: #888; margin-top: 8px; }
      .spinner {
        width: 32px; height: 32px;
        border: 2px solid #333;
        border-top-color: #4CAF50;
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        margin-top: 28px;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      .status { font-size: 11px; color: #666; margin-top: 12px; }
    </style>
    </head>
    <body>
      <h1>Studio</h1>
      <p>AI-powered DAW</p>
      <div class="spinner"></div>
      <div class="status">Starting backend…</div>
    </body>
    </html>
  `;

  splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHTML));
}

// ── Main window ───────────────────────────────────────────

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(BACKEND_URL);

  mainWindow.once('ready-to-show', () => {
    splashWindow?.close();
    splashWindow = null;
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ── Tray ──────────────────────────────────────────────────

function createTray() {
  // Use a simple 16x16 green dot as tray icon
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAABYSURBVDiNY/z//z8DJYCJgUIwaoDBAADHDAQHAABJRU5ErkJggg=='
  );

  tray = new Tray(icon);
  tray.setToolTip('Studio DAW');

  const menu = Menu.buildFromTemplate([
    { label: 'Show Studio', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Hide', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ── App lifecycle ─────────────────────────────────────────

app.whenReady().then(async () => {
  createSplash();
  startBackend();

  try {
    await waitForBackend();
  } catch (e) {
    console.error('Backend failed to start:', e.message);
    // Still try to open — will show error in browser
  }

  createMainWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // On macOS keep app running in tray; elsewhere quit
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
  else { mainWindow.show(); mainWindow.focus(); }
});

app.on('before-quit', () => {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
});

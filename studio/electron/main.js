const { app, BrowserWindow, Tray, Menu, nativeImage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 8765;
const BACKEND_URL = `http://127.0.0.1:${PORT}`;
const MAX_WAIT_MS = 30000;

let mainWindow = null;
let splashWindow = null;
let tray = null;
let backendProcess = null;

// ── Backend management ────────────────────────────────────────────

function startBackend() {
  const studioDir = path.join(__dirname, '..');
  const venvPython = path.join(studioDir, 'venv', 'bin', 'python');
  const backendDir = path.join(studioDir, 'backend');

  const python = require('fs').existsSync(venvPython) ? venvPython : 'python3';

  backendProcess = spawn(python, [
    '-m', 'uvicorn', 'main:app',
    '--host', '127.0.0.1',
    '--port', String(PORT),
  ], {
    cwd: backendDir,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  backendProcess.stdout.on('data', d => console.log('[backend]', d.toString().trim()));
  backendProcess.stderr.on('data', d => console.error('[backend]', d.toString().trim()));
  backendProcess.on('exit', code => console.log('[backend] exited', code));
}

function killBackend() {
  if (backendProcess) {
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }
}

// ── Health polling ────────────────────────────────────────────────

function waitForBackend(timeoutMs = MAX_WAIT_MS) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    function poll() {
      http.get(`${BACKEND_URL}/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        retry();
      }).on('error', retry);
    }
    function retry() {
      if (Date.now() - start > timeoutMs) return reject(new Error('Backend timed out'));
      setTimeout(poll, 500);
    }
    poll();
  });
}

// ── Windows ───────────────────────────────────────────────────────

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 480,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    center: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  splashWindow.loadURL(`data:text/html,
    <html><body style="margin:0;background:#111;display:flex;flex-direction:column;
      align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#e8e8e8;">
      <div style="font-size:36px;font-weight:700;letter-spacing:-1px;color:#4CAF50">Studio</div>
      <div style="margin-top:8px;font-size:13px;color:#888">Starting audio engine…</div>
      <div style="margin-top:24px;width:200px;height:4px;background:#222;border-radius:2px;overflow:hidden">
        <div style="width:100%;height:100%;background:#4CAF50;animation:slide 1.2s ease-in-out infinite alternate"
             id="bar"></div>
      </div>
      <style>@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(100%)}}</style>
    </body></html>
  `);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    show: false,
    backgroundColor: '#111111',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(BACKEND_URL);
  mainWindow.once('ready-to-show', () => {
    if (splashWindow) { splashWindow.destroy(); splashWindow = null; }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('close', (e) => {
    if (process.platform === 'darwin') {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ── Tray ──────────────────────────────────────────────────────────

function createTray() {
  // Inline 16×16 green circle as tray icon
  const icon = nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABmJLR0QA/wD/AP+gvaeTAAAATklEQVQ4y2NgGAWkAkYGBob/DKQCAAAASUVORK5CYII='
  );
  tray = new Tray(icon);
  tray.setToolTip('Studio');
  const menu = Menu.buildFromTemplate([
    { label: 'Show', click: () => mainWindow?.show() },
    { label: 'Hide', click: () => mainWindow?.hide() },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow?.isVisible()) mainWindow.focus();
    else mainWindow?.show();
  });
}

// ── App lifecycle ─────────────────────────────────────────────────

app.whenReady().then(async () => {
  createSplash();
  startBackend();

  try {
    await waitForBackend();
  } catch (e) {
    console.error('Backend failed to start:', e.message);
    app.quit();
    return;
  }

  createMainWindow();
  createTray();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow) mainWindow.show();
});

app.on('before-quit', () => {
  app.isQuitting = true;
  killBackend();
});

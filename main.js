const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios');
const { fetchStories, getHeaders } = require('./src/snapchat');

const GITHUB_REPO = 'cpt-r3tr0/snapchat-story-viewer';
const CURRENT_VERSION = app.getVersion();

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: '#0f0f0f',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(() => {
  createWindow();
  // Check for updates after the window has finished loading so it doesn't
  // block the initial render and the banner has a DOM to attach to.
  mainWindow.webContents.once('did-finish-load', () => checkForUpdates());
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});

// --- IPC: search-user ---
ipcMain.handle('search-user', async (_event, username) => {
  try {
    const data = await fetchStories(username.trim());
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- IPC: download-story ---
ipcMain.handle('download-story', async (_event, snap) => {
  try {
    const ext = snap.mediaType === 'video' ? 'mp4' : 'jpg';
    const safeName = `snap_${snap.id}.${ext}`;
    const destPath = path.join(os.homedir(), 'Downloads', safeName);

    await downloadSnap(snap, destPath);
    return { ok: true, path: destPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- IPC: download-all ---
ipcMain.handle('download-all', async (event, snaps, username) => {
  try {
    const folderName = `${username}_stories_${Date.now()}`;
    const folderPath = path.join(os.homedir(), 'Downloads', folderName);
    fs.mkdirSync(folderPath, { recursive: true });

    for (let i = 0; i < snaps.length; i++) {
      const snap = snaps[i];
      const ext = snap.mediaType === 'video' ? 'mp4' : 'jpg';
      const idx = String(i + 1).padStart(3, '0');
      const destPath = path.join(folderPath, `${idx}_${snap.source}.${ext}`);

      await downloadSnap(snap, destPath);

      event.sender.send('download-progress', {
        current: i + 1,
        total: snaps.length,
      });
    }

    shell.openPath(folderPath);
    return { ok: true, folder: folderPath };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// --- IPC: open-release-url ---
ipcMain.handle('open-release-url', (_event, url) => shell.openExternal(url));

// --- Helpers ---

async function checkForUpdates() {
  try {
    const { data } = await axios.get(
      `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
      { timeout: 10000, headers: { 'User-Agent': 'snapchat-story-viewer' } }
    );
    const latest = data.tag_name.replace(/^v/, '');
    if (isNewerVersion(latest, CURRENT_VERSION)) {
      mainWindow.webContents.send('update-available', {
        version: latest,
        releaseUrl: data.html_url,
      });
    }
  } catch {
    // Network unavailable or repo has no releases yet — fail silently
  }
}

// Returns true if `a` is a higher semver than `b`
function isNewerVersion(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

async function downloadSnap(snap, destPath) {
  await streamDownload(snap.mediaUrl, destPath);
}

async function streamDownload(url, destPath) {
  const response = await axios.get(url, {
    headers: getHeaders(),
    responseType: 'stream',
    timeout: 30000,
  });

  return new Promise((resolve, reject) => {
    const writer = fs.createWriteStream(destPath);
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
    response.data.on('error', reject);
  });
}

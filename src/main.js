const { app, BrowserWindow, globalShortcut, session, shell, dialog } = require('electron');
const path = require('path');
const paths = require('./paths');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Keep Electron windows active without background throttling (like IndoFinity)
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow = null;
let floatingHudWindow = null;
let floatingHudLocked = false;
let ttLoginWindow = null;

const PORT = parseInt(process.env.DASHBOARD_PORT) || 3000;

/**
 * Expose native Electron capabilities to src/server.js
 */
global.agivaElectronBridge = {
  isElectron: true,

  openExternal(url) {
    if (url && typeof shell?.openExternal === 'function') {
      shell.openExternal(url);
      return true;
    }
    return false;
  },

  async selectFolder(defaultPath) {
    try {
      const res = await dialog.showOpenDialog(mainWindow || undefined, {
        title: 'Pilih Folder Preset & Game',
        defaultPath: defaultPath || undefined,
        properties: ['openDirectory', 'createDirectory']
      });
      return { canceled: res.canceled, folderPath: res.filePaths?.[0] || null };
    } catch (e) {
      return { canceled: true, error: e.message };
    }
  },

  quit() {
    try { globalShortcut.unregisterAll(); } catch {}
    app.quit();
  },

  getStatus() {
    return {
      isElectron: true,
      hudOpen: Boolean(floatingHudWindow && !floatingHudWindow.isDestroyed()),
      hudLocked: floatingHudLocked
    };
  },

  toggleFloatingHud(action = 'toggle') {
    if (action === 'close' || (action === 'toggle' && floatingHudWindow && !floatingHudWindow.isDestroyed())) {
      if (floatingHudWindow && !floatingHudWindow.isDestroyed()) {
        floatingHudWindow.close();
      }
      floatingHudWindow = null;
      floatingHudLocked = false;
      return this.getStatus();
    }

    if (!floatingHudWindow || floatingHudWindow.isDestroyed()) {
      floatingHudWindow = new BrowserWindow({
        width: 360,
        height: 580,
        x: 24,
        y: 60,
        alwaysOnTop: true,
        autoHideMenuBar: true,
        frame: false,
        resizable: true,
        transparent: true,
        skipTaskbar: true,
        hasShadow: false,
        backgroundColor: '#00000000',
        title: 'Agiva In-Game HUD',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false
        }
      });
      floatingHudWindow.loadURL(`http://localhost:${PORT}/overlay?widget=hud`);
      floatingHudWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      floatingHudWindow.setAlwaysOnTop(true, 'screen-saver', 1);
      floatingHudWindow.on('closed', () => {
        floatingHudWindow = null;
        floatingHudLocked = false;
      });
    } else {
      floatingHudWindow.show();
      floatingHudWindow.focus();
    }
    return this.getStatus();
  },

  setHudLock(locked) {
    floatingHudLocked = Boolean(locked);
    if (floatingHudWindow && !floatingHudWindow.isDestroyed()) {
      if (floatingHudLocked) {
        floatingHudWindow.setIgnoreMouseEvents(true, { forward: true });
      } else {
        floatingHudWindow.setIgnoreMouseEvents(false);
      }
    }
    return this.getStatus();
  },

  openTikTokLogin(onSessionCaptured) {
    if (ttLoginWindow && !ttLoginWindow.isDestroyed()) {
      ttLoginWindow.focus();
      return { opened: true };
    }
    ttLoginWindow = new BrowserWindow({
      width: 820,
      height: 760,
      title: 'Login TikTok Live — Agiva Session Extractor',
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });
    ttLoginWindow.loadURL('https://www.tiktok.com/login');

    const checkCookies = async () => {
      try {
        const cookies = await session.defaultSession.cookies.get({ domain: '.tiktok.com' });
        const sessCookie = cookies.find(c => c.name === 'sessionid' && c.value);
        if (sessCookie && sessCookie.value) {
          if (typeof onSessionCaptured === 'function') {
            onSessionCaptured(sessCookie.value);
          }
          if (ttLoginWindow && !ttLoginWindow.isDestroyed()) {
            ttLoginWindow.close();
          }
          ttLoginWindow = null;
        }
      } catch {}
    };

    const cookieInterval = setInterval(checkCookies, 2000);
    ttLoginWindow.on('closed', () => {
      clearInterval(cookieInterval);
      ttLoginWindow = null;
    });
    return { opened: true };
  },

  registerHotkeys(hotkeyMap = {}, handlerFn) {
    try {
      globalShortcut.unregisterAll();
      for (const [action, accelerator] of Object.entries(hotkeyMap)) {
        if (!accelerator) continue;
        try {
          globalShortcut.register(accelerator, () => {
            if (action === 'toggle_hud_lock') {
              this.setHudLock(!floatingHudLocked);
            }
            if (typeof handlerFn === 'function') {
              handlerFn(action, accelerator);
            }
          });
        } catch (e) {
          console.error(`[Hotkeys] Failed to register ${accelerator} for ${action}:`, e.message);
        }
      }
    } catch (e) {
      console.error('[Hotkeys] Error registering shortcuts:', e.message);
    }
  }
};

function createWindow() {
  require('./server.js');

  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    title: 'Agiva Universal Streamer Mod Dashboard',
    backgroundColor: '#0b0e17',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    },
    autoHideMenuBar: true
  });

  mainWindow.loadURL(`http://localhost:${PORT}/dashboard`);

  mainWindow.on('closed', function () {
    if (floatingHudWindow && !floatingHudWindow.isDestroyed()) {
      floatingHudWindow.close();
    }
    mainWindow = null;
  });
}

app.on('ready', createWindow);

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.on('window-all-closed', function () {
  try { globalShortcut.unregisterAll(); } catch {}
  app.quit();
});

app.on('quit', () => {
  process.exit(0);
});

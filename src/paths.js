// src/paths.js — Centralized Path & Storage Resolution for Agiva Mod
// Handles Dev Mode, Packaged NSIS (Installed), and Portable Executable Mode
'use strict';

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Detect Electron runtime
const isElectron = Boolean(process.versions && process.versions.electron);
let electronApp = null;
let isPackaged = false;

if (isElectron) {
  try {
    electronApp = require('electron').app;
    isPackaged = electronApp ? Boolean(electronApp.isPackaged) : false;
  } catch (e) {
    // child process / worker
  }
}

// 1. Determine Bundled Root (inside app.asar or repo root during dev)
const BUNDLED_ROOT = path.resolve(__dirname, '..');

// 2. Determine Writable User Data Root
let WRITABLE_ROOT;

if (process.env.AGIVA_DATA_DIR) {
  // Explicit custom override
  WRITABLE_ROOT = path.resolve(process.env.AGIVA_DATA_DIR);
} else if (process.env.PORTABLE_EXECUTABLE_DIR) {
  // Running as Electron-Builder portable executable
  // Store user data in an 'agiva-data' folder right next to the portable .exe
  WRITABLE_ROOT = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'agiva-data');
} else if (isPackaged && electronApp) {
  // Installed application (NSIS): %APPDATA%/junkyard-mod-agiva
  WRITABLE_ROOT = electronApp.getPath('userData');
} else {
  // Development mode / standalone Node.js: project root
  WRITABLE_ROOT = BUNDLED_ROOT;
}

// Ensure base writable directory exists
try {
  if (!fs.existsSync(WRITABLE_ROOT)) {
    fs.mkdirSync(WRITABLE_ROOT, { recursive: true });
  }
} catch (e) {
  console.error('[Paths] Failed to create writable root directory:', e.message);
}

// Specific Writable Paths
const ENV_PATH = path.join(WRITABLE_ROOT, '.env');
const DATA_DIR = path.join(WRITABLE_ROOT, 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

let customGamesDir = process.env.GAMES_DIR || process.env.PRESETS_DIR || null;
let currentGamesDir = customGamesDir ? path.resolve(customGamesDir) : path.join(WRITABLE_ROOT, 'games');

function getGamesDir() {
  return currentGamesDir;
}

function setGamesDir(newDir) {
  if (newDir && typeof newDir === 'string') {
    currentGamesDir = path.resolve(newDir);
    if (!fs.existsSync(currentGamesDir)) {
      fs.mkdirSync(currentGamesDir, { recursive: true });
    }
    copyDirIfMissing(BUNDLED_GAMES_DIR, currentGamesDir);
  }
  return currentGamesDir;
}

const SOUNDS_DIR = (WRITABLE_ROOT === BUNDLED_ROOT)
  ? path.join(BUNDLED_ROOT, 'public/sounds')
  : path.join(WRITABLE_ROOT, 'sounds');

const EFFECTS_CONFIG_PATH = path.join(WRITABLE_ROOT, 'effects-config.json');
const GIFTS_DATA_PATH = path.join(WRITABLE_ROOT, 'gifts-data.json');
const HOTKEYS_PATH = path.join(DATA_DIR, 'hotkeys.json');
const TTS_CONFIG_PATH = path.join(DATA_DIR, 'tts-sound-config.json');
const COMPAT_CONFIG_PATH = path.join(DATA_DIR, 'compat-ports.json');
const OBS_CONFIG_PATH = path.join(DATA_DIR, 'obs-config.json');
const DONATION_CONFIG_PATH = path.join(DATA_DIR, 'donation-config.json');
const WIDGETS_CONFIG_PATH = path.join(DATA_DIR, 'widgets-config.json');

// Bundled reference paths (read-only fallbacks / seeds)
const BUNDLED_SOUNDS_DIR = path.join(BUNDLED_ROOT, 'public/sounds');
const BUNDLED_GAMES_DIR = path.join(BUNDLED_ROOT, 'games');
const BUNDLED_EFFECTS_CONFIG = path.join(BUNDLED_ROOT, 'effects-config.json');
const BUNDLED_GIFTS_DATA = path.join(BUNDLED_ROOT, 'gifts-data.json');
const BUNDLED_DATA_DIR = path.join(BUNDLED_ROOT, 'data');

// Helper to copy directory recursively if not exists
function copyDirIfMissing(srcDir, destDir) {
  try {
    if (!fs.existsSync(srcDir)) return;
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        copyDirIfMissing(srcPath, destPath);
      } else if (!fs.existsSync(destPath)) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  } catch (err) {
    console.error(`[Paths] Error copying directory ${srcDir} to ${destDir}:`, err.message);
  }
}

// Initial bootstrap if running in packaged mode (portable or installed)
if (WRITABLE_ROOT !== BUNDLED_ROOT) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    if (!fs.existsSync(SOUNDS_DIR)) fs.mkdirSync(SOUNDS_DIR, { recursive: true });

    // Seed effects-config.json if missing
    if (!fs.existsSync(EFFECTS_CONFIG_PATH) && fs.existsSync(BUNDLED_EFFECTS_CONFIG)) {
      fs.copyFileSync(BUNDLED_EFFECTS_CONFIG, EFFECTS_CONFIG_PATH);
    }
    // Seed gifts-data.json if missing
    if (!fs.existsSync(GIFTS_DATA_PATH) && fs.existsSync(BUNDLED_GIFTS_DATA)) {
      fs.copyFileSync(BUNDLED_GIFTS_DATA, GIFTS_DATA_PATH);
    }
    // Seed games directory if missing
    if (!fs.existsSync(GAMES_DIR) && fs.existsSync(BUNDLED_GAMES_DIR)) {
      copyDirIfMissing(BUNDLED_GAMES_DIR, GAMES_DIR);
    }
    // Seed bundled data/*.json templates
    if (fs.existsSync(BUNDLED_DATA_DIR)) {
      copyDirIfMissing(BUNDLED_DATA_DIR, DATA_DIR);
    }
    // Create .env if not exists
    if (!fs.existsSync(ENV_PATH)) {
      const sampleEnv = path.join(BUNDLED_ROOT, '.env.example');
      if (fs.existsSync(sampleEnv)) {
        fs.copyFileSync(sampleEnv, ENV_PATH);
      } else {
        fs.writeFileSync(ENV_PATH, '# Agiva Mod Environment\nDASHBOARD_PORT=3000\nMOD_WS_PORT=7827\n', 'utf8');
      }
    }
  } catch (e) {
    console.error('[Paths] Initialization error:', e.message);
  }
}

// Load environment variables from writable ENV_PATH, fallback to bundled .env
if (fs.existsSync(ENV_PATH)) {
  dotenv.config({ path: ENV_PATH });
} else {
  const fallbackEnv = path.join(BUNDLED_ROOT, '.env');
  if (fs.existsSync(fallbackEnv)) {
    dotenv.config({ path: fallbackEnv });
  }
}

module.exports = {
  isElectron,
  isPackaged,
  BUNDLED_ROOT,
  WRITABLE_ROOT,
  ENV_PATH,
  DATA_DIR,
  SESSIONS_DIR,
  get GAMES_DIR() { return currentGamesDir; },
  getGamesDir,
  setGamesDir,
  copyDirIfMissing,
  SOUNDS_DIR,
  BUNDLED_SOUNDS_DIR,
  BUNDLED_GAMES_DIR,
  EFFECTS_CONFIG_PATH,
  GIFTS_DATA_PATH,
  HOTKEYS_PATH,
  TTS_CONFIG_PATH,
  COMPAT_CONFIG_PATH,
  OBS_CONFIG_PATH,
  DONATION_CONFIG_PATH,
  WIDGETS_CONFIG_PATH
};

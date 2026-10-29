// gameDetect.js — Modular Game & Preset Registry + BepInEx/Process Scanner
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

// Legacy BepInEx DLL mapping
const KNOWN_DLL_MAP = {
  'TikTokLiveMod': 'CarJunkyard'
};

class GameDetect {
  constructor() {
    this.detectedGames = [];
    this.activeGameId = 'CarJunkyard';
    this.activePresetId = 'default';
    this.gamePath = process.env.GAME_PATH || path.join(__dirname, '../..');
    this._ensureGamesDir();
  }

  getGamesDir() {
    return paths.getGamesDir ? paths.getGamesDir() : paths.GAMES_DIR;
  }

  setGamesDir(newDir) {
    if (paths.setGamesDir) {
      paths.setGamesDir(newDir);
    }
    this._ensureGamesDir();
    return this.scan();
  }

  _ensureGamesDir() {
    const dir = this.getGamesDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Scan games/<gameId>/manifest.json + BepInEx plugins folder for all available games
   */
  scan() {
    this._ensureGamesDir();
    const gamesDir = this.getGamesDir();
    const gamesMap = new Map();

    // 1. Load all modular manifests from `games/<gameId>/manifest.json`
    try {
      const entries = fs.readdirSync(gamesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const manifestPath = path.join(gamesDir, entry.name, 'manifest.json');
        if (fs.existsSync(manifestPath)) {
          try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            const gameId = manifest.id || entry.name;
            const presets = this.getPresets(gameId);
            gamesMap.set(gameId, {
              id: gameId,
              name: manifest.name || gameId,
              icon: manifest.icon || '🎮',
              category: manifest.category || 'General',
              driver: manifest.driver || 'ws-mod',
              inputMethod: manifest.inputMethod || 'sendinput',
              targetProcess: manifest.targetProcess || '',
              rconConfig: manifest.rconConfig || null,
              description: manifest.description || '',
              modFolder: manifest.modFolder || '',
              bepinexFolder: manifest.bepinexFolder || '',
              effects: manifest.effects || {},
              presets,
              status: 'ready'
            });
          } catch (e) {
            console.error(`[GameDetect] Error parsing manifest for ${entry.name}:`, e.message);
          }
        }
      }
    } catch (e) {
      console.error('[GameDetect] Failed to scan games directory:', e.message);
    }

    // 2. Scan BepInEx/plugins folder for installed DLLs if present
    const pluginsPath = path.join(this.gamePath, 'BepInEx', 'plugins');
    if (fs.existsSync(pluginsPath)) {
      try {
        const entries = fs.readdirSync(pluginsPath, { withFileTypes: true });
        for (const entry of entries) {
          const baseName = entry.name.replace(/\.dll$/i, '');
          const mappedId = KNOWN_DLL_MAP[baseName];
          if (mappedId && gamesMap.has(mappedId)) {
            const g = gamesMap.get(mappedId);
            g.installedMod = true;
          }
        }
      } catch (e) {
        console.error('[GameDetect] Error scanning BepInEx plugins:', e.message);
      }
    }

    // Ensure CarJunkyard is first if present
    const list = Array.from(gamesMap.values());
    list.sort((a, b) => {
      if (a.id === 'CarJunkyard') return -1;
      if (b.id === 'CarJunkyard') return 1;
      return a.name.localeCompare(b.name);
    });

    this.detectedGames = list;
    if (list.length > 0 && !gamesMap.has(this.activeGameId)) {
      this.activeGameId = list[0].id;
    }
    return list;
  }

  getDetected() {
    return this.scan();
  }

  getGameManifest(gameId) {
    const manifestPath = path.join(this.getGamesDir(), gameId, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      return null;
    }
  }

  saveGameManifest(gameId, manifestData) {
    const safeId = String(gameId).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeId) throw new Error('Invalid game ID');
    const dir = path.join(this.getGamesDir(), safeId);
    const presetsDir = path.join(dir, 'presets');
    fs.mkdirSync(presetsDir, { recursive: true });

    const existing = this.getGameManifest(safeId) || {};
    const merged = {
      ...existing,
      ...manifestData,
      id: safeId,
      effects: manifestData.effects || existing.effects || {}
    };
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(merged, null, 2), 'utf8');

    // Ensure at least default preset exists
    const defaultPresetPath = path.join(presetsDir, 'default.json');
    if (!fs.existsSync(defaultPresetPath)) {
      const firstEffectId = Object.keys(merged.effects)[0] || '';
      const defaultPreset = {
        id: 'default',
        name: 'Default Preset',
        gameId: safeId,
        description: `Preset standar untuk ${merged.name || safeId}`,
        giftMappings: firstEffectId ? [
          { id: 'tier_1', enabled: true, label: 'Rose Trigger', giftId: 5655, effectId: firstEffectId }
        ] : [],
        coinTiers: [],
        socialEvents: firstEffectId ? [
          { eventType: 'follow', effectId: firstEffectId, enabled: true }
        ] : [],
        eventMappings: {
          follow: { effectId: firstEffectId, enabled: Boolean(firstEffectId) },
          like: { thresholds: firstEffectId ? [{ count: 100, effectId: firstEffectId, enabled: true }] : [] }
        },
        chatCommands: [],
        donationTiers: []
      };
      fs.writeFileSync(defaultPresetPath, JSON.stringify(defaultPreset, null, 2), 'utf8');
    }

    this.scan();
    return merged;
  }

  deleteGame(gameId) {
    const safeId = String(gameId).replace(/[^a-zA-Z0-9_-]/g, '');
    if (!safeId || safeId === 'CarJunkyard') {
      throw new Error('Cannot delete primary built-in game');
    }
    const dir = path.join(this.getGamesDir(), safeId);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    this.scan();
    return true;
  }

  getPresets(gameId) {
    const safeId = String(gameId).replace(/[^a-zA-Z0-9_-]/g, '');
    const presetsDir = path.join(this.getGamesDir(), safeId, 'presets');
    if (!fs.existsSync(presetsDir)) return [];

    const presets = [];
    try {
      const files = fs.readdirSync(presetsDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(presetsDir, file), 'utf8'));
          const id = data.id || file.replace(/\.json$/i, '');
          presets.push({ ...data, id });
        } catch {}
      }
    } catch {}

    presets.sort((a, b) => (a.id === 'default' ? -1 : b.id === 'default' ? 1 : a.name.localeCompare(b.name)));
    return presets;
  }

  getPreset(gameId, presetId = 'default') {
    const presets = this.getPresets(gameId);
    return presets.find(p => p.id === presetId) || presets[0] || null;
  }

  savePreset(gameId, presetId, presetData) {
    const safeGameId = String(gameId).replace(/[^a-zA-Z0-9_-]/g, '');
    const safePresetId = String(presetId || 'default').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase() || 'custom';
    const presetsDir = path.join(this.getGamesDir(), safeGameId, 'presets');
    fs.mkdirSync(presetsDir, { recursive: true });

    const payload = {
      ...presetData,
      id: safePresetId,
      gameId: safeGameId,
      name: presetData.name || safePresetId
    };
    fs.writeFileSync(path.join(presetsDir, `${safePresetId}.json`), JSON.stringify(payload, null, 2), 'utf8');
    return payload;
  }

  deletePreset(gameId, presetId) {
    const safeGameId = String(gameId).replace(/[^a-zA-Z0-9_-]/g, '');
    const safePresetId = String(presetId).replace(/[^a-zA-Z0-9_-]/g, '');
    if (safePresetId === 'default') throw new Error('Preset default tidak dapat dihapus');
    const filePath = path.join(this.getGamesDir(), safeGameId, 'presets', `${safePresetId}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  }

  setActiveGame(gameId, presetId = 'default') {
    this.activeGameId = gameId;
    this.activePresetId = presetId || 'default';
  }

  getActiveGame() {
    if (this.detectedGames.length === 0) this.scan();
    return this.detectedGames.find(g => g.id === this.activeGameId) || this.detectedGames[0] || null;
  }
}

module.exports = new GameDetect();

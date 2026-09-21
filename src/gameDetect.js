// gameDetect.js — Scan BepInEx plugins to detect active games
'use strict';

const fs = require('fs');
const path = require('path');

// Known games database
const KNOWN_GAMES = {
  'TikTokLiveMod': {
    id: 'CarJunkyard',
    name: 'I Need to Fix My Dream Car',
    icon: '🚗',
    description: 'Repair and customize your dream car in a junkyard',
    configKey: 'CarJunkyard'
  }
};

class GameDetect {
  constructor() {
    this.detectedGames = [];
    this.activeGameId = null;
    this.gamePath = process.env.GAME_PATH || path.join(__dirname, '../..');
  }

  /**
   * Scan BepInEx/plugins folder for installed mods
   */
  scan() {
    const detected = [];
    const pluginsPath = path.join(this.gamePath, 'BepInEx', 'plugins');

    if (!fs.existsSync(pluginsPath)) {
      console.log('[GameDetect] BepInEx plugins folder not found at:', pluginsPath);
      return detected;
    }

    try {
      const entries = fs.readdirSync(pluginsPath, { withFileTypes: true });
      for (const entry of entries) {
        // Check folder names
        if (entry.isDirectory()) {
          const game = this._matchGame(entry.name);
          if (game && !detected.find(g => g.id === game.id)) {
            detected.push({ ...game, modFolder: entry.name });
          }
        }
        // Check DLL names directly in plugins root
        if (entry.isFile() && entry.name.endsWith('.dll')) {
          const game = this._matchGame(entry.name.replace('.dll', ''));
          if (game && !detected.find(g => g.id === game.id)) {
            detected.push({ ...game, modDll: entry.name });
          }
        }
      }
    } catch (e) {
      console.error('[GameDetect] Error scanning plugins:', e.message);
    }

    // Always include the host game
    if (!detected.find(g => g.id === 'CarJunkyard')) {
      detected.unshift({
        id: 'CarJunkyard',
        name: 'I Need to Fix My Dream Car',
        icon: '🚗',
        description: 'Repair and customize your dream car in a junkyard',
        configKey: 'CarJunkyard',
        modFolder: 'TikTokLiveMod',
        status: 'primary'
      });
    }

    this.detectedGames = detected;
    if (detected.length > 0 && !this.activeGameId) {
      this.activeGameId = detected[0].id;
    }
    return detected;
  }

  _matchGame(name) {
    for (const [key, game] of Object.entries(KNOWN_GAMES)) {
      if (name.toLowerCase().includes(key.toLowerCase())) {
        return game;
      }
    }
    return null;
  }

  getDetected() {
    if (this.detectedGames.length === 0) this.scan();
    return this.detectedGames;
  }

  setActiveGame(id) {
    this.activeGameId = id;
  }

  getActiveGame() {
    return this.detectedGames.find(g => g.id === this.activeGameId) || null;
  }
}

module.exports = new GameDetect(); // singleton

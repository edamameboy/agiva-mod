// effectMap.js — Load config, resolve gift → effect, track like count
'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../effects-config.json');

class EffectMap {
  constructor() {
    this.config = null;
    this.likeCounters = {}; // { sessionId: totalLikes }
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      this.config = JSON.parse(raw);
      console.log('[EffectMap] Config loaded successfully');
    } catch (e) {
      console.error('[EffectMap] Failed to load config:', e.message);
      this.config = { giftMappings: [], eventMappings: {}, games: {}, queueSettings: {} };
    }
  }

  reload() {
    this.load();
  }

  save() {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
  }

  /**
   * Resolve a gift event to an effect by exact giftId
   * @param {number|string} giftId - The ID of the TikTok gift
   * @returns {{ effectId, label, duration } | null}
   */
  resolveGiftById(giftId) {
    if (!giftId) return null;
    const mappings = (this.config.giftMappings || []).filter(m => m.enabled);
    // Find the mapping that exactly matches the giftId (coerced to string for safety)
    const match = mappings.find(m => String(m.giftId) === String(giftId));
    if (!match) return null;
    return this._resolveEffect(match.effectId);
  }

  /**
   * Resolve a social event (follow/share/repost)
   * @returns {Array} array of effects to trigger
   */
  resolveEvent(eventType) {
    const events = this.config.socialEvents || [];
    const triggered = [];
    
    for (const ev of events) {
      if (ev.eventType === eventType && ev.enabled) {
        const effect = this._resolveEffect(ev.effectId);
        if (effect) triggered.push(effect);
      }
    }
    
    // Fallback to legacy structure if any
    if (this.config.eventMappings && this.config.eventMappings[eventType] && this.config.eventMappings[eventType].enabled) {
      const effect = this._resolveEffect(this.config.eventMappings[eventType].effectId);
      if (effect && !triggered.find(e => e.id === effect.id)) {
        triggered.push(effect);
      }
    }
    
    return triggered;
  }

  /**
   * Resolve like threshold events
   * @param {number} likeCount - Total likes in this batch
   * @param {string} sessionId - Room session identifier
   * @returns {Array} array of effects to trigger
   */
  resolveLikes(likeCount, sessionId = 'default') {
    if (!this.likeCounters[sessionId]) this.likeCounters[sessionId] = 0;
    const before = this.likeCounters[sessionId];
    const after = before + likeCount;
    this.likeCounters[sessionId] = after;

    const thresholds = this.config.eventMappings?.like?.thresholds || [];
    const triggered = [];

    for (const t of thresholds) {
      if (!t.enabled) continue;
      const crossedBefore = Math.floor(before / t.count);
      const crossedAfter = Math.floor(after / t.count);
      if (crossedAfter > crossedBefore) {
        const effect = this._resolveEffect(t.effectId);
        if (effect) triggered.push(effect);
      }
    }
    return triggered;
  }

  resetLikeCounter(sessionId = 'default') {
    this.likeCounters[sessionId] = 0;
  }

  _resolveEffect(effectId) {
    // Search across all game effect libraries
    for (const game of Object.values(this.config.games || {})) {
      const eff = game.effects?.[effectId];
      if (eff) return { ...eff };
    }
    // Fallback: return id only
    return { id: effectId, effectId, label: effectId, duration: 0 };
  }

  getConfig() {
    return this.config;
  }

  updateGiftMapping(id, updates) {
    const idx = this.config.giftMappings.findIndex(m => m.id === id);
    if (idx !== -1) {
      this.config.giftMappings[idx] = { ...this.config.giftMappings[idx], ...updates };
      this.save();
      return true;
    }
    return false;
  }

  updateEventMapping(eventType, updates) {
    if (!this.config.eventMappings[eventType]) return false;
    this.config.eventMappings[eventType] = { ...this.config.eventMappings[eventType], ...updates };
    this.save();
    return true;
  }

  updateLikeThreshold(index, updates) {
    const thresholds = this.config.eventMappings?.like?.thresholds;
    if (!thresholds || index >= thresholds.length) return false;
    thresholds[index] = { ...thresholds[index], ...updates };
    this.save();
    return true;
  }
}

module.exports = new EffectMap(); // singleton

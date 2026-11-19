// effectMap.js — Modular Multi-Game & Multi-Preset Effect Resolver
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const gameDetect = require('./gameDetect');

const CONFIG_PATH = paths.EFFECTS_CONFIG_PATH;

class EffectMap {
  constructor() {
    this.config = null;
    this.likeCounters = {}; // { sessionId: totalLikes }
    this.commandCooldowns = {}; // { cmdKey: timestamp }
    this.userCooldowns = {}; // { cmdKey_userId: timestamp }
    this.masterSwitches = {
      all: true,
      wsMod: true,
      keystroke: true,
      rcon: true,
      webhook: true,
      tts: true,
      obs: true
    };
    this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
      this.config = JSON.parse(raw);
    } catch (e) {
      console.error('[EffectMap] Failed to load effects-config.json, initializing defaults:', e.message);
      this.config = {
        version: '3.0',
        activeGameId: 'CarJunkyard',
        activePresetId: 'default',
        games: {},
        giftMappings: [],
        coinTiers: [],
        socialEvents: [],
        eventMappings: { like: { thresholds: [] } },
        chatCommands: [],
        donationTiers: [],
        queueSettings: { maxQueueSize: 100, minDelayBetweenEffects: 500, dropOnFull: false }
      };
    }

    // Sync all modular game manifests from `games/*/manifest.json`
    this._syncGamesFromRegistry();

    const activeGameId = this.config.activeGameId || 'CarJunkyard';
    const activePresetId = this.config.activePresetId || 'default';
    this.switchGameAndPreset(activeGameId, activePresetId, false);
    console.log(`[EffectMap] Loaded active game "${this.config.activeGameId}" (preset: "${this.config.activePresetId}")`);
  }

  _syncGamesFromRegistry() {
    if (!this.config.games) this.config.games = {};
    const detected = gameDetect.scan();
    for (const g of detected) {
      const manifest = gameDetect.getGameManifest(g.id);
      if (manifest) {
        this.config.games[g.id] = {
          ...(this.config.games[g.id] || {}),
          ...manifest
        };
      }
    }
  }

  reload() {
    this.load();
  }

  /**
   * Switch active game and preset, loading that preset's mappings into active config
   */
  switchGameAndPreset(gameId, presetId = 'default', persist = true) {
    this._syncGamesFromRegistry();
    if (!this.config.games[gameId]) {
      const firstId = Object.keys(this.config.games)[0] || 'CarJunkyard';
      gameId = firstId;
    }

    const preset = gameDetect.getPreset(gameId, presetId);
    this.config.activeGameId = gameId;
    this.config.activePresetId = preset ? preset.id : 'default';
    gameDetect.setActiveGame(this.config.activeGameId, this.config.activePresetId);

    if (preset) {
      this.config.giftMappings = Array.isArray(preset.giftMappings) ? preset.giftMappings : [];
      this.config.coinTiers = Array.isArray(preset.coinTiers) ? preset.coinTiers : [];
      this.config.socialEvents = Array.isArray(preset.socialEvents) ? preset.socialEvents : [];
      this.config.eventMappings = preset.eventMappings || { like: { thresholds: [] } };
      this.config.chatCommands = Array.isArray(preset.chatCommands) ? preset.chatCommands : [];
      this.config.donationTiers = Array.isArray(preset.donationTiers) ? preset.donationTiers : [];
    }

    if (persist) {
      this.save();
    }
    return {
      activeGameId: this.config.activeGameId,
      activePresetId: this.config.activePresetId,
      game: this.getActiveGameConfig(),
      presets: gameDetect.getPresets(this.config.activeGameId)
    };
  }

  getActiveGameConfig() {
    const activeId = this.config.activeGameId || 'CarJunkyard';
    return this.config.games?.[activeId] || Object.values(this.config.games || {})[0] || null;
  }

  save() {
    // 1. Save active mappings into the current game's active preset file
    const gameId = this.config.activeGameId || 'CarJunkyard';
    const presetId = this.config.activePresetId || 'default';
    const existingPreset = gameDetect.getPreset(gameId, presetId) || { id: presetId, name: presetId };

    gameDetect.savePreset(gameId, presetId, {
      ...existingPreset,
      giftMappings: this.config.giftMappings || [],
      coinTiers: this.config.coinTiers || [],
      socialEvents: this.config.socialEvents || [],
      eventMappings: this.config.eventMappings || { like: { thresholds: [] } },
      chatCommands: this.config.chatCommands || [],
      donationTiers: this.config.donationTiers || []
    });

    // 2. Also sync active game manifest if its effects were modified
    if (this.config.games?.[gameId]) {
      gameDetect.saveGameManifest(gameId, this.config.games[gameId]);
    }

    // 3. Save root effects-config.json for backward compatibility
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
  }

  /**
   * Check whether a viewer passes Role or Specific Users filter
   */
  checkUserPermission(userMeta = {}, rule = {}) {
    const role = rule.allowedRole || rule.requiredRole || 'everyone';
    if (role === 'everyone') return true;

    const uid = String(userMeta.uniqueId || userMeta.user || '').trim().toLowerCase().replace(/^@/, '');

    if (role === 'specific_users') {
      const rawUsers = rule.allowedUsers !== undefined ? rule.allowedUsers : (rule.specificUsers ?? '');
      const list = (Array.isArray(rawUsers) ? rawUsers : String(rawUsers || '').split(','))
        .map(u => String(u || '').trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean);
      if (list.length === 0) return false;
      return list.includes(uid);
    }
    if (role === 'follower') {
      return Boolean(userMeta.isFollower || Number(userMeta.followRole) >= 1 || userMeta.isAdmin || userMeta.isModerator || userMeta.isSubscribe);
    }
    if (role === 'subscriber') {
      return Boolean(userMeta.isSubscribe || userMeta.isSuperFan || userMeta.isAdmin || userMeta.isModerator);
    }
    if (role === 'moderator') {
      return Boolean(userMeta.isModerator || userMeta.isAdmin);
    }
    if (role === 'min_gifter') {
      return Number(userMeta.gifterLevel || 0) >= Number(rule.minGifterLevel || 1);
    }
    return true;
  }

  /**
   * Support Gacha / Random Effect Pool or __random__ across active game
   */
  _pickEffectId(rule = {}) {
    if (rule.effectId === '__none__') return '__none__';
    if (rule.randomPool) {
      const pool = Array.isArray(rule.randomPool)
        ? rule.randomPool
        : String(rule.randomPool).split(',').map(s => s.trim()).filter(Boolean);
      if (pool.length > 0) {
        return pool[Math.floor(Math.random() * pool.length)];
      }
    }
    if (rule.effectId === '__random__') {
      const activeGame = this.getActiveGameConfig();
      const keys = Object.keys(activeGame?.effects || {});
      if (keys.length > 0) {
        return keys[Math.floor(Math.random() * keys.length)];
      }
    }
    return rule.effectId;
  }

  /**
   * Resolve a gift event by exact giftId first, then fallback to coinTiers if enabled
   */
  resolveGiftById(giftId, coins = 0, userMeta = {}) {
    if (giftId) {
      const mappings = (this.config.giftMappings || []).filter(m => m.enabled);
      const match = mappings.find(m => String(m.giftId) === String(giftId) && this.checkUserPermission(userMeta, m));
      if (match) {
        const chosenId = this._pickEffectId(match);
        return this._resolveEffect(chosenId, match.params, match);
      }
    }

    // Fallback: Check minimum/range coinTiers
    if (coins > 0 && Array.isArray(this.config.coinTiers)) {
      const enabledTiers = this.config.coinTiers
        .filter(t => t.enabled && coins >= (t.minCoins || 1) && coins <= (t.maxCoins || 9999999) && this.checkUserPermission(userMeta, t))
        .sort((a, b) => (b.minCoins || 0) - (a.minCoins || 0));
      if (enabledTiers.length > 0) {
        const chosenId = this._pickEffectId(enabledTiers[0]);
        return this._resolveEffect(chosenId, enabledTiers[0].params, enabledTiers[0]);
      }
    }
    return null;
  }

  /**
   * Resolve a social event (follow/share/repost/member/subscribe/like)
   */
  resolveEvent(eventType, userMeta = {}) {
    const events = this.config.socialEvents || [];
    const triggered = [];

    for (const ev of events) {
      if (ev.eventType === eventType && ev.enabled && this.checkUserPermission(userMeta, ev)) {
        const chosenId = this._pickEffectId(ev);
        const effect = this._resolveEffect(chosenId, ev.params, ev);
        if (effect) triggered.push(effect);
      }
    }

    if (this.config.eventMappings?.[eventType]?.enabled) {
      const evMap = this.config.eventMappings[eventType];
      const effect = this._resolveEffect(this._pickEffectId(evMap), evMap.params, evMap);
      if (effect && !triggered.find(e => e.id === effect.id)) {
        triggered.push(effect);
      }
    }

    return triggered;
  }

  /**
   * Resolve like threshold events
   */
  resolveLikes(likeCount, sessionId = 'default') {
    if (!this.likeCounters[sessionId]) this.likeCounters[sessionId] = 0;
    const before = this.likeCounters[sessionId];
    const after = before + likeCount;
    this.likeCounters[sessionId] = after;

    const thresholds = this.config.eventMappings?.like?.thresholds || [];
    const triggered = [];

    for (const t of thresholds) {
      if (!t.enabled || !t.count || t.count <= 0) continue;
      const crossedBefore = Math.floor(before / t.count);
      const crossedAfter = Math.floor(after / t.count);
      if (crossedAfter > crossedBefore) {
        const effect = this._resolveEffect(this._pickEffectId(t), t.params, t);
        if (effect) triggered.push(effect);
      }
    }
    return triggered;
  }

  /**
   * Resolve chat command (e.g. "!lompat", "!drop") with Role, Specific Users, Global Cooldown & Per-User Cooldown
   */
  resolveChatCommand(commentText, userMeta = {}) {
    if (!commentText || typeof commentText !== 'string') return null;
    const clean = commentText.trim().toLowerCase();
    const commands = (this.config.chatCommands || []).filter(c => c.enabled && c.command);

    for (const cmd of commands) {
      const trigger = String(cmd.command).trim().toLowerCase();
      if (clean === trigger || clean.startsWith(trigger + ' ')) {
        // 1. Check Role & Specific Users filter
        if (!this.checkUserPermission(userMeta, cmd)) {
          return null;
        }

        const now = Date.now();
        // 2. Check Global Cooldown
        const globalCdMs = (parseInt(cmd.cooldown) || 0) * 1000;
        const lastGlobal = this.commandCooldowns[trigger] || 0;
        if (globalCdMs > 0 && now - lastGlobal < globalCdMs) {
          return null;
        }

        // 3. Check Per-User Cooldown
        const uid = String(userMeta.uniqueId || userMeta.user || 'anon').toLowerCase();
        const userCdMs = (parseInt(cmd.userCooldown) || 0) * 1000;
        const userKey = `${trigger}::${uid}`;
        const lastUser = this.userCooldowns[userKey] || 0;
        if (userCdMs > 0 && now - lastUser < userCdMs) {
          return null;
        }

        this.commandCooldowns[trigger] = now;
        this.userCooldowns[userKey] = now;
        const chosenId = this._pickEffectId(cmd);
        return this._resolveEffect(chosenId, cmd.params, cmd);
      }
    }
    return null;
  }

  /**
   * Resolve external donation (Saweria, Sociabuzz, Trakteer, BagiBagi) by IDR amount
   */
  resolveDonation(amountIdr) {
    const amount = Number(amountIdr) || 0;
    if (amount <= 0) return null;
    const tiers = (this.config.donationTiers || [])
      .filter(t => t.enabled && amount >= (Number(t.minAmount) || 0))
      .sort((a, b) => (Number(b.minAmount) || 0) - (Number(a.minAmount) || 0));

    if (tiers.length > 0) {
      const chosenId = this._pickEffectId(tiers[0]);
      return this._resolveEffect(chosenId, tiers[0].params, tiers[0]);
    }
    return null;
  }

  resetLikeCounter(sessionId = 'default') {
    this.likeCounters[sessionId] = 0;
  }

  /**
   * Resolve effect strictly from the active game first, enriching with game driver & multi-action chaining info
   */
  _resolveEffect(effectId, customParams = {}, triggerRule = {}) {
    const hasRuleMultiAction = Boolean(
      triggerRule && (
        triggerRule.actionId ||
        triggerRule.soundId ||
        triggerRule.ttsTemplate ||
        triggerRule.spinWheel ||
        triggerRule.obsScene ||
        triggerRule.overlayMediaUrl ||
        Number(triggerRule.timerAddSec)
      )
    );
    const isNoGameEffect = effectId === '__none__' || (!effectId && hasRuleMultiAction);
    if (!effectId && !isNoGameEffect) return null;
    const activeGame = this.getActiveGameConfig();
    const chainActions = {
      multiplyByRepeat: Boolean(triggerRule.multiplyByRepeat),
      ttsTemplate: triggerRule.ttsTemplate || '',
      soundId: triggerRule.soundId || '',
      overlayScreen: Number(triggerRule.overlayScreen) || 0,
      overlayMediaUrl: triggerRule.overlayMediaUrl || '',
      timerAddSec: Number(triggerRule.timerAddSec) || 0,
      spinWheel: Boolean(triggerRule.spinWheel),
      obsScene: triggerRule.obsScene || '',
      obsDurationSec: Number(triggerRule.obsDurationSec) || 5,
      actionId: triggerRule.actionId || '',
      costPoints: Number(triggerRule.costPoints) || 0
    };

    if (isNoGameEffect) {
      return {
        id: '__none__',
        effectId: '__none__',
        label: triggerRule.label || 'Multi-Action Only',
        skipGameEffect: true,
        duration: 0,
        gameId: activeGame?.id || this.config.activeGameId || '',
        driver: 'none',
        inputMethod: '',
        targetProcess: '',
        rconConfig: null,
        params: customParams || {},
        chainActions
      };
    }

    if (activeGame && activeGame.effects?.[effectId]) {
      const eff = activeGame.effects[effectId];
      return {
        ...eff,
        id: eff.id || effectId,
        effectId: eff.id || effectId,
        gameId: activeGame.id || this.config.activeGameId,
        driver: eff.driver || activeGame.driver || 'ws-mod',
        inputMethod: eff.inputMethod || activeGame.inputMethod || 'sendinput',
        targetProcess: eff.targetProcess || activeGame.targetProcess || '',
        rconConfig: activeGame.rconConfig || null,
        params: { ...(eff.defaultParams || {}), ...(customParams || {}) },
        chainActions
      };
    }

    // Fallback search across other games if not in active game
    for (const [gameKey, game] of Object.entries(this.config.games || {})) {
      const eff = game.effects?.[effectId];
      if (eff) {
        return {
          ...eff,
          id: eff.id || effectId,
          effectId: eff.id || effectId,
          gameId: game.id || gameKey,
          driver: eff.driver || game.driver || 'ws-mod',
          inputMethod: eff.inputMethod || game.inputMethod || 'sendinput',
          targetProcess: eff.targetProcess || game.targetProcess || '',
          rconConfig: game.rconConfig || null,
          params: { ...(eff.defaultParams || {}), ...(customParams || {}) },
          chainActions
        };
      }
    }

    return {
      id: effectId,
      effectId,
      label: effectId,
      duration: 0,
      gameId: this.config.activeGameId || 'CarJunkyard',
      driver: activeGame?.driver || 'ws-mod',
      inputMethod: activeGame?.inputMethod || 'sendinput',
      targetProcess: activeGame?.targetProcess || '',
      params: customParams || {},
      chainActions
    };
  }

  getConfig() {
    this._syncGamesFromRegistry();
    return {
      ...this.config,
      masterSwitches: this.masterSwitches,
      presets: gameDetect.getPresets(this.config.activeGameId || 'CarJunkyard')
    };
  }

  setMasterSwitches(updates = {}) {
    this.masterSwitches = { ...this.masterSwitches, ...updates };
    return this.masterSwitches;
  }

  updateGiftMapping(id, updates) {
    const idx = (this.config.giftMappings || []).findIndex(m => m.id === id);
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

module.exports = new EffectMap();

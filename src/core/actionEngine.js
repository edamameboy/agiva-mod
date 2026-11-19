// src/core/actionEngine.js — Reusable Multi-Step Actions & Event Matrix Dispatcher
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('../paths');

const ACTIONS_CONFIG_PATH = paths.ACTIONS_CONFIG_PATH;

class ActionEngine {
  constructor({
    effectMap,
    audioTtsDriver,
    widgetManager,
    obsDriver,
    webhook,
    enqueueEffectFn,
    broadcastFn
  }) {
    this.effectMap = effectMap;
    this.audioTtsDriver = audioTtsDriver;
    this.widgetManager = widgetManager;
    this.obsDriver = obsDriver;
    this.webhook = webhook;
    this.enqueueEffect = enqueueEffectFn || (() => {});
    this.broadcast = broadcastFn || (() => {});

    this.data = {
      version: '1.0',
      actions: [],
      events: []
    };
    this.eventCooldowns = new Map();
    this._saveTimer = null;
    this._dirty = false;
    this._isWriting = false;

    this.load();
  }

  load() {
    try {
      const dir = path.dirname(ACTIONS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(ACTIONS_CONFIG_PATH)) {
        const saved = JSON.parse(fs.readFileSync(ACTIONS_CONFIG_PATH, 'utf8'));
        this.data = {
          version: saved.version || '1.0',
          actions: Array.isArray(saved.actions) ? saved.actions : [],
          events: Array.isArray(saved.events) ? saved.events : []
        };
      } else {
        this.flushSaveSync(true);
      }
    } catch (e) {
      console.error('[ActionEngine] Failed to load config:', e.message);
    }
  }

  scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._flushSaveAsync();
    }, 1000);
  }

  async _flushSaveAsync() {
    if (!this._dirty || this._isWriting) return;
    this._isWriting = true;
    this._dirty = false;
    try {
      const dir = path.dirname(ACTIONS_CONFIG_PATH);
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = `${ACTIONS_CONFIG_PATH}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      await fs.promises.rename(tmp, ACTIONS_CONFIG_PATH);
    } catch (e) {
      console.error('[ActionEngine] Failed to save config:', e.message);
    } finally {
      this._isWriting = false;
      if (this._dirty) this.scheduleSave();
    }
  }

  flushSaveSync(force = false) {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (!this._dirty && !force) return;
    this._dirty = false;
    try {
      const dir = path.dirname(ACTIONS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${ACTIONS_CONFIG_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, ACTIONS_CONFIG_PATH);
    } catch (e) {
      console.error('[ActionEngine] Failed to flush config:', e.message);
    }
  }

  getAll() {
    return {
      version: this.data.version,
      actions: this.data.actions,
      events: this.data.events
    };
  }

  upsertAction(actionInput = {}) {
    const id = String(actionInput.id || `act_${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const clean = {
      id,
      name: String(actionInput.name || id).trim() || id,
      description: String(actionInput.description || '').trim(),
      priority: actionInput.priority === 'high' ? 'high' : 'normal',
      steps: Array.isArray(actionInput.steps) ? actionInput.steps.map(s => ({ ...s })) : []
    };
    const idx = this.data.actions.findIndex(a => a.id === id);
    if (idx !== -1) this.data.actions[idx] = clean;
    else this.data.actions.push(clean);
    this.scheduleSave();
    this.broadcast({ type: 'actions_updated', actionsData: this.getAll() });
    return clean;
  }

  deleteAction(id) {
    const prevLen = this.data.actions.length;
    this.data.actions = this.data.actions.filter(a => a.id !== id);
    for (const ev of this.data.events) {
      if (Array.isArray(ev.actionIds)) {
        ev.actionIds = ev.actionIds.filter(aid => aid !== id);
      }
    }
    if (this.data.actions.length !== prevLen) {
      this.scheduleSave();
      this.broadcast({ type: 'actions_updated', actionsData: this.getAll() });
      return true;
    }
    return false;
  }

  upsertEvent(evInput = {}) {
    const id = String(evInput.id || `ev_${Date.now().toString(36)}`).replace(/[^a-zA-Z0-9_-]/g, '_');
    const actionIds = Array.isArray(evInput.actionIds)
      ? evInput.actionIds.filter(Boolean)
      : (evInput.actionId ? [evInput.actionId] : []);

    const clean = {
      id,
      name: String(evInput.name || '').trim(),
      enabled: evInput.enabled !== false,
      eventType: String(evInput.eventType || 'gift'),
      giftId: evInput.giftId ? (isNaN(evInput.giftId) ? String(evInput.giftId) : Number(evInput.giftId)) : '',
      minCoins: Number(evInput.minCoins) || 0,
      maxCoins: Number(evInput.maxCoins) || 0,
      minAmount: Number(evInput.minAmount) || 0,
      command: String(evInput.command || '').trim(),
      allowedRole: evInput.allowedRole || 'everyone',
      allowedUsers: String(evInput.allowedUsers || '').trim(),
      minGifterLevel: Number(evInput.minGifterLevel) || 1,
      cooldownSec: Math.max(0, Number(evInput.cooldownSec) || 0),
      actionIds
    };

    const idx = this.data.events.findIndex(e => e.id === id);
    if (idx !== -1) this.data.events[idx] = clean;
    else this.data.events.push(clean);
    this.scheduleSave();
    this.broadcast({ type: 'actions_updated', actionsData: this.getAll() });
    return clean;
  }

  deleteEvent(id) {
    const prevLen = this.data.events.length;
    this.data.events = this.data.events.filter(e => e.id !== id);
    if (this.data.events.length !== prevLen) {
      this.scheduleSave();
      this.broadcast({ type: 'actions_updated', actionsData: this.getAll() });
      return true;
    }
    return false;
  }

  importBundle(bundle = {}) {
    const importedActions = Array.isArray(bundle.actions) ? bundle.actions : [];
    const importedEvents = Array.isArray(bundle.events) ? bundle.events : [];
    for (const act of importedActions) {
      if (act && (act.id || act.name)) this.upsertAction(act);
    }
    for (const ev of importedEvents) {
      if (ev && ev.eventType) this.upsertEvent(ev);
    }
    return this.getAll();
  }

  async executeAction(actionId, vars = {}) {
    const action = this.data.actions.find(a => a.id === actionId);
    if (!action) return false;
    const switches = this.effectMap.masterSwitches;
    if (!switches.all) return false;

    const user = vars.user || vars.nickname || 'System';
    const source = vars.source || 'action';
    const priority = action.priority === 'high' ? 'high' : 'normal';

    for (const step of action.steps || []) {
      if (!step || !step.type) continue;
      try {
        switch (step.type) {
          case 'delay': {
            const ms = Math.min(30000, Math.max(50, Number(step.ms) || 500));
            await new Promise(r => setTimeout(r, ms));
            break;
          }
          case 'game_effect': {
            if (!step.effectId || step.effectId === '__none__') break;
            const repeat = step.multiplyByRepeat
              ? Math.min(10, Math.max(1, Number(vars.repeatCount) || 1))
              : 1;
            for (let i = 0; i < repeat; i++) {
              this.enqueueEffect(step.effectId, user, source, vars, priority);
            }
            break;
          }
          case 'sound': {
            if (step.soundId && switches.tts !== false) {
              this.audioTtsDriver.playSound(
                step.soundId,
                { screen: Number(step.screen) || 1, volume: step.volume },
                switches.tts !== false
              );
            }
            break;
          }
          case 'tts': {
            if (switches.tts !== false && step.template) {
              const spoken = this.audioTtsDriver.formatTemplate(step.template, vars);
              this.audioTtsDriver.speak(
                spoken,
                { voice: step.voice || undefined, lang: step.lang || undefined, user },
                switches.tts !== false
              );
            }
            break;
          }
          case 'screen_alert': {
            const title = this.audioTtsDriver.formatTemplate(step.title || action.name, vars);
            const subtitle = this.audioTtsDriver.formatTemplate(step.subtitle || '', vars);
            this.widgetManager.triggerScreenAlert(Number(step.screen) || 1, {
              title,
              subtitle,
              mediaUrl: step.mediaUrl || '',
              soundUrl: step.soundUrl || '',
              durationMs: Number(step.durationMs) || undefined,
              color: step.color || undefined
            });
            break;
          }
          case 'obs_scene': {
            if (switches.obs !== false && step.sceneName) {
              await this.obsDriver.switchSceneTemporary(step.sceneName, Number(step.durationSec) || 0, true).catch(() => {});
            }
            break;
          }
          case 'obs_source': {
            if (switches.obs !== false && step.sourceName) {
              await this.obsDriver.setSceneItemVisibilityTemporary(
                step.sceneName || '',
                step.sourceName,
                step.enabled !== false,
                Number(step.durationSec) || 0,
                true
              ).catch(() => {});
            }
            break;
          }
          case 'obs_filter': {
            if (switches.obs !== false && step.sourceName && step.filterName) {
              await this.obsDriver.toggleFilterTemporary(step.sourceName, step.filterName, Number(step.durationSec) || 8, true).catch(() => {});
            }
            break;
          }
          case 'obs_mute': {
            if (switches.obs !== false && step.inputName) {
              await this.obsDriver.toggleMuteTemporary(step.inputName, Number(step.durationSec) || 10, true).catch(() => {});
            }
            break;
          }
          case 'obs_text': {
            if (switches.obs !== false && step.inputName) {
              const txt = this.audioTtsDriver.formatTemplate(step.textTemplate || '', vars);
              await this.obsDriver.setInputText(step.inputName, txt, true).catch(() => {});
            }
            break;
          }
          case 'obs_replay': {
            if (switches.obs !== false) {
              await this.obsDriver.saveReplayBuffer(true).catch(() => {});
            }
            break;
          }
          case 'timer_add': {
            const sec = Number(step.seconds) || 0;
            if (sec !== 0) this.widgetManager.controlTimer('add', sec, user);
            break;
          }
          case 'spin_wheel': {
            this.widgetManager.spinWheel(user);
            break;
          }
          case 'custom_goal': {
            this.widgetManager.adjustGoal(step.goalType || 'custom_1', Number(step.delta) || 1, user);
            break;
          }
          case 'webhook': {
            if (switches.webhook && this.webhook) {
              await this.webhook.emit({
                type: 'action',
                actionId: action.id,
                actionName: action.name,
                vars,
                custom: step.payload || {}
              }).catch(() => {});
            }
            break;
          }
        }
      } catch (e) {
        console.error(`[ActionEngine] Step "${step.type}" failed in "${action.id}":`, e.message);
      }
    }
    return true;
  }

  _matchesEventRule(ev, eventType, vars, userMeta) {
    if (!ev.enabled || ev.eventType !== eventType) return false;
    if (!this.effectMap.checkUserPermission(userMeta, ev)) return false;

    if (eventType === 'gift') {
      if (ev.giftId && String(ev.giftId) !== String(vars.giftId)) return false;
      if (ev.minCoins > 0 && (Number(vars.coins) || 0) < ev.minCoins) return false;
      if (ev.maxCoins > 0 && (Number(vars.coins) || 0) > ev.maxCoins) return false;
    } else if (eventType === 'coin_range') {
      const c = Number(vars.coins) || 0;
      if (ev.minCoins > 0 && c < ev.minCoins) return false;
      if (ev.maxCoins > 0 && c > ev.maxCoins) return false;
    } else if (eventType === 'donation') {
      if (ev.minAmount > 0 && (Number(vars.amount) || 0) < ev.minAmount) return false;
    } else if (eventType === 'chat') {
      if (ev.command) {
        const clean = String(vars.comment || '').trim().toLowerCase();
        const trig = String(ev.command).trim().toLowerCase();
        if (clean !== trig && !clean.startsWith(trig + ' ')) return false;
      }
    }

    if (ev.cooldownSec > 0) {
      const lastAt = this.eventCooldowns.get(ev.id) || 0;
      if (Date.now() - lastAt < ev.cooldownSec * 1000) return false;
      this.eventCooldowns.set(ev.id, Date.now());
    }
    return true;
  }

  dispatchEvent(eventType, vars = {}, userMeta = {}) {
    if (!this.effectMap.masterSwitches.all) return 0;
    let triggeredCount = 0;
    for (const ev of this.data.events) {
      if (!this._matchesEventRule(ev, eventType, vars, userMeta)) continue;
      for (const actionId of ev.actionIds || []) {
        triggeredCount++;
        this.executeAction(actionId, { ...vars, source: `event:${eventType}` }).catch(() => {});
      }
    }
    return triggeredCount;
  }
}

module.exports = ActionEngine;

// src/core/intervalScheduler.js — Periodic Interval Timers Scheduler
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('../paths');

const INTERVALS_CONFIG_PATH = paths.INTERVALS_CONFIG_PATH;

class IntervalScheduler {
  constructor({ isLiveFn, executeActionFn, sendChatFn, startDropFn, broadcastFn } = {}) {
    this.isLive = isLiveFn || (() => false);
    this.executeAction = executeActionFn || (() => {});
    this.sendChat = sendChatFn || (() => {});
    this.startDrop = startDropFn || (() => {});
    this.broadcast = broadcastFn || (() => {});

    this.data = {
      onlyWhenLive: true,
      timers: []
    };
    this._saveTimer = null;
    this._dirty = false;
    this._isWriting = false;

    this.load();
    this._tickHandle = setInterval(() => this._checkTimers(), 10000);
  }

  load() {
    try {
      const dir = path.dirname(INTERVALS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(INTERVALS_CONFIG_PATH)) {
        const saved = JSON.parse(fs.readFileSync(INTERVALS_CONFIG_PATH, 'utf8'));
        this.data = {
          onlyWhenLive: saved.onlyWhenLive !== false,
          timers: Array.isArray(saved.timers) ? saved.timers : []
        };
      } else {
        this.flushSaveSync(true);
      }
    } catch (e) {
      console.error('[Intervals] Failed to load config:', e.message);
    }
  }

  scheduleSave() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this._flushSaveAsync();
    }, 2000);
  }

  async _flushSaveAsync() {
    if (!this._dirty || this._isWriting) return;
    this._isWriting = true;
    this._dirty = false;
    try {
      const dir = path.dirname(INTERVALS_CONFIG_PATH);
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = `${INTERVALS_CONFIG_PATH}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      await fs.promises.rename(tmp, INTERVALS_CONFIG_PATH);
    } catch (e) {
      console.error('[Intervals] Async save failed:', e.message);
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
      const dir = path.dirname(INTERVALS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${INTERVALS_CONFIG_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, INTERVALS_CONFIG_PATH);
    } catch (e) {
      console.error('[Intervals] Sync save failed:', e.message);
    }
  }

  getState() {
    return {
      onlyWhenLive: Boolean(this.data.onlyWhenLive),
      timers: this.data.timers.map(t => ({ ...t }))
    };
  }

  updateSettings({ onlyWhenLive } = {}) {
    if (onlyWhenLive !== undefined) {
      this.data.onlyWhenLive = Boolean(onlyWhenLive);
    }
    this.scheduleSave();
    this.broadcast({ type: 'intervals_update', state: this.getState() });
    return this.getState();
  }

  upsertTimer(input = {}) {
    const id = input.id || `int_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const clean = {
      id,
      name: String(input.name || 'Interval Timer').trim(),
      enabled: input.enabled !== false,
      intervalMinutes: Math.max(0.1, Number(input.intervalMinutes) || 5),
      onlyWhenLive: input.onlyWhenLive !== undefined ? Boolean(input.onlyWhenLive) : true,
      mode: ['action', 'chat', 'points_drop'].includes(input.mode) ? input.mode : 'action',
      actionId: String(input.actionId || ''),
      chatMessage: String(input.chatMessage || ''),
      dropAmount: Math.max(1, Number(input.dropAmount) || 50),
      lastRunAt: Number(input.lastRunAt) || Date.now()
    };
    const idx = this.data.timers.findIndex(t => t.id === id);
    if (idx !== -1) this.data.timers[idx] = clean;
    else this.data.timers.push(clean);
    this.scheduleSave();
    this.broadcast({ type: 'intervals_update', state: this.getState() });
    return clean;
  }

  deleteTimer(id) {
    const prev = this.data.timers.length;
    this.data.timers = this.data.timers.filter(t => t.id !== id);
    if (this.data.timers.length !== prev) {
      this.scheduleSave();
      this.broadcast({ type: 'intervals_update', state: this.getState() });
      return true;
    }
    return false;
  }

  _runTimer(timer) {
    timer.lastRunAt = Date.now();
    const vars = { user: 'IntervalTimer', nickname: 'IntervalTimer', source: `interval:${timer.id}` };
    if (timer.mode === 'action' && timer.actionId) {
      Promise.resolve(this.executeAction(timer.actionId, vars)).catch(() => {});
    } else if (timer.mode === 'chat' && timer.chatMessage) {
      Promise.resolve(this.sendChat(timer.chatMessage, vars)).catch(() => {});
    } else if (timer.mode === 'points_drop') {
      this.startDrop({ amount: timer.dropAmount || 50 });
    }
    this.scheduleSave();
    this.broadcast({ type: 'intervals_update', state: this.getState() });
  }

  triggerNow(id) {
    const timer = this.data.timers.find(t => t.id === id);
    if (!timer) return false;
    this._runTimer(timer);
    return true;
  }

  _checkTimers() {
    const now = Date.now();
    const live = Boolean(this.isLive());
    for (const t of this.data.timers) {
      if (!t.enabled) continue;
      if ((this.data.onlyWhenLive || t.onlyWhenLive) && !live) continue;
      const periodMs = Math.max(6000, (Number(t.intervalMinutes) || 5) * 60000);
      if (now - (t.lastRunAt || 0) >= periodMs) {
        this._runTimer(t);
      }
    }
  }

  destroy() {
    if (this._tickHandle) {
      clearInterval(this._tickHandle);
      this._tickHandle = null;
    }
  }
}

module.exports = IntervalScheduler;

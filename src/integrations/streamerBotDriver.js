// src/integrations/streamerBotDriver.js — Streamer.bot WebSocket Bridge (:8080) with 14 Standard Variables
'use strict';

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const paths = require('../paths');

const INTEGRATIONS_CONFIG_PATH = paths.INTEGRATIONS_CONFIG_PATH;

const STANDARD_PLACEHOLDERS = [
  'user',
  'nickname',
  'userId',
  'giftName',
  'giftId',
  'coins',
  'repeatCount',
  'amount',
  'comment',
  'likeCount',
  'subMonth',
  'platform',
  'gameId',
  'effectId'
];

class StreamerBotDriver {
  constructor({ broadcastFn, onInboundActionFn } = {}) {
    this.broadcast = broadcastFn || (() => {});
    this.onInboundAction = onInboundActionFn || (() => {});
    this.ws = null;
    this.isConnected = false;
    this.lastError = '';
    this.reconnectTimer = null;
    this.reconnectAttempts = 0;

    this.config = {
      enabled: false,
      url: 'ws://127.0.0.1:8080/',
      forwardAllEvents: true,
      defaultActionName: 'AgivaTikTokEvent',
      eventActions: {
        gift: '',
        chat: '',
        follow: '',
        like: '',
        share: '',
        subscribe: '',
        donation: '',
        effect: ''
      }
    };

    this.loadConfig();
    if (this.config.enabled) {
      this.connect();
    }
  }

  loadConfig() {
    try {
      if (fs.existsSync(INTEGRATIONS_CONFIG_PATH)) {
        const root = JSON.parse(fs.readFileSync(INTEGRATIONS_CONFIG_PATH, 'utf8'));
        if (root.streamerBot) {
          this.config = {
            ...this.config,
            ...root.streamerBot,
            eventActions: { ...this.config.eventActions, ...(root.streamerBot.eventActions || {}) }
          };
        }
      }
    } catch {}
  }

  saveConfig() {
    try {
      const dir = path.dirname(INTEGRATIONS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      let root = {};
      if (fs.existsSync(INTEGRATIONS_CONFIG_PATH)) {
        try { root = JSON.parse(fs.readFileSync(INTEGRATIONS_CONFIG_PATH, 'utf8')); } catch {}
      }
      root.streamerBot = this.config;
      fs.writeFileSync(INTEGRATIONS_CONFIG_PATH, JSON.stringify(root, null, 2), 'utf8');
    } catch (e) {
      console.error('[StreamerBot] Failed to save config:', e.message);
    }
  }

  flushSaveSync() {
    this.saveConfig();
  }

  getStatus() {
    return {
      ...this.config,
      isConnected: this.isConnected,
      lastError: this.lastError,
      placeholders: STANDARD_PLACEHOLDERS
    };
  }

  updateConfig(patch = {}) {
    const prevEnabled = this.config.enabled;
    const prevUrl = this.config.url;
    this.config = {
      ...this.config,
      ...patch,
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : this.config.enabled,
      url: patch.url ? String(patch.url).trim() : this.config.url,
      forwardAllEvents: patch.forwardAllEvents !== undefined ? Boolean(patch.forwardAllEvents) : this.config.forwardAllEvents,
      eventActions: {
        ...this.config.eventActions,
        ...(patch.eventActions || {})
      }
    };
    this.saveConfig();

    if (this.config.enabled && (!this.isConnected || prevUrl !== this.config.url || !prevEnabled)) {
      this.connect();
    } else if (!this.config.enabled) {
      this.disconnect();
    }
    this._broadcastStatus();
    return this.getStatus();
  }

  buildStandardVariables(eventType, data = {}) {
    return {
      eventType: String(eventType || 'custom'),
      user: String(data.user || data.uniqueId || 'anonymous'),
      nickname: String(data.nickname || data.user || 'anonymous'),
      userId: String(data.userId || data.user || data.uniqueId || ''),
      giftName: String(data.giftName || ''),
      giftId: Number(data.giftId || 0),
      coins: Number(data.coins || data.coinsEquivalent || 0),
      repeatCount: Number(data.repeatCount || 1),
      amount: Number(data.amount || 0),
      comment: String(data.comment || data.message || ''),
      likeCount: Number(data.count || data.likeCount || 0),
      subMonth: Number(data.subMonth || 0),
      platform: String(data.platform || 'tiktok'),
      gameId: String(data.gameId || ''),
      effectId: String(data.effectId || '')
    };
  }

  connect() {
    this.disconnect(false);
    if (!this.config.enabled) return;

    try {
      const ws = new WebSocket(this.config.url || 'ws://127.0.0.1:8080/');
      this.ws = ws;

      ws.on('open', () => {
        this.isConnected = true;
        this.lastError = '';
        this.reconnectAttempts = 0;
        this._broadcastStatus();
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.request === 'AgivaAction' || msg.event === 'agiva_command' || msg.agivaCommand) {
            this.onInboundAction(msg.data || msg);
          }
        } catch {}
      });

      ws.on('error', (err) => {
        this.lastError = err.message || 'Connection error';
      });

      ws.on('close', () => {
        this.isConnected = false;
        this.ws = null;
        this._broadcastStatus();
        if (this.config.enabled) {
          this._scheduleReconnect();
        }
      });
    } catch (e) {
      this.lastError = e.message;
      this.isConnected = false;
      this._broadcastStatus();
    }
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(30000, 3000 * Math.pow(1.5, this.reconnectAttempts++));
    this.reconnectTimer = setTimeout(() => {
      if (this.config.enabled) this.connect();
    }, delay);
    if (this.reconnectTimer.unref) this.reconnectTimer.unref();
  }

  disconnect(resetFlag = true) {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try { this.ws.terminate(); } catch {}
      this.ws = null;
    }
    this.isConnected = false;
    if (resetFlag) this._broadcastStatus();
  }

  doAction(actionNameOrId, args = {}) {
    const target = String(actionNameOrId || this.config.defaultActionName || 'AgivaTikTokEvent').trim();
    const payload = {
      request: 'DoAction',
      id: `agiva_${Date.now()}`,
      action: {
        name: target
      },
      args
    };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
        return { ok: true, sent: true, payload };
      } catch (e) {
        return { ok: false, error: e.message, payload };
      }
    }
    return { ok: true, sent: false, queuedOffline: true, payload };
  }

  onStreamEvent(eventType, data = {}) {
    if (!this.config.enabled) return null;
    const mappedAction = this.config.eventActions?.[eventType];
    if (!mappedAction && !this.config.forwardAllEvents) return null;
    const vars = this.buildStandardVariables(eventType, data);
    const actionName = mappedAction || this.config.defaultActionName || 'AgivaTikTokEvent';
    return this.doAction(actionName, vars);
  }

  _broadcastStatus() {
    this.broadcast({
      type: 'streamerbot_status',
      status: this.getStatus()
    });
  }
}

module.exports = StreamerBotDriver;

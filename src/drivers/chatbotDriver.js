// src/drivers/chatbotDriver.js — Active TikTok Chatbot, Auto-Reply & Spam Guard
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('../paths');

const CHATBOT_CONFIG_PATH = paths.CHATBOT_CONFIG_PATH;

const DEFAULT_CHATBOT_CONFIG = {
  enabled: true,
  maxMessagesPer15Sec: 3,
  sendToTikTok: false,
  welcomeEnabled: false,
  welcomeTemplate: 'Selamat datang @{user}! Ketik !help untuk melihat command.',
  thankGiftEnabled: false,
  thankGiftTemplate: 'Terima kasih @{user} atas {giftname} ({coins} koin)!',
  followReplyEnabled: false,
  followTemplate: 'Terima kasih sudah follow @{user}!',
  customCommands: []
};

class ChatbotDriver {
  constructor({ broadcastFn, effectMap } = {}) {
    this.broadcast = broadcastFn || (() => {});
    this.effectMap = effectMap || null;
    this.config = { ...DEFAULT_CHATBOT_CONFIG };
    this.logs = [];
    this.sentTimestamps = [];
    this.cmdCooldowns = new Map();
    this._saveTimer = null;
    this._dirty = false;
    this._isWriting = false;

    this.load();
  }

  load() {
    try {
      const dir = path.dirname(CHATBOT_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(CHATBOT_CONFIG_PATH)) {
        const saved = JSON.parse(fs.readFileSync(CHATBOT_CONFIG_PATH, 'utf8'));
        this.config = {
          ...DEFAULT_CHATBOT_CONFIG,
          ...saved,
          customCommands: Array.isArray(saved.customCommands) ? saved.customCommands : []
        };
      } else {
        this.flushSaveSync(true);
      }
    } catch (e) {
      console.error('[Chatbot] Failed to load config:', e.message);
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
      const dir = path.dirname(CHATBOT_CONFIG_PATH);
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = `${CHATBOT_CONFIG_PATH}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(this.config, null, 2), 'utf8');
      await fs.promises.rename(tmp, CHATBOT_CONFIG_PATH);
    } catch (e) {
      console.error('[Chatbot] Async save failed:', e.message);
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
      const dir = path.dirname(CHATBOT_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${CHATBOT_CONFIG_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.config, null, 2), 'utf8');
      fs.renameSync(tmp, CHATBOT_CONFIG_PATH);
    } catch (e) {
      console.error('[Chatbot] Sync save failed:', e.message);
    }
  }

  getState() {
    return {
      config: { ...this.config },
      logs: this.logs.slice(0, 50)
    };
  }

  updateConfig(updates = {}) {
    if (updates.enabled !== undefined) this.config.enabled = Boolean(updates.enabled);
    if (updates.maxMessagesPer15Sec !== undefined) {
      this.config.maxMessagesPer15Sec = Math.max(1, Math.min(20, Number(updates.maxMessagesPer15Sec) || 3));
    }
    if (updates.sendToTikTok !== undefined) this.config.sendToTikTok = Boolean(updates.sendToTikTok);
    if (updates.welcomeEnabled !== undefined) this.config.welcomeEnabled = Boolean(updates.welcomeEnabled);
    if (updates.welcomeTemplate !== undefined) this.config.welcomeTemplate = String(updates.welcomeTemplate);
    if (updates.thankGiftEnabled !== undefined) this.config.thankGiftEnabled = Boolean(updates.thankGiftEnabled);
    if (updates.thankGiftTemplate !== undefined) this.config.thankGiftTemplate = String(updates.thankGiftTemplate);
    if (updates.followReplyEnabled !== undefined) this.config.followReplyEnabled = Boolean(updates.followReplyEnabled);
    if (updates.followTemplate !== undefined) this.config.followTemplate = String(updates.followTemplate);
    if (Array.isArray(updates.customCommands)) this.config.customCommands = updates.customCommands;

    this.scheduleSave();
    this.broadcast({ type: 'chatbot_update', state: this.getState() });
    return this.getState();
  }

  upsertCommand(cmdInput = {}) {
    const trigger = String(cmdInput.trigger || '').trim();
    if (!trigger) throw new Error('trigger command wajib diisi');
    const id = cmdInput.id || `cb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const clean = {
      id,
      trigger,
      response: String(cmdInput.response || ''),
      enabled: cmdInput.enabled !== false,
      allowedRole: cmdInput.allowedRole || 'everyone',
      cooldownSec: Math.max(0, Number(cmdInput.cooldownSec) || 5),
      costPoints: Math.max(0, Number(cmdInput.costPoints) || 0)
    };
    const idx = this.config.customCommands.findIndex(c => c.id === id);
    if (idx !== -1) this.config.customCommands[idx] = clean;
    else this.config.customCommands.push(clean);
    this.scheduleSave();
    this.broadcast({ type: 'chatbot_update', state: this.getState() });
    return clean;
  }

  deleteCommand(id) {
    const prev = this.config.customCommands.length;
    this.config.customCommands = this.config.customCommands.filter(c => c.id !== id);
    if (this.config.customCommands.length !== prev) {
      this.scheduleSave();
      this.broadcast({ type: 'chatbot_update', state: this.getState() });
      return true;
    }
    return false;
  }

  clearLogs() {
    this.logs = [];
    return this.logs;
  }

  _pushLog(entry) {
    this.logs.unshift(entry);
    if (this.logs.length > 100) this.logs.length = 100;
  }

  formatTemplate(template = '', vars = {}) {
    const str = String(template || '');
    return str
      .replace(/\{nickname\}/gi, String(vars.nickname || vars.user || 'Penonton'))
      .replace(/\{user\}/gi, String(vars.user || vars.nickname || 'Penonton'))
      .replace(/\{giftname\}/gi, String(vars.giftName || vars.giftname || 'Gift'))
      .replace(/\{coins\}/gi, String(vars.coins ?? 1))
      .replace(/\{points\}/gi, String(vars.points ?? 0))
      .replace(/\{level\}/gi, String(vars.level ?? 1))
      .replace(/\{command\}/gi, String(vars.command || ''));
  }

  async sendMessage(rawText, vars = {}, { tiktokConn = null, force = false } = {}) {
    if (!force && !this.config.enabled) {
      return { sent: false, status: 'disabled' };
    }
    const text = this.formatTemplate(rawText, vars).trim();
    if (!text) return { sent: false, status: 'empty' };

    const now = Date.now();
    this.sentTimestamps = this.sentTimestamps.filter(ts => now - ts < 15000);
    const limit = Math.max(1, Number(this.config.maxMessagesPer15Sec) || 3);
    if (!force && this.sentTimestamps.length >= limit) {
      const entry = { id: `cb_log_${now}`, time: now, text, status: 'rate_limited' };
      this._pushLog(entry);
      return { sent: false, status: 'rate_limited' };
    }

    this.sentTimestamps.push(now);
    const msgId = `cb_log_${now}_${Math.random().toString(36).slice(2, 6)}`;
    let status = 'overlay_only';

    if (this.config.sendToTikTok && tiktokConn && typeof tiktokConn.sendMessage === 'function') {
      try {
        await tiktokConn.sendMessage(text);
        status = 'sent_tiktok';
      } catch (e) {
        status = 'tiktok_error';
        console.warn('[Chatbot] sendMessage to TikTok failed:', e.message);
      }
    }

    const payload = {
      type: 'chatbot_message',
      id: msgId,
      time: now,
      user: 'AgivaBot',
      text,
      status
    };
    this._pushLog({ id: msgId, time: now, text, status });
    this.broadcast(payload);
    return { sent: true, status, text, payload };
  }

  async handleIncomingChat(comment, userMeta = {}, vars = {}, pointsManager = null, { tiktokConn = null } = {}) {
    if (!this.config.enabled || !comment) return false;
    const clean = String(comment).trim().toLowerCase();
    const uid = userMeta.uniqueId || userMeta.user || '';

    for (const cmd of this.config.customCommands || []) {
      if (!cmd.enabled || !cmd.trigger) continue;
      const trig = String(cmd.trigger).trim().toLowerCase();
      if (clean !== trig && !clean.startsWith(trig + ' ')) continue;

      if (this.effectMap && !this.effectMap.checkUserPermission(userMeta, cmd)) {
        return false;
      }

      const now = Date.now();
      const cdMs = (Number(cmd.cooldownSec) || 0) * 1000;
      const last = this.cmdCooldowns.get(cmd.id) || 0;
      if (cdMs > 0 && now - last < cdMs) {
        return false;
      }

      if (cmd.costPoints > 0 && pointsManager) {
        const spent = pointsManager.spendPoints(uid, cmd.costPoints, `chatbot_${trig}`, { nickname: userMeta.nickname });
        if (!spent.ok) {
          await this.sendMessage(`@{user} ${spent.error}`, vars, { tiktokConn });
          return true;
        }
      }

      this.cmdCooldowns.set(cmd.id, now);
      const u = pointsManager ? pointsManager.getUser(uid, userMeta.nickname) : null;
      await this.sendMessage(cmd.response, {
        ...vars,
        command: cmd.trigger,
        points: u?.points ?? 0,
        level: u?.level ?? 1
      }, { tiktokConn });
      return true;
    }
    return false;
  }

  onMember(vars = {}, opts = {}) {
    if (!this.config.enabled || !this.config.welcomeEnabled) return;
    this.sendMessage(this.config.welcomeTemplate, vars, opts).catch(() => {});
  }

  onGift(vars = {}, opts = {}) {
    if (!this.config.enabled || !this.config.thankGiftEnabled) return;
    this.sendMessage(this.config.thankGiftTemplate, vars, opts).catch(() => {});
  }

  onFollow(vars = {}, opts = {}) {
    if (!this.config.enabled || !this.config.followReplyEnabled) return;
    this.sendMessage(this.config.followTemplate, vars, opts).catch(() => {});
  }
}

module.exports = ChatbotDriver;

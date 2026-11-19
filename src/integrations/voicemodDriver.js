// src/integrations/voicemodDriver.js — Voicemod Control API, IFTTT / Smart Home Presets & LAN Remote Manager
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const paths = require('../paths');

const INTEGRATIONS_CONFIG_PATH = paths.INTEGRATIONS_CONFIG_PATH;

const DEFAULT_VOICEMOD_VOICES = [
  { id: 'nofx', label: '🗣️ Clean (No Effect)' },
  { id: 'robot', label: '🤖 Robot' },
  { id: 'demon', label: '👹 Demon' },
  { id: 'chipmunk', label: '🐿️ Chipmunk / Helium' },
  { id: 'autotune', label: '🎵 Magic Autotune' },
  { id: 'baby', label: '👶 Baby Voice' },
  { id: 'cave', label: '🦇 Cave Echo' }
];

const DEFAULT_IFTTT_PRESETS = [
  {
    id: 'ifttt_sultan_rgb',
    name: '💡 RGB Smart Light Flash (Sultan Gift)',
    url: '',
    method: 'POST',
    eventTrigger: 'gift_1000',
    payloadTemplate: '{"value1":"{user}","value2":"{giftName}","value3":"{coins}"}',
    enabled: false
  },
  {
    id: 'ifttt_smart_plug_fan',
    name: '🌀 Smart Plug Kipas / Sirine ON',
    url: '',
    method: 'POST',
    eventTrigger: 'donation',
    payloadTemplate: '{"entity_id":"switch.streamer_siren","user":"{user}","amount":"{amount}"}',
    enabled: false
  },
  {
    id: 'discord_live_alert',
    name: '📢 Discord Webhook Notifikasi Sultan',
    url: '',
    method: 'POST',
    eventTrigger: 'gift_500',
    payloadTemplate: '{"content":"🔥 **{user}** baru saja mengirim **{giftName}** ({coins}💎) di Live!"}',
    enabled: false
  }
];

class VoicemodDriver {
  constructor({ broadcastFn } = {}) {
    this.broadcast = broadcastFn || (() => {});
    this.ws = null;
    this.isConnected = false;
    this.lastError = '';

    this.voicemod = {
      enabled: false,
      url: 'ws://127.0.0.1:59129/v1',
      apiKey: 'agiva-voicemod-key',
      activeVoice: 'nofx',
      voiceChangerOn: false,
      hearMyVoiceOn: false,
      muted: false,
      voices: DEFAULT_VOICEMOD_VOICES
    };

    this.iftttPresets = DEFAULT_IFTTT_PRESETS.map(p => ({ ...p }));

    this.lanRemote = {
      enabled: true,
      pin: '2486'
    };

    this.loadConfig();
    if (this.voicemod.enabled) {
      this.connectVoicemod();
    }
  }

  loadConfig() {
    try {
      if (fs.existsSync(INTEGRATIONS_CONFIG_PATH)) {
        const root = JSON.parse(fs.readFileSync(INTEGRATIONS_CONFIG_PATH, 'utf8'));
        if (root.voicemod) {
          this.voicemod = { ...this.voicemod, ...root.voicemod, voices: DEFAULT_VOICEMOD_VOICES };
        }
        if (Array.isArray(root.iftttPresets) && root.iftttPresets.length > 0) {
          this.iftttPresets = root.iftttPresets;
        }
        if (root.lanRemote) {
          this.lanRemote = { ...this.lanRemote, ...root.lanRemote };
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
      root.voicemod = this.voicemod;
      root.iftttPresets = this.iftttPresets;
      root.lanRemote = this.lanRemote;
      fs.writeFileSync(INTEGRATIONS_CONFIG_PATH, JSON.stringify(root, null, 2), 'utf8');
    } catch (e) {
      console.error('[VoicemodDriver] Failed to save config:', e.message);
    }
  }

  flushSaveSync() {
    this.saveConfig();
  }

  getState() {
    return {
      voicemod: {
        ...this.voicemod,
        isConnected: this.isConnected,
        lastError: this.lastError
      },
      iftttPresets: this.iftttPresets,
      lanRemote: {
        ...this.lanRemote
      }
    };
  }

  updateVoicemodConfig(patch = {}) {
    this.voicemod = {
      ...this.voicemod,
      ...patch,
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : this.voicemod.enabled,
      voices: DEFAULT_VOICEMOD_VOICES
    };
    this.saveConfig();
    if (this.voicemod.enabled) {
      this.connectVoicemod();
    } else {
      this.disconnectVoicemod();
    }
    this._broadcastState();
    return this.getState().voicemod;
  }

  connectVoicemod() {
    this.disconnectVoicemod(false);
    if (!this.voicemod.enabled) return;

    try {
      const ws = new WebSocket(this.voicemod.url || 'ws://127.0.0.1:59129/v1');
      this.ws = ws;

      ws.on('open', () => {
        this.isConnected = true;
        this.lastError = '';
        this._sendVoicemod('registerClient', { clientKey: this.voicemod.apiKey || 'agiva-voicemod-key' });
        this._broadcastState();
      });

      ws.on('error', (err) => {
        this.lastError = err.message || 'Voicemod connection error';
      });

      ws.on('close', () => {
        this.isConnected = false;
        this.ws = null;
        this._broadcastState();
      });
    } catch (e) {
      this.lastError = e.message;
      this.isConnected = false;
      this._broadcastState();
    }
  }

  disconnectVoicemod(emit = true) {
    if (this.ws) {
      try { this.ws.terminate(); } catch {}
      this.ws = null;
    }
    this.isConnected = false;
    if (emit) this._broadcastState();
  }

  _sendVoicemod(action, payload = {}) {
    const packet = {
      id: `agiva_vm_${Date.now()}`,
      action,
      payload
    };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(packet));
        return true;
      } catch {}
    }
    return false;
  }

  executeVoicemodAction(type, value = '') {
    let sent = false;
    if (type === 'loadVoice') {
      const voiceID = String(value || 'nofx');
      this.voicemod.activeVoice = voiceID;
      this.voicemod.voiceChangerOn = voiceID !== 'nofx';
      sent = this._sendVoicemod('loadVoice', { voiceID });
    } else if (type === 'toggleVoiceChanger') {
      this.voicemod.voiceChangerOn = !this.voicemod.voiceChangerOn;
      sent = this._sendVoicemod('toggleVoiceChanger', {});
    } else if (type === 'toggleHearMyVoice') {
      this.voicemod.hearMyVoiceOn = !this.voicemod.hearMyVoiceOn;
      sent = this._sendVoicemod('toggleHearMyVoice', {});
    } else if (type === 'toggleMute') {
      this.voicemod.muted = !this.voicemod.muted;
      sent = this._sendVoicemod('toggleMute', {});
    }
    this.saveConfig();
    this._broadcastState();
    return {
      ok: true,
      sent,
      voicemod: this.getState().voicemod
    };
  }

  updateIftttPresets(presets = []) {
    if (Array.isArray(presets)) {
      this.iftttPresets = presets.map((p, idx) => ({
        id: String(p.id || `ifttt_${idx + 1}`),
        name: String(p.name || `Preset #${idx + 1}`),
        url: String(p.url || '').trim(),
        method: p.method === 'GET' ? 'GET' : 'POST',
        eventTrigger: String(p.eventTrigger || 'manual'),
        payloadTemplate: String(p.payloadTemplate || '{"value1":"{user}"}'),
        enabled: Boolean(p.enabled)
      }));
      this.saveConfig();
      this._broadcastState();
    }
    return this.iftttPresets;
  }

  async triggerIftttPreset(presetId, vars = {}) {
    const preset = this.iftttPresets.find(p => p.id === presetId);
    if (!preset) return { ok: false, error: 'Preset IFTTT tidak ditemukan.' };

    const interpolate = (str) => String(str || '').replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? String(vars[k]) : ''));
    const bodyStr = interpolate(preset.payloadTemplate);

    if (!preset.url) {
      return {
        ok: true,
        simulated: true,
        preset: preset.name,
        payload: bodyStr,
        message: 'Simulasi sukses (URL Webhook belum diisi).'
      };
    }

    return new Promise((resolve) => {
      try {
        const parsed = new URL(preset.url);
        const client = parsed.protocol === 'https:' ? https : http;
        const req = client.request({
          hostname: parsed.hostname,
          port: parsed.port || undefined,
          path: parsed.pathname + parsed.search,
          method: preset.method || 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'agiva-mod/1.6.0'
          },
          timeout: 5000
        }, (res) => {
          res.resume();
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, statusCode: res.statusCode, preset: preset.name });
        });
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Webhook timeout' }); });
        req.on('error', (e) => resolve({ ok: false, error: e.message }));
        if ((preset.method || 'POST') !== 'GET') req.write(bodyStr);
        req.end();
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  // ─── Mobile Companion / LAN Remote Management ─────────────
  updateLanRemote(patch = {}) {
    if (patch.enabled !== undefined) this.lanRemote.enabled = Boolean(patch.enabled);
    if (patch.pin !== undefined && String(patch.pin).trim()) {
      this.lanRemote.pin = String(patch.pin).trim().slice(0, 12);
    }
    if (patch.regenerate) {
      this.lanRemote.pin = String(Math.floor(1000 + Math.random() * 9000));
    }
    this.saveConfig();
    this._broadcastState();
    return this.lanRemote;
  }

  verifyPin(inputPin) {
    if (!this.lanRemote.enabled) return false;
    return String(inputPin || '').trim() === String(this.lanRemote.pin || '').trim();
  }

  getLanUrls(port = 3000) {
    const urls = [];
    try {
      const nets = os.networkInterfaces();
      for (const name of Object.keys(nets)) {
        for (const net of nets[name] || []) {
          const fam = typeof net.family === 'string' ? net.family : (net.family === 4 ? 'IPv4' : '');
          if (fam === 'IPv4' && !net.internal) {
            urls.push(`http://${net.address}:${port}/remote`);
          }
        }
      }
    } catch {}
    if (urls.length === 0) {
      urls.push(`http://127.0.0.1:${port}/remote`);
    }
    return urls;
  }

  _broadcastState() {
    this.broadcast({
      type: 'integrations_update',
      state: this.getState()
    });
  }
}

module.exports = VoicemodDriver;

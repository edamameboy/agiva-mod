const WebSocket = require('ws');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const paths = require('../paths');

const OBS_CONFIG_PATH = paths.OBS_CONFIG_PATH;

class ObsDriver {
  constructor(broadcastFn) {
    this.broadcast = broadcastFn || (() => {});
    this.ws = null;
    this.isConnected = false;
    this.scenes = [];
    this.currentScene = '';
    this.pendingRequests = new Map();
    this.revertTimer = null;

    this.config = {
      url: 'ws://127.0.0.1:4455',
      password: '',
      autoConnect: false
    };

    this.loadConfig();
    if (this.config.autoConnect) {
      this.connect().catch(() => {});
    }
  }

  loadConfig() {
    try {
      const dir = path.dirname(OBS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(OBS_CONFIG_PATH)) {
        const saved = JSON.parse(fs.readFileSync(OBS_CONFIG_PATH, 'utf8'));
        this.config = { ...this.config, ...saved };
      }
    } catch {}
  }

  saveConfig(updates = {}) {
    this.config = { ...this.config, ...updates };
    try {
      const dir = path.dirname(OBS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(OBS_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
    } catch {}
    return this.getStatus();
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      url: this.config.url,
      hasPassword: Boolean(this.config.password),
      autoConnect: this.config.autoConnect,
      currentScene: this.currentScene,
      scenes: this.scenes
    };
  }

  async connect(customConfig) {
    if (customConfig) this.saveConfig(customConfig);
    this.disconnect();

    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.config.url || 'ws://127.0.0.1:4455');
      this.ws = ws;

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch {}
          reject(new Error('OBS WebSocket connection timeout (pastikan OBS WebSocket Server aktif di Tools -> WebSocket Server Settings)'));
        }
      }, 4500);

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          // OpCode 0 = Hello (OBS WebSocket v5)
          if (msg.op === 0) {
            const auth = msg.d?.authentication;
            let authString = undefined;
            if (auth && auth.challenge && auth.salt) {
              const secret = crypto.createHash('sha256')
                .update((this.config.password || '') + auth.salt)
                .digest('base64');
              authString = crypto.createHash('sha256')
                .update(secret + auth.challenge)
                .digest('base64');
            }
            ws.send(JSON.stringify({
              op: 1, // Identify
              d: {
                rpcVersion: 1,
                authentication: authString
              }
            }));
          } else if (msg.op === 2) {
            // OpCode 2 = Identified
            clearTimeout(timeout);
            this.isConnected = true;
            await this.refreshScenes().catch(() => {});
            this.broadcast({ type: 'obs_status', status: this.getStatus() });
            if (!settled) {
              settled = true;
              resolve(this.getStatus());
            }
          } else if (msg.op === 7 && msg.d) {
            // OpCode 7 = RequestResponse
            const reqId = msg.d.requestId;
            const pending = this.pendingRequests.get(reqId);
            if (pending) {
              clearTimeout(pending.timer);
              this.pendingRequests.delete(reqId);
              if (msg.d.requestStatus?.result) {
                pending.resolve(msg.d.responseData || {});
              } else {
                pending.reject(new Error(msg.d.requestStatus?.comment || 'OBS request failed'));
              }
            }
          } else if (msg.op === 5 && msg.d?.eventType === 'CurrentProgramSceneChanged') {
            this.currentScene = msg.d.eventData?.sceneName || this.currentScene;
            this.broadcast({ type: 'obs_status', status: this.getStatus() });
          }
        } catch {}
      });

      ws.on('close', () => {
        clearTimeout(timeout);
        this.isConnected = false;
        this.broadcast({ type: 'obs_status', status: this.getStatus() });
        if (!settled) {
          settled = true;
          reject(new Error('OBS WebSocket closed (cek password atau port 4455)'));
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        this.isConnected = false;
        if (!settled) {
          settled = true;
          reject(err);
        }
      });
    });
  }

  disconnect() {
    if (this.revertTimer) {
      clearTimeout(this.revertTimer);
      this.revertTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.isConnected = false;
    this.broadcast({ type: 'obs_status', status: this.getStatus() });
  }

  sendRequest(requestType, requestData = {}) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('OBS WebSocket belum terhubung'));
    }
    const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`OBS request timeout: ${requestType}`));
      }, 4000);
      this.pendingRequests.set(requestId, { resolve, reject, timer });
      this.ws.send(JSON.stringify({
        op: 6,
        d: { requestType, requestId, requestData }
      }));
    });
  }

  async refreshScenes() {
    if (!this.isConnected) return [];
    const data = await this.sendRequest('GetSceneList');
    this.currentScene = data.currentProgramSceneName || '';
    this.scenes = (data.scenes || []).map(s => s.sceneName);
    return this.scenes;
  }

  async switchSceneTemporary(sceneName, durationSec = 0, masterObsEnabled = true) {
    if (!masterObsEnabled || !this.isConnected || !sceneName) return false;
    const prevScene = this.currentScene;
    await this.sendRequest('SetCurrentProgramScene', { sceneName });
    this.currentScene = sceneName;

    if (durationSec > 0 && prevScene && prevScene !== sceneName) {
      if (this.revertTimer) clearTimeout(this.revertTimer);
      this.revertTimer = setTimeout(() => {
        this.sendRequest('SetCurrentProgramScene', { sceneName: prevScene }).catch(() => {});
      }, durationSec * 1000);
    }
    return true;
  }

  async toggleFilterTemporary(sourceName, filterName, durationSec = 8, masterObsEnabled = true) {
    if (!masterObsEnabled || !this.isConnected || !sourceName || !filterName) return false;
    await this.sendRequest('SetSourceFilterEnabled', { sourceName, filterName, filterEnabled: true });
    if (durationSec > 0) {
      setTimeout(() => {
        this.sendRequest('SetSourceFilterEnabled', { sourceName, filterName, filterEnabled: false }).catch(() => {});
      }, durationSec * 1000);
    }
    return true;
  }

  async toggleMuteTemporary(inputName, durationSec = 10, masterObsEnabled = true) {
    if (!masterObsEnabled || !this.isConnected || !inputName) return false;
    await this.sendRequest('SetInputMute', { inputName, inputMuted: true });
    if (durationSec > 0) {
      setTimeout(() => {
        this.sendRequest('SetInputMute', { inputName, inputMuted: false }).catch(() => {});
      }, durationSec * 1000);
    }
    return true;
  }
}

module.exports = ObsDriver;

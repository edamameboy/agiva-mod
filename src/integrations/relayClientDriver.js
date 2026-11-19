// src/integrations/relayClientDriver.js — Outbound Multi-Creator Relay Client for ZimaOS Hub (widget.cornermoji.site)
'use strict';

const http = require('http');
const WebSocket = require('ws');

function sanitizeSlug(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9_.-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

class RelayClientDriver {
  constructor({ getConfigFn, getLocalPortFn, getAutoUsernameFn, getAppVersionFn, getInitialStateFn, onStateChangeFn } = {}) {
    this.getConfig = getConfigFn || (() => ({}));
    this.getLocalPort = getLocalPortFn || (() => 7030);
    this.getAutoUsername = getAutoUsernameFn || (() => '');
    this.getAppVersion = getAppVersionFn || (() => '1.7.5');
    this.getInitialState = getInitialStateFn || (() => ({}));
    this.onStateChange = onStateChangeFn || (() => {});

    this.ws = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.registeredSlug = '';
    this.remoteViewers = 0;
    this.lastError = '';
    this._reconnectTimer = null;
    this._pingTimer = null;
    this._manualStop = false;
  }

  resolveCreatorSlug() {
    const cfg = this.getConfig() || {};
    const custom = sanitizeSlug(cfg.creatorSlug);
    if (custom) return custom;
    const autoUser = sanitizeSlug(this.getAutoUsername());
    if (autoUser) return autoUser;
    const fallback = sanitizeSlug(cfg.fallbackCreatorSlug) || 'creator-default';
    return fallback;
  }

  getWsEndpointUrl() {
    const cfg = this.getConfig() || {};
    const rawDomain = String(cfg.publicDomain || 'https://widget.cornermoji.site').trim().replace(/\/+$/, '');
    if (!rawDomain) return '';
    try {
      const parsed = new URL(/^https?:\/\//i.test(rawDomain) ? rawDomain : `https://${rawDomain}`);
      const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${parsed.host}/relay-agent`;
    } catch {
      return '';
    }
  }

  getPublicCreatorBaseUrl() {
    const cfg = this.getConfig() || {};
    const rawDomain = String(cfg.publicDomain || 'https://widget.cornermoji.site').trim().replace(/\/+$/, '');
    if (!rawDomain) return '';
    const slug = this.registeredSlug || this.resolveCreatorSlug();
    if (cfg.relayEnabled === false) return rawDomain;
    return `${rawDomain}/c/${encodeURIComponent(slug)}`;
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      creatorSlug: this.registeredSlug || this.resolveCreatorSlug(),
      publicBaseUrl: this.getPublicCreatorBaseUrl(),
      remoteViewers: this.remoteViewers,
      lastError: this.lastError
    };
  }

  start() {
    this._manualStop = false;
    const cfg = this.getConfig() || {};
    if (cfg.relayEnabled === false || !cfg.publicDomain) {
      this.stop();
      return;
    }
    this._connect();
  }

  stop() {
    this._manualStop = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      try {
        oldWs.removeAllListeners();
        oldWs.on('error', () => {});
        if (oldWs.readyState === WebSocket.OPEN) oldWs.close();
        else oldWs.terminate();
      } catch {}
    }
    const wasConn = this.isConnected || this.isConnecting;
    this.isConnected = false;
    this.isConnecting = false;
    this.remoteViewers = 0;
    if (wasConn) this.onStateChange();
  }

  refreshRegistration() {
    const cfg = this.getConfig() || {};
    if (cfg.relayEnabled === false || !cfg.publicDomain) {
      this.stop();
      return;
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.start();
      return;
    }
    this._sendRegister();
  }

  _sendRegister() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const cfg = this.getConfig() || {};
    const slug = this.resolveCreatorSlug();
    try {
      this.ws.send(JSON.stringify({
        type: 'register',
        creatorId: slug,
        secret: cfg.relaySecret || '',
        appVersion: this.getAppVersion(),
        initialState: this.getInitialState()
      }));
    } catch {}
  }

  _connect() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    const wsUrl = this.getWsEndpointUrl();
    if (!wsUrl) return;

    if (this.ws) {
      const oldWs = this.ws;
      this.ws = null;
      try {
        oldWs.removeAllListeners();
        oldWs.on('error', () => {});
        if (oldWs.readyState === WebSocket.OPEN) oldWs.close();
        else oldWs.terminate();
      } catch {}
    }

    this.isConnecting = true;
    try {
      const socket = new WebSocket(wsUrl, {
        handshakeTimeout: 8000,
        headers: {
          'User-Agent': `AgivaMod-RelayClient/${this.getAppVersion()}`
        }
      });
      this.ws = socket;

      socket.on('open', () => {
        if (this.ws !== socket) return;
        this.isConnecting = false;
        this.isConnected = true;
        this.lastError = '';
        this._sendRegister();
        if (this._pingTimer) clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => {
          if (this.ws === socket && socket.readyState === WebSocket.OPEN) {
            try { socket.send(JSON.stringify({ type: 'ping' })); } catch {}
          }
        }, 25000);
        this.onStateChange();
      });

      socket.on('message', (raw) => {
        if (this.ws !== socket) return;
        try {
          const msg = JSON.parse(raw.toString());
          this._handleHubMessage(msg);
        } catch {}
      });

      socket.on('close', () => {
        if (this.ws !== socket) return;
        this.ws = null;
        this.isConnecting = false;
        this.isConnected = false;
        this.remoteViewers = 0;
        if (this._pingTimer) {
          clearInterval(this._pingTimer);
          this._pingTimer = null;
        }
        this.onStateChange();
        this._scheduleReconnect();
      });

      socket.on('error', (err) => {
        if (this.ws !== socket) return;
        this.lastError = err?.message || 'Relay connection error';
      });
    } catch (e) {
      this.isConnecting = false;
      this.isConnected = false;
      this.lastError = e.message;
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    if (this._manualStop) return;
    const cfg = this.getConfig() || {};
    if (cfg.relayEnabled === false || !cfg.publicDomain) return;
    if (this._reconnectTimer) return;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connect();
    }, 4000);
  }

  _handleHubMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'registered') {
      if (msg.ok && msg.creatorId) {
        this.registeredSlug = msg.creatorId;
        this.lastError = '';
      } else if (msg.error) {
        this.lastError = msg.error;
      }
      this.onStateChange();
      return;
    }
    if (msg.type === 'pong') {
      if (typeof msg.viewers === 'number' && msg.viewers !== this.remoteViewers) {
        this.remoteViewers = msg.viewers;
        this.onStateChange();
      }
      return;
    }
    if (msg.type === 'viewer_count') {
      this.remoteViewers = Number(msg.viewers) || 0;
      this.onStateChange();
      return;
    }
    if (msg.type === 'http_proxy_req' && msg.reqId) {
      this._executeLocalHttpProxy(msg);
    }
  }

  _executeLocalHttpProxy(reqMsg) {
    const port = this.getLocalPort();
    const method = (reqMsg.method || 'GET').toUpperCase();
    const targetPath = String(reqMsg.path || '/overlay');
    const bodyBuf = reqMsg.bodyBase64 ? Buffer.from(reqMsg.bodyBase64, 'base64') : null;

    const headers = {
      ...(reqMsg.headers || {}),
      'host': `127.0.0.1:${port}`,
      'x-forwarded-host': 'widget.cornermoji.site',
      'cf-connecting-ip': reqMsg.clientIp || '203.0.113.1'
    };
    if (bodyBuf) {
      headers['content-length'] = Buffer.byteLength(bodyBuf);
    } else {
      delete headers['content-length'];
    }

    const localReq = http.request({
      hostname: '127.0.0.1',
      port,
      path: targetPath,
      method,
      headers,
      timeout: 10000
    }, (localRes) => {
      const chunks = [];
      localRes.on('data', (c) => chunks.push(c));
      localRes.on('end', () => {
        const fullBuf = Buffer.concat(chunks);
        const outHeaders = {};
        for (const [k, v] of Object.entries(localRes.headers || {})) {
          if (['content-type', 'cache-control', 'location', 'accept-ranges', 'content-range'].includes(k.toLowerCase())) {
            outHeaders[k] = v;
          }
        }
        this._sendHub({
          type: 'http_proxy_res',
          reqId: reqMsg.reqId,
          statusCode: localRes.statusCode || 200,
          headers: outHeaders,
          bodyBase64: fullBuf.toString('base64')
        });
      });
    });

    localReq.on('timeout', () => {
      localReq.destroy();
      this._sendHub({
        type: 'http_proxy_res',
        reqId: reqMsg.reqId,
        statusCode: 504,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        bodyBase64: Buffer.from(JSON.stringify({ ok: false, error: 'Local creator timeout' })).toString('base64')
      });
    });

    localReq.on('error', (err) => {
      this._sendHub({
        type: 'http_proxy_res',
        reqId: reqMsg.reqId,
        statusCode: 502,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        bodyBase64: Buffer.from(JSON.stringify({ ok: false, error: err.message })).toString('base64')
      });
    });

    if (bodyBuf && method !== 'GET' && method !== 'HEAD') {
      localReq.write(bodyBuf);
    }
    localReq.end();
  }

  forwardBroadcast(data) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!data || typeof data !== 'object') return;
    // Never forward internal updater or sensitive integration broadcasts to public overlay hub
    if (['update_progress', 'update_ready', 'update_error', 'update_available', 'integrations_update'].includes(data.type)) {
      return;
    }
    this._sendHub({
      type: 'broadcast',
      data
    });
  }

  _sendHub(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(payload));
    } catch {}
  }
}

RelayClientDriver.sanitizeSlug = sanitizeSlug;
module.exports = RelayClientDriver;

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const paths = require('../paths');

const COMPAT_CONFIG_PATH = paths.COMPAT_CONFIG_PATH;

class CompatBridgeServer {
  constructor({ widgetManager, audioTtsDriver, effectMap, triggerEffectFn }) {
    this.widgetManager = widgetManager;
    this.audioTtsDriver = audioTtsDriver;
    this.effectMap = effectMap;
    this.triggerEffect = triggerEffectFn || (() => {});

    this.config = {
      enabled: false, // Can be toggled ON/OFF by user in dashboard
      wsPort: 62024,
      sioPort: 62025,
      apiPort: 62030,
      tikfinityPort: 21213
    };

    this.wsServer = null;
    this.wsHttp = null;
    this.wsClients = new Set();

    this.sioHttp = null;
    this.sioWsServer = null;
    this.sioClients = new Set();

    this.tfHttp = null;
    this.tfWsServer = null;
    this.tfClients = new Set();

    this.apiHttp = null;
    this.status = {
      ws62024: { running: false, port: 62024, clients: 0, error: '' },
      sio62025: { running: false, port: 62025, clients: 0, error: '' },
      api62030: { running: false, port: 62030, error: '' },
      tf21213: { running: false, port: 21213, clients: 0, error: '' }
    };

    this.loadConfig();
    if (this.config.enabled) {
      this.start();
    }
  }

  loadConfig() {
    try {
      const dir = path.dirname(COMPAT_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(COMPAT_CONFIG_PATH)) {
        const saved = JSON.parse(fs.readFileSync(COMPAT_CONFIG_PATH, 'utf8'));
        this.config = { ...this.config, ...saved };
      } else {
        this.saveConfig();
      }
    } catch (e) {
      console.error('[CompatBridge] Failed to load config:', e.message);
    }
  }

  saveConfig() {
    try {
      const dir = path.dirname(COMPAT_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(COMPAT_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e) {
      console.error('[CompatBridge] Failed to save config:', e.message);
    }
  }

  getStatus() {
    const pCfg = this.config.ports || {};
    const ws62024 = { ...this.status.ws62024, listening: Boolean(this.status.ws62024.running), enabled: pCfg.wsRaw62024 !== false, clients: this.wsClients.size, lastError: this.status.ws62024.error };
    const sio62025 = { ...this.status.sio62025, listening: Boolean(this.status.sio62025.running), enabled: pCfg.wsSocket62025 !== false, clients: this.sioClients.size, lastError: this.status.sio62025.error };
    const api62030 = { ...this.status.api62030, listening: Boolean(this.status.api62030.running), enabled: pCfg.httpApi62030 !== false, clients: 0, lastError: this.status.api62030.error };
    const tf21213 = { ...this.status.tf21213, listening: Boolean(this.status.tf21213.running), enabled: pCfg.wsTikFinity21213 !== false, clients: this.tfClients.size, lastError: this.status.tf21213.error };
    return {
      enabled: this.config.enabled,
      ws62024,
      sio62025,
      api62030,
      tf21213,
      ports: {
        wsRaw62024: ws62024,
        wsSocket62025: sio62025,
        httpApi62030: api62030,
        wsTikFinity21213: tf21213
      }
    };
  }

  async setEnabled(enabled, ports = null) {
    if (enabled !== undefined) this.config.enabled = Boolean(enabled);
    if (ports && typeof ports === 'object') {
      if (!this.config.ports) this.config.ports = {};
      if (ports.wsRaw62024 !== undefined) this.config.ports.wsRaw62024 = Boolean(ports.wsRaw62024?.enabled ?? ports.wsRaw62024);
      if (ports.wsSocket62025 !== undefined) this.config.ports.wsSocket62025 = Boolean(ports.wsSocket62025?.enabled ?? ports.wsSocket62025);
      if (ports.httpApi62030 !== undefined) this.config.ports.httpApi62030 = Boolean(ports.httpApi62030?.enabled ?? ports.httpApi62030);
      if (ports.wsTikFinity21213 !== undefined) this.config.ports.wsTikFinity21213 = Boolean(ports.wsTikFinity21213?.enabled ?? ports.wsTikFinity21213);
    }
    this.saveConfig();
    if (this.config.enabled) {
      await this.start();
      await new Promise(r => setTimeout(r, 120));
    } else {
      await this.stop();
    }
    return this.getStatus();
  }

  async start() {
    await this.stop();
    const pCfg = this.config.ports || {};
    if (pCfg.wsRaw62024 !== false) this._startWs62024();
    if (pCfg.wsSocket62025 !== false) this._startSio62025();
    if (pCfg.httpApi62030 !== false) this._startApi62030();
    if (pCfg.wsTikFinity21213 !== false) this._startTikFinity21213();
    return this.getStatus();
  }

  async stop() {
    for (const c of this.wsClients) { try { c.close(); } catch {} }
    this.wsClients.clear();
    if (this.wsServer) { try { this.wsServer.close(); } catch {} this.wsServer = null; }
    if (this.wsHttp) { try { this.wsHttp.close(); } catch {} this.wsHttp = null; }
    this.status.ws62024.running = false;

    for (const c of this.sioClients) { try { c.close(); } catch {} }
    this.sioClients.clear();
    if (this.sioWsServer) { try { this.sioWsServer.close(); } catch {} this.sioWsServer = null; }
    if (this.sioHttp) { try { this.sioHttp.close(); } catch {} this.sioHttp = null; }
    this.status.sio62025.running = false;

    for (const c of this.tfClients) { try { c.close(); } catch {} }
    this.tfClients.clear();
    if (this.tfWsServer) { try { this.tfWsServer.close(); } catch {} this.tfWsServer = null; }
    if (this.tfHttp) { try { this.tfHttp.close(); } catch {} this.tfHttp = null; }
    this.status.tf21213.running = false;

    if (this.apiHttp) { try { this.apiHttp.close(); } catch {} this.apiHttp = null; }
    this.status.api62030.running = false;
  }

  _startWs62024() {
    const port = Number(this.config.wsPort) || 62024;
    this.wsHttp = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ service: 'Agiva Compat WS Bridge', port }));
    });
    this.wsServer = new WebSocket.Server({ server: this.wsHttp });

    this.wsServer.on('connection', (ws) => {
      this.wsClients.add(ws);
      ws.send(JSON.stringify({ event: 'state', data: 'connected' }));
      ws.on('message', (msg) => {
        try { ws.send(msg.toString()); } catch {}
      });
      ws.on('close', () => this.wsClients.delete(ws));
    });

    this.wsHttp.on('error', (err) => {
      this.status.ws62024 = { running: false, port, clients: 0, error: err.message };
      console.error(`[CompatBridge :${port}] Error:`, err.message);
    });

    this.wsHttp.listen(port, '127.0.0.1', () => {
      this.status.ws62024 = { running: true, port, clients: 0, error: '' };
      console.log(`[CompatBridge] IndoFinity/TikFinity Raw WS Bridge listening on ws://127.0.0.1:${port}`);
    });
  }

  _startSio62025() {
    const port = Number(this.config.sioPort) || 62025;
    this.sioHttp = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ service: 'Agiva Compat Socket Bridge', port }));
    });
    this.sioWsServer = new WebSocket.Server({ server: this.sioHttp });

    this.sioWsServer.on('connection', (ws) => {
      this.sioClients.add(ws);
      // Emit both standard JSON and Socket.IO-style frame `42["state","connected"]`
      try { ws.send(JSON.stringify({ event: 'state', data: 'connected' })); } catch {}
      ws.on('close', () => this.sioClients.delete(ws));
    });

    this.sioHttp.on('error', (err) => {
      this.status.sio62025 = { running: false, port, clients: 0, error: err.message };
      console.error(`[CompatBridge :${port}] Error:`, err.message);
    });

    this.sioHttp.listen(port, '127.0.0.1', () => {
      this.status.sio62025 = { running: true, port, clients: 0, error: '' };
      console.log(`[CompatBridge] Secondary Socket Bridge listening on ws://127.0.0.1:${port}`);
    });
  }

  _startApi62030() {
    const port = Number(this.config.apiPort) || 62030;
    this.apiHttp = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      let rawBody = '';
      req.on('data', chunk => { rawBody += chunk.toString(); });
      req.on('end', () => {
        let body = {};
        if (rawBody) {
          try { body = JSON.parse(rawBody); } catch {}
        }
        const urlObj = new URL(req.url || '/', `http://127.0.0.1:${port}`);
        const pathname = urlObj.pathname;

        const sendJson = (code, obj) => {
          res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(obj));
        };

        if (pathname === '/v1/interaksi') {
          if (req.method === 'GET') {
            const game = this.effectMap.getActiveGameConfig();
            return sendJson(200, { ok: true, gameId: game?.id, effects: game?.effects || {} });
          }
          const effectId = body.effectId || body.id || urlObj.searchParams.get('id');
          if (!effectId) return sendJson(400, { ok: false, error: 'effectId required' });
          this.triggerEffect(effectId, body.user || 'LocalAPI', 'local_api');
          return sendJson(200, { ok: true, triggered: effectId });
        }

        if (pathname === '/v1/timer') {
          const action = body.action || urlObj.searchParams.get('action') || 'status';
          const val = body.value ?? body.seconds ?? urlObj.searchParams.get('value');
          if (action === 'status' && req.method === 'GET') {
            return sendJson(200, { ok: true, timer: this.widgetManager.state.timer });
          }
          const timer = this.widgetManager.controlTimer(action, val, 'LocalAPI');
          return sendJson(200, { ok: true, timer });
        }

        if (pathname === '/v1/spin') {
          const spin = this.widgetManager.spinWheel(body.user || 'LocalAPI');
          return sendJson(200, { ok: true, spin });
        }

        if (pathname === '/v1/winlose') {
          const action = body.action || urlObj.searchParams.get('action') || 'win_add';
          const counter = this.widgetManager.controlCounter(action, body.value || 1);
          return sendJson(200, { ok: true, counter });
        }

        if (pathname === '/v1/soundboard') {
          const soundId = body.soundId || body.id || urlObj.searchParams.get('id');
          if (!soundId) return sendJson(200, { ok: true, items: this.audioTtsDriver.config.soundboard.items });
          const played = this.audioTtsDriver.playSound(soundId);
          return sendJson(200, { ok: true, played });
        }

        if (pathname === '/v1/giveaway') {
          const action = body.action || urlObj.searchParams.get('action') || 'draw';
          const gw = this.widgetManager.controlGiveaway(action, body);
          return sendJson(200, { ok: true, giveaway: gw });
        }

        sendJson(200, {
          ok: true,
          service: 'Agiva Local API v1 (IndoFinity/TikFinity Compatible)',
          endpoints: ['/v1/interaksi', '/v1/timer', '/v1/spin', '/v1/winlose', '/v1/soundboard', '/v1/giveaway']
        });
      });
    });

    this.apiHttp.on('error', (err) => {
      this.status.api62030 = { running: false, port, error: err.message };
      console.error(`[CompatBridge :${port}] Error:`, err.message);
    });

    this.apiHttp.listen(port, '127.0.0.1', () => {
      this.status.api62030 = { running: true, port, error: '' };
      console.log(`[CompatBridge] Local REST API listening on http://127.0.0.1:${port}`);
    });
  }

  _startTikFinity21213() {
    const port = Number(this.config.tikfinityPort) || 21213;
    this.tfHttp = http.createServer((req, res) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        service: 'Agiva TikFinity Event API Bridge',
        port,
        wsUrl: `ws://127.0.0.1:${port}/`,
        events: ['chat', 'gift', 'like', 'follow', 'share', 'subscribe', 'member', 'emote', 'envelope', 'donation', 'interaksi']
      }));
    });
    this.tfWsServer = new WebSocket.Server({ server: this.tfHttp });

    this.tfWsServer.on('connection', (ws) => {
      this.tfClients.add(ws);
      try {
        ws.send(JSON.stringify({
          event: 'connected',
          data: { service: 'Agiva TikFinity Event API Bridge', port }
        }));
      } catch {}

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          const ev = msg.event || msg.type || '';
          const d = msg.data || msg;
          if (ev === 'triggerEffect' && d.effectId) {
            this.triggerEffect(d.effectId, d.user || 'TikFinityAPI', 'tikfinity_21213');
            ws.send(JSON.stringify({ event: 'ack', data: { triggered: d.effectId } }));
          } else if (ev === 'tts' && d.text && this.audioTtsDriver) {
            this.audioTtsDriver.speak(String(d.text), { user: d.user || 'TikFinityAPI' }, true);
            ws.send(JSON.stringify({ event: 'ack', data: { spoke: d.text } }));
          } else if (ev === 'playSound' && d.soundId && this.audioTtsDriver) {
            this.audioTtsDriver.playSound(String(d.soundId));
            ws.send(JSON.stringify({ event: 'ack', data: { played: d.soundId } }));
          }
        } catch {}
      });

      ws.on('close', () => this.tfClients.delete(ws));
    });

    this.tfHttp.on('error', (err) => {
      this.status.tf21213 = { running: false, port, clients: 0, error: err.message };
      console.error(`[CompatBridge :${port}] Error:`, err.message);
    });

    this.tfHttp.listen(port, '127.0.0.1', () => {
      this.status.tf21213 = { running: true, port, clients: 0, error: '' };
      console.log(`[CompatBridge] TikFinity Event API Bridge listening on ws://127.0.0.1:${port}/`);
    });
  }

  /**
   * Broadcast a TikTok or Stream event to connected :62024, :62025, and :21213 clients
   */
  broadcastEvent(eventType, data) {
    if (!this.config.enabled) return;
    const payload = JSON.stringify({ event: eventType, type: eventType, data, timestamp: Date.now() });
    for (const c of this.wsClients) {
      if (c.readyState === WebSocket.OPEN) {
        try { c.send(payload); } catch {}
      }
    }
    for (const c of this.sioClients) {
      if (c.readyState === WebSocket.OPEN) {
        try { c.send(payload); } catch {}
      }
    }
    for (const c of this.tfClients) {
      if (c.readyState === WebSocket.OPEN) {
        try { c.send(payload); } catch {}
      }
    }
  }

  /**
   * Generate starter client script for TikFinity Event API (:21213)
   */
  getExampleScript(lang = 'js') {
    const port = Number(this.config.tikfinityPort) || 21213;
    if (lang === 'py' || lang === 'python') {
      return `# Agiva Mod — TikFinity Event API Python Client (ws://127.0.0.1:${port}/)
# Install dependency: pip install websocket-client
import json
import websocket

WS_URL = "ws://127.0.0.1:${port}/"

def on_open(ws):
    print(f"[Agiva] Connected to {WS_URL}")

def on_message(ws, message):
    msg = json.loads(message)
    event = msg.get("event")
    data = msg.get("data", {})
    if event == "chat":
        print(f"[CHAT] @{data.get('user')}: {data.get('comment')}")
    elif event == "gift":
        print(f"[GIFT] @{data.get('user')} sent {data.get('giftName')} ({data.get('coins')} coins)")
    elif event == "donation":
        print(f"[DONATION] @{data.get('user')} donated Rp {data.get('amount')}")
    else:
        print(f"[{event}] {data}")

if __name__ == "__main__":
    ws = websocket.WebSocketApp(WS_URL, on_open=on_open, on_message=on_message)
    ws.run_forever()
`;
    }

    return `// Agiva Mod — TikFinity Event API JavaScript Client (ws://127.0.0.1:${port}/)
// Works in Browser or Node.js (npm i ws)
const WebSocketClient = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');
const ws = new WebSocketClient('ws://127.0.0.1:${port}/');

ws.onopen = () => {
  console.log('[Agiva] Connected to TikFinity Event API Bridge (:21213)');
};

ws.onmessage = (e) => {
  const msg = JSON.parse(typeof e.data === 'string' ? e.data : e.toString());
  const { event, data } = msg;
  if (event === 'chat') {
    console.log(\`[CHAT] @\${data.user}: \${data.comment}\`);
  } else if (event === 'gift') {
    console.log(\`[GIFT] @\${data.user} -> \${data.giftName} (\${data.coins} coins)\`);
  } else if (event === 'like') {
    console.log(\`[LIKE] @\${data.user} +\${data.count} likes\`);
  }
};
`;
  }
}

module.exports = CompatBridgeServer;

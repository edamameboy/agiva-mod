const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
const paths = require('../paths');

const DONATION_CONFIG_PATH = paths.DONATION_CONFIG_PATH;

class DonationSocketProvider {
  constructor(onDonationCallback) {
    this.onDonation = onDonationCallback || (() => {});
    this.sockets = {};
    this.config = {
      idrPerCoin: 250, // Rp 250 = 1 Coin equivalent
      autoTriggerCoinTiers: true, // Allow IDR donations to fallback to Coin Tiers if no IDR tier matched
      platforms: {
        saweria: { enabled: false, streamKey: '', status: 'disconnected' },
        sociabuzz: { enabled: false, streamKey: '', status: 'disconnected' },
        trakteer: { enabled: false, streamKey: '', status: 'disconnected' },
        bagibagi: { enabled: false, streamKey: '', status: 'disconnected' }
      }
    };

    this.loadConfig();
    this.reconnectActiveStreams();
  }

  loadConfig() {
    try {
      const dir = path.dirname(DONATION_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(DONATION_CONFIG_PATH)) {
        const saved = JSON.parse(fs.readFileSync(DONATION_CONFIG_PATH, 'utf8'));
        this.config = {
          ...this.config,
          ...saved,
          platforms: {
            saweria: { ...this.config.platforms.saweria, ...(saved.platforms?.saweria || {}), status: 'disconnected' },
            sociabuzz: { ...this.config.platforms.sociabuzz, ...(saved.platforms?.sociabuzz || {}), status: 'disconnected' },
            trakteer: { ...this.config.platforms.trakteer, ...(saved.platforms?.trakteer || {}), status: 'disconnected' },
            bagibagi: { ...this.config.platforms.bagibagi, ...(saved.platforms?.bagibagi || {}), status: 'disconnected' }
          }
        };
      } else {
        this.saveConfig();
      }
    } catch {}
  }

  saveConfig(updates = {}) {
    if (updates.idrPerCoin !== undefined) this.config.idrPerCoin = Math.max(1, Number(updates.idrPerCoin) || 250);
    if (updates.autoTriggerCoinTiers !== undefined) this.config.autoTriggerCoinTiers = Boolean(updates.autoTriggerCoinTiers);
    if (updates.platforms) {
      for (const [k, v] of Object.entries(updates.platforms)) {
        if (this.config.platforms[k]) {
          this.config.platforms[k] = {
            ...this.config.platforms[k],
            enabled: v.enabled !== undefined ? Boolean(v.enabled) : this.config.platforms[k].enabled,
            streamKey: v.streamKey !== undefined ? String(v.streamKey).trim() : this.config.platforms[k].streamKey
          };
        }
      }
    }
    try {
      const dir = path.dirname(DONATION_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(DONATION_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
    } catch {}
    this.reconnectActiveStreams();
    return this.getStatus();
  }

  getStatus() {
    return this.config;
  }

  convertIdrToCoins(amountIdr) {
    const rate = Math.max(1, Number(this.config.idrPerCoin) || 250);
    return Math.max(1, Math.floor((Number(amountIdr) || 0) / rate));
  }

  reconnectActiveStreams() {
    // Close existing sockets
    for (const [k, ws] of Object.entries(this.sockets)) {
      try { ws.removeAllListeners(); ws.close(); } catch {}
      delete this.sockets[k];
    }

    // Connect Saweria Direct Stream Socket if enabled & streamKey provided
    const saw = this.config.platforms.saweria;
    if (saw.enabled && saw.streamKey) {
      this._connectSaweriaStream(saw.streamKey);
    } else if (saw) {
      saw.status = 'disconnected';
    }

    // Mark others as ready if streamKey is set (supports both outbound WS and local webhook relay)
    for (const key of ['sociabuzz', 'trakteer', 'bagibagi']) {
      const p = this.config.platforms[key];
      if (p) {
        p.status = (p.enabled && p.streamKey) ? 'ready (stream-key + webhook)' : 'disconnected';
      }
    }
  }

  _connectSaweriaStream(streamKey) {
    try {
      const wsUrl = `wss://events.saweria.co/stream?streamKey=${encodeURIComponent(streamKey)}`;
      const ws = new WebSocket(wsUrl);
      this.sockets.saweria = ws;
      this.config.platforms.saweria.status = 'connecting';

      ws.on('open', () => {
        this.config.platforms.saweria.status = 'connected';
        console.log('[DonationSocket] Connected to Saweria real-time stream (No Ngrok required)');
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          const d = msg.data || msg;
          if (d && (d.amount || d.amount_raw)) {
            this.onDonation({
              platform: 'saweria',
              user: d.donator_name || d.name || 'Anonim',
              amount: Number(d.amount || d.amount_raw || 0),
              message: d.message || ''
            });
          }
        } catch {}
      });

      ws.on('close', () => {
        this.config.platforms.saweria.status = 'disconnected';
      });

      ws.on('error', () => {
        this.config.platforms.saweria.status = 'error';
      });
    } catch {
      this.config.platforms.saweria.status = 'error';
    }
  }
}

module.exports = DonationSocketProvider;

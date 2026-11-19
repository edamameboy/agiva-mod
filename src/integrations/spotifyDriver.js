// src/integrations/spotifyDriver.js — Spotify & Standalone Song Request Engine (!play, !skip, !revoke, !song)
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const paths = require('../paths');

const SPOTIFY_CONFIG_PATH = paths.SPOTIFY_CONFIG_PATH;

class SpotifyDriver {
  constructor({ broadcastFn } = {}) {
    this.broadcast = broadcastFn || (() => {});
    this._saveTimer = null;
    this._dirty = false;
    this._autoAdvanceTimer = null;

    this.config = {
      enabled: false,
      mode: 'standalone', // 'standalone' (iTunes/Metadata + Overlay Player) | 'spotify' (Spotify Web API OAuth)
      clientId: '',
      clientSecret: '',
      redirectUri: 'http://127.0.0.1:7030/api/spotify/callback',
      accessToken: '',
      refreshToken: '',
      tokenExpiresAt: 0,
      commandPlay: '!play',
      commandSkip: '!skip',
      commandRevoke: '!revoke',
      commandCurrent: '!song',
      costPoints: 0,
      allowExplicit: false,
      maxQueueSize: 20,
      maxPerUser: 3,
      allowedRole: 'all', // 'all' | 'follower' | 'subscriber' | 'moderator'
      autoPlayOverlayAudio: true
    };

    this.currentTrack = null;
    this.queue = [];
    this.history = [];

    this.loadConfig();
  }

  loadConfig() {
    try {
      const dir = path.dirname(SPOTIFY_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(SPOTIFY_CONFIG_PATH)) {
        const saved = JSON.parse(fs.readFileSync(SPOTIFY_CONFIG_PATH, 'utf8'));
        if (saved.config) {
          if (saved.config.redirectUri === 'http://127.0.0.1:3000/api/spotify/callback') {
            saved.config.redirectUri = 'http://127.0.0.1:7030/api/spotify/callback';
          }
          this.config = { ...this.config, ...saved.config };
        }
        if (Array.isArray(saved.queue)) this.queue = saved.queue;
        if (saved.currentTrack) this.currentTrack = saved.currentTrack;
      }
    } catch (e) {
      console.error('[SpotifyDriver] Failed to load config:', e.message);
    }
  }

  saveConfig() {
    this._dirty = true;
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      this.flushSaveSync();
    }, 2500);
  }

  flushSaveSync() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
    }
    if (!this._dirty) return;
    this._dirty = false;
    try {
      const dir = path.dirname(SPOTIFY_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const safeConfig = { ...this.config };
      fs.writeFileSync(
        SPOTIFY_CONFIG_PATH,
        JSON.stringify({ config: safeConfig, currentTrack: this.currentTrack, queue: this.queue }, null, 2),
        'utf8'
      );
    } catch (e) {
      console.error('[SpotifyDriver] Failed to save config:', e.message);
    }
  }

  getState() {
    return {
      config: {
        ...this.config,
        hasSpotifyToken: Boolean(this.config.accessToken || this.config.refreshToken),
        clientSecret: this.config.clientSecret ? '••••••••' : '',
        accessToken: undefined,
        refreshToken: undefined
      },
      currentTrack: this.currentTrack,
      queue: this.queue,
      history: this.history.slice(0, 10)
    };
  }

  exportRawConfig() {
    return {
      config: { ...this.config, clientSecret: '', accessToken: '', refreshToken: '' },
      queue: this.queue
    };
  }

  updateConfig(patch = {}) {
    const clean = { ...patch };
    if (clean.clientSecret === '••••••••' || clean.clientSecret === undefined) {
      delete clean.clientSecret;
    }
    delete clean.accessToken;
    delete clean.refreshToken;
    this.config = {
      ...this.config,
      ...clean,
      enabled: clean.enabled !== undefined ? Boolean(clean.enabled) : this.config.enabled,
      costPoints: clean.costPoints !== undefined ? Math.max(0, Number(clean.costPoints) || 0) : this.config.costPoints,
      allowExplicit: clean.allowExplicit !== undefined ? Boolean(clean.allowExplicit) : this.config.allowExplicit,
      maxQueueSize: clean.maxQueueSize !== undefined ? Math.max(1, Number(clean.maxQueueSize) || 20) : this.config.maxQueueSize,
      maxPerUser: clean.maxPerUser !== undefined ? Math.max(1, Number(clean.maxPerUser) || 3) : this.config.maxPerUser,
      autoPlayOverlayAudio: clean.autoPlayOverlayAudio !== undefined ? Boolean(clean.autoPlayOverlayAudio) : this.config.autoPlayOverlayAudio
    };
    this.saveConfig();
    this._broadcastState();
    return this.getState();
  }

  getAuthUrl() {
    if (!this.config.clientId) {
      throw new Error('Spotify Client ID belum diisi.');
    }
    const scopes = [
      'user-read-playback-state',
      'user-modify-playback-state',
      'user-read-currently-playing'
    ].join(' ');
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      scope: scopes,
      redirect_uri: this.config.redirectUri || 'http://127.0.0.1:7030/api/spotify/callback'
    });
    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  async exchangeCode(code) {
    if (!code || !this.config.clientId || !this.config.clientSecret) {
      throw new Error('Client ID, Client Secret, dan Authorization Code diperlukan.');
    }
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri || 'http://127.0.0.1:7030/api/spotify/callback'
    }).toString();

    const auth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const res = await this._httpsRequest('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      },
      body
    });

    if (res.statusCode !== 200 || !res.json?.access_token) {
      throw new Error(res.json?.error_description || 'Gagal menukar token Spotify OAuth');
    }

    this.config.accessToken = res.json.access_token;
    if (res.json.refresh_token) this.config.refreshToken = res.json.refresh_token;
    this.config.tokenExpiresAt = Date.now() + ((Number(res.json.expires_in) || 3600) - 60) * 1000;
    this.config.mode = 'spotify';
    this.saveConfig();
    this._broadcastState();
    return this.getState();
  }

  async refreshAccessToken() {
    if (!this.config.refreshToken || !this.config.clientId || !this.config.clientSecret) return false;
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.config.refreshToken
    }).toString();
    const auth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    try {
      const res = await this._httpsRequest('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(body)
        },
        body
      });
      if (res.statusCode === 200 && res.json?.access_token) {
        this.config.accessToken = res.json.access_token;
        this.config.tokenExpiresAt = Date.now() + ((Number(res.json.expires_in) || 3600) - 60) * 1000;
        this.saveConfig();
        return true;
      }
    } catch {}
    return false;
  }

  _httpsRequest(urlStr, { method = 'GET', headers = {}, body = null, timeout = 6000 } = {}) {
    return new Promise((resolve, reject) => {
      try {
        const parsed = new URL(urlStr);
        const req = https.request({
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method,
          headers: {
            'User-Agent': 'agiva-mod/1.7.5',
            'Accept': 'application/json',
            ...headers
          },
          timeout
        }, (res) => {
          let raw = '';
          res.on('data', d => { raw += d; });
          res.on('end', () => {
            let json = null;
            try { json = raw ? JSON.parse(raw) : null; } catch {}
            resolve({ statusCode: res.statusCode, json, raw });
          });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.on('error', reject);
        if (body) req.write(body);
        req.end();
      } catch (e) {
        reject(e);
      }
    });
  }

  async searchTrack(query, { allowNetwork = true } = {}) {
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) return null;

    const explicitKeyword = /\b(explicit|nsfw|18\+|uncensored)\b/i.test(cleanQuery);

    if (allowNetwork && process.env.AGIVA_SPOTIFY_OFFLINE !== '1') {
      // 1. Try Spotify Web API if OAuth token is active
      if (this.config.mode === 'spotify' && this.config.accessToken) {
        if (Date.now() > (this.config.tokenExpiresAt || 0)) {
          await this.refreshAccessToken();
        }
        try {
          const spUrl = `https://api.spotify.com/v1/search?type=track&limit=5&q=${encodeURIComponent(cleanQuery)}`;
          const spRes = await this._httpsRequest(spUrl, {
            headers: { 'Authorization': `Bearer ${this.config.accessToken}` },
            timeout: 4500
          });
          const items = spRes.json?.tracks?.items;
          if (Array.isArray(items) && items.length > 0) {
            const picked = this.config.allowExplicit ? items[0] : (items.find(t => !t.explicit) || items[0]);
            return {
              id: `sp_${picked.id || Date.now()}`,
              title: picked.name || cleanQuery,
              artist: (picked.artists || []).map(a => a.name).join(', ') || 'Unknown Artist',
              album: picked.album?.name || '',
              coverUrl: picked.album?.images?.[0]?.url || '',
              previewUrl: picked.preview_url || '',
              uri: picked.uri || '',
              durationMs: Number(picked.duration_ms) || 30000,
              explicit: Boolean(picked.explicit)
            };
          }
        } catch {}
      }

      // 2. Try iTunes Search API (free metadata + 30s audio preview + album cover)
      try {
        const itUrl = `https://itunes.apple.com/search?media=music&entity=song&limit=5&term=${encodeURIComponent(cleanQuery)}`;
        const itRes = await this._httpsRequest(itUrl, { timeout: 4000 });
        const results = itRes.json?.results;
        if (Array.isArray(results) && results.length > 0) {
          const picked = this.config.allowExplicit
            ? results[0]
            : (results.find(r => r.trackExplicitness !== 'explicit') || results[0]);
          return {
            id: `it_${picked.trackId || Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            title: picked.trackName || cleanQuery,
            artist: picked.artistName || 'Artist',
            album: picked.collectionName || '',
            coverUrl: (picked.artworkUrl100 || '').replace('100x100bb', '300x300bb'),
            previewUrl: picked.previewUrl || '',
            uri: picked.trackViewUrl || '',
            durationMs: 30000,
            explicit: picked.trackExplicitness === 'explicit' || explicitKeyword
          };
        }
      } catch {}
    }

    // 3. Deterministic offline / custom request fallback
    const parts = cleanQuery.split(/\s+-\s+/);
    const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : cleanQuery;
    const artist = parts.length > 1 ? parts[0].trim() : 'Requested Song';
    return {
      id: `sr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      title,
      artist,
      album: 'Viewer Song Request',
      coverUrl: '',
      previewUrl: '',
      uri: '',
      durationMs: 30000,
      explicit: explicitKeyword
    };
  }

  _passesRoleFilter(userMeta = {}) {
    const role = this.config.allowedRole || 'all';
    if (role === 'all') return true;
    if (role === 'moderator') return Boolean(userMeta.isModerator || userMeta.isAdmin);
    if (role === 'subscriber') return Boolean(userMeta.isSubscribe || userMeta.isModerator);
    if (role === 'follower') return Boolean(userMeta.isFollower || userMeta.followRole >= 1 || userMeta.isSubscribe || userMeta.isModerator);
    return true;
  }

  async requestSong(query, userMeta = {}, { pointsManager = null, force = false } = {}) {
    if (!force && !this.config.enabled) {
      return { ok: false, error: 'Song Request sedang dinonaktifkan.' };
    }
    const cleanQuery = String(query || '').trim();
    if (!cleanQuery) {
      return { ok: false, error: 'Masukkan judul lagu (contoh: !play Hindia Evaluasi).' };
    }

    const user = userMeta.uniqueId || userMeta.user || 'Penonton';
    const nickname = userMeta.nickname || user;

    if (!force && !this._passesRoleFilter(userMeta)) {
      return { ok: false, error: `Hanya ${this.config.allowedRole} yang dapat request lagu.` };
    }

    const maxQ = Math.max(1, Number(this.config.maxQueueSize) || 20);
    if (this.queue.length >= maxQ) {
      return { ok: false, error: `Antrean lagu sudah penuh (maks ${maxQ} lagu).` };
    }

    const maxUser = Math.max(1, Number(this.config.maxPerUser) || 3);
    const userQueuedCount = this.queue.filter(t => t.requestedBy === user).length;
    if (!force && userQueuedCount >= maxUser) {
      return { ok: false, error: `Kamu sudah memiliki ${userQueuedCount} lagu di antrean (maks ${maxUser}).` };
    }

    const track = await this.searchTrack(cleanQuery);
    if (!track) {
      return { ok: false, error: 'Lagu tidak ditemukan.' };
    }

    if (!this.config.allowExplicit && track.explicit) {
      return { ok: false, error: `Lagu "${track.title}" ditolak karena mengandung konten Explicit.` };
    }

    const cost = !force ? Math.max(0, Number(this.config.costPoints) || 0) : 0;
    if (cost > 0 && pointsManager) {
      const spent = pointsManager.spendPoints(user, cost, 'song_request', { nickname });
      if (!spent.ok) {
        return { ok: false, error: spent.error || `Poin tidak cukup (butuh ${cost} poin).` };
      }
    }

    const queuedItem = {
      ...track,
      requestedBy: user,
      requestedByName: nickname,
      requestedAt: Date.now()
    };

    // If Spotify Web API mode with active token and track URI, also push to Spotify player queue
    if (this.config.mode === 'spotify' && this.config.accessToken && track.uri && track.uri.startsWith('spotify:track:')) {
      this._httpsRequest(
        `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(track.uri)}`,
        { method: 'POST', headers: { 'Authorization': `Bearer ${this.config.accessToken}`, 'Content-Length': 0 } }
      ).catch(() => {});
    }

    this.queue.push(queuedItem);
    if (!this.currentTrack) {
      this._advanceQueue();
    } else {
      this.saveConfig();
      this._broadcastState();
    }

    return {
      ok: true,
      track: queuedItem,
      position: this.currentTrack?.id === queuedItem.id ? 0 : this.queue.length
    };
  }

  _advanceQueue() {
    if (this._autoAdvanceTimer) {
      clearTimeout(this._autoAdvanceTimer);
      this._autoAdvanceTimer = null;
    }

    if (this.currentTrack) {
      this.history.unshift({ ...this.currentTrack, endedAt: Date.now() });
      if (this.history.length > 15) this.history.pop();
    }

    this.currentTrack = this.queue.shift() || null;
    if (this.currentTrack) {
      this.currentTrack.startedAt = Date.now();
    }
    this.saveConfig();
    this._broadcastState();
  }

  skipTrack(byUser = 'Streamer') {
    if (this.config.mode === 'spotify' && this.config.accessToken) {
      this._httpsRequest('https://api.spotify.com/v1/me/player/next', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.config.accessToken}`, 'Content-Length': 0 }
      }).catch(() => {});
    }
    const skipped = this.currentTrack;
    this._advanceQueue();
    return { ok: true, skipped, nowPlaying: this.currentTrack, byUser };
  }

  revokeLastByUser(user) {
    const cleanUser = String(user || '').trim();
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].requestedBy === cleanUser) {
        const [removed] = this.queue.splice(i, 1);
        this.saveConfig();
        this._broadcastState();
        return { ok: true, removed };
      }
    }
    return { ok: false, error: 'Kamu tidak memiliki lagu di dalam antrean.' };
  }

  removeTrack(trackId) {
    const idx = this.queue.findIndex(t => t.id === trackId);
    if (idx === -1) return { ok: false };
    const [removed] = this.queue.splice(idx, 1);
    this.saveConfig();
    this._broadcastState();
    return { ok: true, removed };
  }

  clearQueue() {
    this.queue = [];
    this.currentTrack = null;
    this.saveConfig();
    this._broadcastState();
    return this.getState();
  }

  async handleChatCommand(comment, userMeta = {}, { pointsManager = null, replyFn = null } = {}) {
    if (!this.config.enabled || !comment) return { handled: false };
    const text = String(comment).trim();
    const lower = text.toLowerCase();
    const user = userMeta.uniqueId || userMeta.user || 'Penonton';
    const nick = userMeta.nickname || user;
    const reply = (msg) => {
      if (typeof replyFn === 'function') {
        try { replyFn(msg); } catch {}
      }
    };

    const playCmd = (this.config.commandPlay || '!play').toLowerCase();
    if (lower.startsWith(playCmd + ' ') || lower.startsWith('!sr ')) {
      const query = lower.startsWith('!sr ') ? text.slice(4).trim() : text.slice(playCmd.length).trim();
      const res = await this.requestSong(query, userMeta, { pointsManager });
      if (res.ok) {
        const posMsg = res.position === 0 ? 'sekarang diputar!' : `masuk antrean #${res.position}.`;
        reply(`🎵 @${nick} Request "${res.track.title} - ${res.track.artist}" ${posMsg}`);
      } else {
        reply(`⚠️ @${nick} ${res.error}`);
      }
      return { handled: true, command: 'play', result: res };
    }

    const revokeCmd = (this.config.commandRevoke || '!revoke').toLowerCase();
    if (lower === revokeCmd || lower === '!wrongsong') {
      const res = this.revokeLastByUser(user);
      if (res.ok) {
        reply(`🗑️ @${nick} Lagu "${res.removed.title}" berhasil dihapus dari antrean.`);
      } else {
        reply(`⚠️ @${nick} ${res.error}`);
      }
      return { handled: true, command: 'revoke', result: res };
    }

    const skipCmd = (this.config.commandSkip || '!skip').toLowerCase();
    if (lower === skipCmd) {
      if (!userMeta.isModerator && !userMeta.isAdmin) {
        reply(`⚠️ @${nick} Hanya Moderator/Streamer yang bisa skip lagu.`);
        return { handled: true, command: 'skip', result: { ok: false, error: 'Moderator only' } };
      }
      const res = this.skipTrack(user);
      reply(`⏭️ Lagu di-skip oleh @${nick}.${res.nowPlaying ? ` Sekarang: ${res.nowPlaying.title}` : ''}`);
      return { handled: true, command: 'skip', result: res };
    }

    const songCmd = (this.config.commandCurrent || '!song').toLowerCase();
    if (lower === songCmd || lower === '!np') {
      if (this.currentTrack) {
        reply(`🎶 Sedang diputar: "${this.currentTrack.title} - ${this.currentTrack.artist}" (req: @${this.currentTrack.requestedByName || this.currentTrack.requestedBy})`);
      } else {
        reply(`🎶 Belum ada lagu yang sedang diputar. Ketik ${this.config.commandPlay} <judul lagu>!`);
      }
      return { handled: true, command: 'song', result: { ok: true, currentTrack: this.currentTrack } };
    }

    return { handled: false };
  }

  _broadcastState() {
    this.broadcast({
      type: 'spotify_update',
      state: this.getState()
    });
  }
}

module.exports = SpotifyDriver;

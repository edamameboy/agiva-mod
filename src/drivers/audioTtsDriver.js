const fs = require('fs');
const path = require('path');
const https = require('https');
const paths = require('../paths');

const SOUNDS_DIR = paths.SOUNDS_DIR;
const TTS_CONFIG_PATH = paths.TTS_CONFIG_PATH;

const DEFAULT_CONFIG = {
  tts: {
    enabled: true,
    chatMode: 'command', // 'off' | 'command' | 'all'
    chatCommand: '!tts',
    allowedRole: 'everyone', // 'everyone' | 'follower' | 'subscriber' | 'moderator' | 'min_gifter' | 'specific_users'
    allowedUsers: '', // comma-separated usernames for 'specific_users'
    minGifterLevel: 1,
    voicePreset: 'id-ID-Standard', // 'id-ID-Standard' | 'id-ID-Fast' | 'id-ID-Deep' | 'id-ID-Chipmunk' | 'en-US' | 'ja-JP'
    volume: 0.9,
    rate: 1.0,
    pitch: 1.0,
    maxLength: 140,
    cooldownSec: 3,
    readGifts: true,
    minGiftCoinsForTts: 5,
    giftTemplate: '{nickname} mengirim {repeatcount} {giftname}!',
    readDonations: true,
    donationTemplate: '{nickname} donasi {amount} rupiah. {comment}',
    readFollows: false,
    followTemplate: 'Terima kasih {nickname} sudah follow!',
    badwords: ['anjing', 'babi', 'bangsat', 'kontol', 'memek', 'tolol', 'goblok', 'jancok', 'asu']
  },
  soundboard: {
    volume: 0.85,
    overlap: false, // false = queue sounds, true = overlap
    items: [
      { id: 'horn_basuri', name: '🎺 Klakson Telolet', file: '/sounds/horn_basuri.wav', icon: '🎺', color: '#f59e0b', hotkey: 'Alt+5' },
      { id: 'siren_police', name: '🚨 Sirene Polisi', file: '/sounds/siren_police.wav', icon: '🚨', color: '#ef4444', hotkey: 'Alt+6' },
      { id: 'coin_jackpot', name: '🪙 Koin Jackpot', file: '/sounds/coin_jackpot.wav', icon: '🪙', color: '#22c55e', hotkey: 'Alt+7' },
      { id: 'explosion_boom', name: '💥 Ledakan Boom', file: '/sounds/explosion_boom.wav', icon: '💥', color: '#f97316', hotkey: 'Alt+8' },
      { id: 'jump_boing', name: '🦘 Lompat Boing', file: '/sounds/jump_boing.wav', icon: '🦘', color: '#38bdf8', hotkey: '' },
      { id: 'alert_danger', name: '⚠️ Danger Alarm', file: '/sounds/alert_danger.wav', icon: '⚠️', color: '#eab308', hotkey: '' },
      { id: 'victory_fanfare', name: '🏆 Victory Fanfare', file: '/sounds/victory_fanfare.wav', icon: '🏆', color: '#a855f7', hotkey: '' },
      { id: 'laser_zap', name: '⚡ Laser Zap', file: '/sounds/laser_zap.wav', icon: '⚡', color: '#ec4899', hotkey: '' }
    ]
  }
};

/**
 * Generate a simple 16-bit PCM mono WAV buffer for built-in sound effects
 * so the soundboard works out-of-the-box without external binary assets.
 */
function generateWavBuffer(durationSec, sampleFn) {
  const sampleRate = 22050;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);

  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20);  // PCM format
  buf.writeUInt16LE(1, 22);  // Mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const raw = Math.max(-1, Math.min(1, sampleFn(t, durationSec)));
    const val = Math.floor(raw * 32767);
    buf.writeInt16LE(val, 44 + i * 2);
  }
  return buf;
}

function ensureBuiltInSounds() {
  if (!fs.existsSync(SOUNDS_DIR)) {
    fs.mkdirSync(SOUNDS_DIR, { recursive: true });
  }

  const generators = {
    'horn_basuri.wav': () => generateWavBuffer(1.2, (t) => {
      const notes = [523.25, 659.25, 783.99, 659.25, 880.0, 783.99];
      const idx = Math.min(notes.length - 1, Math.floor(t / 0.2));
      const f = notes[idx];
      const env = Math.sin(Math.PI * ((t % 0.2) / 0.2));
      return 0.6 * env * (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t));
    }),
    'siren_police.wav': () => generateWavBuffer(1.4, (t) => {
      const f = 650 + 300 * Math.sin(2 * Math.PI * 2.5 * t);
      return 0.55 * Math.sin(2 * Math.PI * f * t);
    }),
    'coin_jackpot.wav': () => generateWavBuffer(0.7, (t) => {
      const f = t < 0.12 ? 987.77 : 1318.51;
      const env = Math.exp(-3.5 * (t < 0.12 ? t : t - 0.12));
      return 0.65 * env * Math.sin(2 * Math.PI * f * t);
    }),
    'explosion_boom.wav': () => generateWavBuffer(1.1, (t) => {
      const noise = (Math.random() * 2 - 1);
      const sub = Math.sin(2 * Math.PI * (110 * Math.exp(-3 * t)) * t);
      const env = Math.exp(-3.2 * t);
      return 0.8 * env * (0.65 * noise + 0.35 * sub);
    }),
    'jump_boing.wav': () => generateWavBuffer(0.55, (t) => {
      const f = 180 + 620 * (t / 0.55);
      const env = 1 - (t / 0.55);
      return 0.6 * env * Math.sin(2 * Math.PI * f * t);
    }),
    'alert_danger.wav': () => generateWavBuffer(0.9, (t) => {
      const pulse = (t % 0.22) < 0.14 ? 1 : 0;
      return 0.6 * pulse * (Math.sin(2 * Math.PI * 880 * t) + 0.4 * Math.sin(2 * Math.PI * 440 * t));
    }),
    'victory_fanfare.wav': () => generateWavBuffer(1.2, (t) => {
      const notes = [523.25, 523.25, 523.25, 659.25, 783.99, 1046.5];
      const idx = Math.min(notes.length - 1, Math.floor(t / 0.2));
      const env = Math.exp(-1.5 * (t % 0.2));
      return 0.6 * env * Math.sin(2 * Math.PI * notes[idx] * t);
    }),
    'laser_zap.wav': () => generateWavBuffer(0.45, (t) => {
      const f = 1400 * Math.exp(-6 * t) + 120;
      const env = 1 - (t / 0.45);
      return 0.65 * env * Math.sin(2 * Math.PI * f * t);
    })
  };

  for (const [filename, gen] of Object.entries(generators)) {
    const fullPath = path.join(SOUNDS_DIR, filename);
    if (!fs.existsSync(fullPath)) {
      try {
        fs.writeFileSync(fullPath, gen());
      } catch (e) {
        console.error('[AudioTTS] Failed to create built-in sound:', filename, e.message);
      }
    }
  }
}

class AudioTtsDriver {
  constructor(broadcastFn) {
    this.broadcast = broadcastFn || (() => {});
    this.config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    this.userLastTtsAt = new Map();
    ensureBuiltInSounds();
    this.loadConfig();
  }

  loadConfig() {
    try {
      const dir = path.dirname(TTS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(TTS_CONFIG_PATH)) {
        const saved = JSON.parse(fs.readFileSync(TTS_CONFIG_PATH, 'utf8'));
        this.config = {
          tts: { ...DEFAULT_CONFIG.tts, ...(saved.tts || {}) },
          soundboard: {
            ...DEFAULT_CONFIG.soundboard,
            ...(saved.soundboard || {}),
            items: Array.isArray(saved.soundboard?.items) && saved.soundboard.items.length > 0
              ? saved.soundboard.items
              : DEFAULT_CONFIG.soundboard.items
          }
        };
      } else {
        this.saveConfig();
      }
    } catch (e) {
      console.error('[AudioTTS] Failed to load config:', e.message);
    }
  }

  saveConfig(nextConfig) {
    if (nextConfig) {
      if (nextConfig.tts) this.config.tts = { ...this.config.tts, ...nextConfig.tts };
      if (nextConfig.soundboard) {
        this.config.soundboard = {
          ...this.config.soundboard,
          ...nextConfig.soundboard,
          items: Array.isArray(nextConfig.soundboard.items)
            ? nextConfig.soundboard.items
            : this.config.soundboard.items
        };
      }
    }
    try {
      const dir = path.dirname(TTS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(TTS_CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf8');
    } catch (e) {
      console.error('[AudioTTS] Failed to save config:', e.message);
    }
    return this.config;
  }

  getConfig() {
    return this.config;
  }

  /**
   * Check whether a viewer passes the configured role / specific_users filter
   */
  checkRoleAllowed(userMeta = {}, role = 'everyone', allowedUsersStr = '', minGifterLevel = 1) {
    if (!role || role === 'everyone') return true;
    const uid = String(userMeta.uniqueId || userMeta.user || '').toLowerCase().replace(/^@/, '');

    if (role === 'specific_users') {
      const list = String(allowedUsersStr || '')
        .split(',')
        .map(s => s.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean);
      if (list.length === 0) return true;
      return list.includes(uid);
    }
    if (role === 'follower') {
      return Boolean(userMeta.isFollower || Number(userMeta.followRole) >= 1 || userMeta.isAdmin || userMeta.isSubscribe);
    }
    if (role === 'subscriber') {
      return Boolean(userMeta.isSubscribe || userMeta.isSuperFan || userMeta.isAdmin);
    }
    if (role === 'moderator') {
      return Boolean(userMeta.isModerator || userMeta.isAdmin);
    }
    if (role === 'min_gifter') {
      return Number(userMeta.gifterLevel || 0) >= Number(minGifterLevel || 1);
    }
    return true;
  }

  sanitizeText(text) {
    if (!text) return '';
    let clean = String(text)
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/(.)\1{5,}/g, '$1$1$1') // compress repeated characters like "wwwwwwww"
      .trim();

    const badwords = this.config.tts.badwords || [];
    for (const word of badwords) {
      const w = String(word || '').trim();
      if (!w) continue;
      const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      clean = clean.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), 'bip');
    }

    const maxLen = Number(this.config.tts.maxLength) || 140;
    if (clean.length > maxLen) {
      clean = clean.slice(0, maxLen);
    }
    return clean;
  }

  formatTemplate(template, vars = {}) {
    if (!template) return '';
    return String(template)
      .replace(/\{nickname\}/gi, vars.nickname || vars.user || 'Penonton')
      .replace(/\{user\}/gi, vars.user || vars.nickname || 'Penonton')
      .replace(/\{giftname\}/gi, vars.giftName || 'Gift')
      .replace(/\{coins\}/gi, String(vars.coins ?? ''))
      .replace(/\{repeatcount\}/gi, String(vars.repeatCount ?? 1))
      .replace(/\{comment\}/gi, vars.comment || '')
      .replace(/\{amount\}/gi, vars.amount ? Number(vars.amount).toLocaleString('id-ID') : '0');
  }

  getVoiceParams(preset) {
    const p = preset || this.config.tts.voicePreset || 'id-ID-Standard';
    switch (p) {
      case 'id-ID-Fast':
        return { lang: 'id', rate: 1.25, pitch: 1.05 };
      case 'id-ID-Deep':
        return { lang: 'id', rate: 0.92, pitch: 0.72 };
      case 'id-ID-Chipmunk':
        return { lang: 'id', rate: 1.18, pitch: 1.45 };
      case 'en-US':
        return { lang: 'en', rate: 1.0, pitch: 1.0 };
      case 'ja-JP':
        return { lang: 'ja', rate: 1.0, pitch: 1.05 };
      default:
        return {
          lang: 'id',
          rate: Number(this.config.tts.rate) || 1.0,
          pitch: Number(this.config.tts.pitch) || 1.0
        };
    }
  }

  /**
   * Dispatch a TTS utterance to dashboard & overlay clients
   */
  speak(rawText, options = {}, masterTtsEnabled = true) {
    if (!masterTtsEnabled || !this.config.tts.enabled) return false;
    const text = this.sanitizeText(rawText);
    if (!text || text.length < 2) return false;

    const vp = this.getVoiceParams(options.voicePreset);
    const payload = {
      type: 'tts_speak',
      id: `tts_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text,
      lang: options.lang || vp.lang,
      rate: options.rate || vp.rate,
      pitch: options.pitch || vp.pitch,
      volume: options.volume ?? this.config.tts.volume ?? 0.9,
      user: options.user || '',
      audioUrl: `/api/tts/stream?lang=${encodeURIComponent(options.lang || vp.lang)}&text=${encodeURIComponent(text)}`
    };
    this.broadcast(payload);
    return payload;
  }

  /**
   * Evaluate incoming chat message for automatic or !tts command reading
   */
  handleChatTts(chatData, masterTtsEnabled = true) {
    if (!masterTtsEnabled || !this.config.tts.enabled) return false;
    const mode = this.config.tts.chatMode || 'command';
    if (mode === 'off') return false;

    const rawComment = String(chatData.comment || '').trim();
    if (!rawComment) return false;

    let textToRead = '';
    const cmdPrefix = String(this.config.tts.chatCommand || '!tts').toLowerCase();

    if (mode === 'command') {
      if (!rawComment.toLowerCase().startsWith(cmdPrefix)) return false;
      textToRead = rawComment.slice(cmdPrefix.length).trim();
    } else if (mode === 'all') {
      if (rawComment.startsWith('!')) return false; // ignore other bot commands
      textToRead = rawComment;
    }

    if (!textToRead) return false;

    // Check role / specific_users permission
    const allowed = this.checkRoleAllowed(
      chatData,
      this.config.tts.allowedRole,
      this.config.tts.allowedUsers,
      this.config.tts.minGifterLevel
    );
    if (!allowed) return false;

    // Per-user TTS cooldown
    const uid = String(chatData.user || chatData.uniqueId || 'anon').toLowerCase();
    const cdMs = (Number(this.config.tts.cooldownSec) || 0) * 1000;
    const now = Date.now();
    if (cdMs > 0 && this.userLastTtsAt.has(uid)) {
      if (now - this.userLastTtsAt.get(uid) < cdMs) return false;
    }
    this.userLastTtsAt.set(uid, now);

    const spokenText = `${chatData.nickname || chatData.user || 'Penonton'} bilang: ${textToRead}`;
    return this.speak(spokenText, { user: uid }, masterTtsEnabled);
  }

  /**
   * Play a soundboard item across overlay & dashboard
   */
  playSound(soundIdOrFile, options = {}, masterTtsEnabled = true) {
    if (!masterTtsEnabled) return null;
    let item = this.config.soundboard.items.find(i => i.id === soundIdOrFile || i.file === soundIdOrFile);
    const fileUrl = item ? item.file : (String(soundIdOrFile).startsWith('/') ? soundIdOrFile : `/sounds/${soundIdOrFile}`);
    const payload = {
      type: 'sound_play',
      id: `snd_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      soundId: item?.id || soundIdOrFile,
      name: item?.name || soundIdOrFile,
      file: fileUrl,
      volume: options.volume ?? this.config.soundboard.volume ?? 0.85,
      overlap: options.overlap ?? this.config.soundboard.overlap ?? false,
      screen: Number(options.screen) || 1
    };
    this.broadcast(payload);
    return payload;
  }

  stopAllAudio() {
    this.broadcast({ type: 'audio_stop_all' });
  }

  /**
   * Save an uploaded audio file (base64 data URI) into public/sounds/
   */
  uploadSound({ name, icon = '🔊', color = '#6366f1', hotkey = '', filename, dataBase64 }) {
    if (!filename || !dataBase64) throw new Error('filename dan dataBase64 diperlukan');
    const ext = path.extname(filename).toLowerCase();
    if (!['.mp3', '.wav', '.ogg', '.webm'].includes(ext)) {
      throw new Error('Format audio harus .mp3, .wav, .ogg, atau .webm');
    }
    const safeBase = path.basename(filename, ext).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || `sound_${Date.now()}`;
    const finalName = `${safeBase}_${Date.now().toString(36)}${ext}`;
    const fullPath = path.join(SOUNDS_DIR, finalName);

    const rawBase64 = String(dataBase64).replace(/^data:[^;]+;base64,/, '');
    const buf = Buffer.from(rawBase64, 'base64');
    if (buf.length > 8 * 1024 * 1024) {
      throw new Error('Ukuran file suara maksimal 8 MB');
    }
    fs.writeFileSync(fullPath, buf);

    const newItem = {
      id: safeBase + '_' + Date.now().toString(36),
      name: name || safeBase,
      file: `/sounds/${finalName}`,
      icon: icon || '🔊',
      color: color || '#6366f1',
      hotkey: hotkey || ''
    };
    this.config.soundboard.items.push(newItem);
    this.saveConfig();
    return newItem;
  }

  deleteSound(id) {
    const idx = this.config.soundboard.items.findIndex(i => i.id === id);
    if (idx === -1) return false;
    this.config.soundboard.items.splice(idx, 1);
    this.saveConfig();
    return true;
  }

  /**
   * Stream free Google Translate TTS MP3 audio so OBS Browser Source & Electron can play Indonesian speech reliably
   */
  streamGoogleTts(text, lang = 'id', res) {
    const clean = String(text || '').slice(0, 200).trim();
    if (!clean) {
      res.status(400).end();
      return;
    }
    const url = `https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang || 'id')}&q=${encodeURIComponent(clean)}`;
    https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36'
      }
    }, (upRes) => {
      if (upRes.statusCode !== 200) {
        res.status(upRes.statusCode || 502).end();
        return;
      }
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      upRes.pipe(res);
    }).on('error', () => {
      if (!res.headersSent) res.status(502).end();
    });
  }
}

module.exports = AudioTtsDriver;

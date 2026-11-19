// src/points/pointsManager.js — Loyalty Points, Levels & Viewer Economy Engine
'use strict';

const fs = require('fs');
const path = require('path');
const paths = require('../paths');

const POINTS_CONFIG_PATH = paths.POINTS_CONFIG_PATH;

const DEFAULT_POINTS_CONFIG = {
  enabled: true,
  currencyName: 'Agiva Points',
  currencySymbol: '⭐',
  pointsPerCoin: 10,
  pointsPer100Likes: 5,
  pointsPerFollow: 25,
  pointsPerShare: 15,
  pointsPerSub: 200,
  pointsPerChat: 2,
  chatCooldownSec: 60,
  pointsPer10kIdr: 100,
  subBonusPercent: 50,
  levelBaseXp: 100,
  levelExponent: 1.5,
  spinCostPoints: 50,
  ttsCostPoints: 0,
  gambleEnabled: true,
  gambleMin: 10,
  gambleMax: 10000,
  dropEnabled: true,
  dropKeyword: '!get',
  dropAmount: 50,
  dropDurationSec: 30,
  dropMaxWinners: 5
};

class PointsManager {
  constructor({ broadcastFn } = {}) {
    this.broadcast = broadcastFn || (() => {});
    this.config = { ...DEFAULT_POINTS_CONFIG };
    this.users = {};
    this.transactions = [];
    this.challenge = { active: false, startedAt: 0, snapshot: {} };
    this.activeDrop = { active: false, id: '', keyword: '!get', amount: 50, maxWinners: 5, winners: [], endsAt: 0 };
    this.likeAccumulator = 0;
    this._dropTimer = null;
    this._saveTimer = null;
    this._dirty = false;
    this._isWriting = false;

    this.load();
  }

  _normalizeKey(username) {
    return String(username || '').trim().toLowerCase().replace(/^@/, '');
  }

  calcLevel(xp = 0) {
    const base = Math.max(10, Number(this.config.levelBaseXp) || 100);
    const exp = Math.max(1.0, Math.min(3.0, Number(this.config.levelExponent) || 1.5));
    const safeXp = Math.max(0, Number(xp) || 0);
    let level = 1;
    while (level < 500 && safeXp >= base * Math.pow(level, exp)) {
      level++;
    }
    return level;
  }

  load() {
    try {
      const dir = path.dirname(POINTS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(POINTS_CONFIG_PATH)) {
        const saved = JSON.parse(fs.readFileSync(POINTS_CONFIG_PATH, 'utf8'));
        this.config = { ...DEFAULT_POINTS_CONFIG, ...(saved.config || {}) };
        this.users = saved.users && typeof saved.users === 'object' ? saved.users : {};
        this.transactions = Array.isArray(saved.transactions) ? saved.transactions.slice(0, 300) : [];
        if (saved.challenge && typeof saved.challenge === 'object') {
          this.challenge = {
            active: Boolean(saved.challenge.active),
            startedAt: Number(saved.challenge.startedAt) || 0,
            snapshot: saved.challenge.snapshot && typeof saved.challenge.snapshot === 'object' ? saved.challenge.snapshot : {}
          };
        }
      } else {
        this.flushSaveSync(true);
      }
    } catch (e) {
      console.error('[Points] Failed to load database:', e.message);
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
      const dir = path.dirname(POINTS_CONFIG_PATH);
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = `${POINTS_CONFIG_PATH}.tmp`;
      const payload = {
        config: this.config,
        users: this.users,
        transactions: this.transactions.slice(0, 300),
        challenge: this.challenge
      };
      await fs.promises.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
      await fs.promises.rename(tmp, POINTS_CONFIG_PATH);
    } catch (e) {
      console.error('[Points] Async save failed:', e.message);
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
      const dir = path.dirname(POINTS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${POINTS_CONFIG_PATH}.tmp`;
      const payload = {
        config: this.config,
        users: this.users,
        transactions: this.transactions.slice(0, 300),
        challenge: this.challenge
      };
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmp, POINTS_CONFIG_PATH);
    } catch (e) {
      console.error('[Points] Sync save failed:', e.message);
    }
  }

  getUser(username, nickname = '') {
    const key = this._normalizeKey(username);
    if (!key) return null;
    if (!this.users[key]) {
      this.users[key] = {
        user: String(username).replace(/^@/, ''),
        nickname: nickname || String(username).replace(/^@/, ''),
        points: 0,
        xp: 0,
        level: 1,
        totalEarned: 0,
        totalSpent: 0,
        coins: 0,
        likes: 0,
        chats: 0,
        isSub: false,
        lastSeen: Date.now(),
        lastChatRewardAt: 0
      };
    } else {
      if (nickname) this.users[key].nickname = nickname;
      this.users[key].lastSeen = Date.now();
    }
    return this.users[key];
  }

  _recordTx(user, delta, balance, type = 'earn', reason = '') {
    this.transactions.unshift({
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      time: Date.now(),
      user,
      delta,
      balance,
      type,
      reason
    });
    if (this.transactions.length > 300) {
      this.transactions.length = 300;
    }
  }

  _broadcastState() {
    this.broadcast({
      type: 'points_update',
      state: this.getState()
    });
  }

  getLeaderboard(limit = 25) {
    return Object.values(this.users)
      .sort((a, b) => (b.points - a.points) || (b.xp - a.xp))
      .slice(0, limit);
  }

  getTransactions(limit = 40) {
    return this.transactions.slice(0, limit);
  }

  getState() {
    return {
      config: { ...this.config },
      totalUsers: Object.keys(this.users).length,
      leaderboard: this.getLeaderboard(25),
      transactions: this.getTransactions(40),
      challenge: {
        active: Boolean(this.challenge.active),
        startedAt: Number(this.challenge.startedAt) || 0
      },
      activeDrop: { ...this.activeDrop }
    };
  }

  updateConfig(updates = {}) {
    const numKeys = [
      'pointsPerCoin', 'pointsPer100Likes', 'pointsPerFollow', 'pointsPerShare',
      'pointsPerSub', 'pointsPerChat', 'chatCooldownSec', 'pointsPer10kIdr',
      'subBonusPercent', 'levelBaseXp', 'levelExponent', 'spinCostPoints',
      'ttsCostPoints', 'gambleMin', 'gambleMax', 'dropAmount', 'dropDurationSec', 'dropMaxWinners'
    ];
    for (const k of numKeys) {
      if (updates[k] !== undefined) {
        this.config[k] = Math.max(0, Number(updates[k]) || 0);
      }
    }
    if (updates.enabled !== undefined) this.config.enabled = Boolean(updates.enabled);
    if (updates.gambleEnabled !== undefined) this.config.gambleEnabled = Boolean(updates.gambleEnabled);
    if (updates.dropEnabled !== undefined) this.config.dropEnabled = Boolean(updates.dropEnabled);
    if (updates.currencyName !== undefined) this.config.currencyName = String(updates.currencyName).trim() || 'Agiva Points';
    if (updates.currencySymbol !== undefined) this.config.currencySymbol = String(updates.currencySymbol).trim() || '⭐';
    if (updates.dropKeyword !== undefined) this.config.dropKeyword = String(updates.dropKeyword).trim() || '!get';

    // Recompute levels if XP curve changed
    for (const u of Object.values(this.users)) {
      u.level = this.calcLevel(u.xp);
    }

    this.scheduleSave();
    this._broadcastState();
    return this.getState();
  }

  addPoints(username, baseAmount, reason = 'activity', opts = {}) {
    if (opts.respectEnabled !== false && !this.config.enabled) return null;
    const base = Math.floor(Number(baseAmount) || 0);
    if (base <= 0) return null;
    const u = this.getUser(username, opts.nickname);
    if (!u) return null;
    if (opts.isSub) u.isSub = true;

    let finalAmount = base;
    if (opts.applySubBonus !== false && u.isSub && (Number(this.config.subBonusPercent) || 0) > 0) {
      finalAmount += Math.round(base * (Number(this.config.subBonusPercent) / 100));
    }

    const oldLevel = u.level || 1;
    const xpGain = opts.xpGain !== undefined ? Math.max(0, Number(opts.xpGain) || 0) : finalAmount;
    u.points = Math.max(0, (u.points || 0) + finalAmount);
    u.totalEarned = (u.totalEarned || 0) + finalAmount;
    u.xp = (u.xp || 0) + xpGain;
    u.level = this.calcLevel(u.xp);

    this._recordTx(u.user, finalAmount, u.points, opts.type || 'earn', reason);
    this.scheduleSave();
    this._broadcastState();

    return {
      user: u.user,
      added: finalAmount,
      balance: u.points,
      level: u.level,
      leveledUp: u.level > oldLevel
    };
  }

  spendPoints(username, amount, reason = 'spend', opts = {}) {
    const cost = Math.floor(Number(amount) || 0);
    const u = this.getUser(username, opts.nickname);
    if (!u) return { ok: false, balance: 0, error: 'User tidak valid' };
    if (cost <= 0) return { ok: true, balance: u.points, spent: 0 };
    if (u.points < cost) {
      return { ok: false, balance: u.points, error: `${this.config.currencyName} tidak cukup (butuh ${cost}, punya ${u.points})` };
    }
    u.points -= cost;
    u.totalSpent = (u.totalSpent || 0) + cost;
    this._recordTx(u.user, -cost, u.points, opts.type || 'spend', reason);
    this.scheduleSave();
    this._broadcastState();
    return { ok: true, balance: u.points, spent: cost };
  }

  adjustPoints(username, delta, reason = 'admin_adjust') {
    const d = Math.trunc(Number(delta) || 0);
    const u = this.getUser(username);
    if (!u || d === 0) return null;
    const prev = u.points;
    u.points = Math.max(0, u.points + d);
    const actualDelta = u.points - prev;
    if (actualDelta > 0) {
      u.totalEarned = (u.totalEarned || 0) + actualDelta;
      u.xp = (u.xp || 0) + actualDelta;
      u.level = this.calcLevel(u.xp);
    } else if (actualDelta < 0) {
      u.totalSpent = (u.totalSpent || 0) + Math.abs(actualDelta);
    }
    this._recordTx(u.user, actualDelta, u.points, 'adjust', reason);
    this.scheduleSave();
    this._broadcastState();
    return u;
  }

  // ─── Event Hooks ──────────────────────────────────────────────────────────
  onGift({ user, nickname, coins = 1, isSub = false }) {
    const u = this.getUser(user, nickname);
    if (!u) return;
    const c = Math.max(1, Number(coins) || 1);
    u.coins = (u.coins || 0) + c;
    if (isSub) u.isSub = true;
    if (!this.config.enabled || this.config.pointsPerCoin <= 0) {
      this.scheduleSave();
      return;
    }
    this.addPoints(user, Math.round(c * this.config.pointsPerCoin), `gift_${c}_coins`, { nickname, isSub, type: 'gift' });
  }

  onLike({ user, nickname, count = 1, isSub = false }) {
    const u = this.getUser(user, nickname);
    if (!u) return;
    const c = Math.max(1, Number(count) || 1);
    u.likes = (u.likes || 0) + c;
    if (isSub) u.isSub = true;
    if (!this.config.enabled || this.config.pointsPer100Likes <= 0) {
      this.scheduleSave();
      return;
    }
    this.likeAccumulator += c;
    let batches = 0;
    while (this.likeAccumulator >= 100) {
      this.likeAccumulator -= 100;
      batches++;
    }
    if (batches > 0) {
      this.addPoints(user, batches * this.config.pointsPer100Likes, `likes_x${batches * 100}`, { nickname, isSub, type: 'like' });
    } else {
      this.scheduleSave();
    }
  }

  onFollow({ user, nickname, isSub = false }) {
    if (!this.config.enabled || this.config.pointsPerFollow <= 0) return;
    this.addPoints(user, this.config.pointsPerFollow, 'follow', { nickname, isSub, type: 'follow' });
  }

  onShare({ user, nickname, isSub = false }) {
    if (!this.config.enabled || this.config.pointsPerShare <= 0) return;
    this.addPoints(user, this.config.pointsPerShare, 'share', { nickname, isSub, type: 'share' });
  }

  onSubscribe({ user, nickname }) {
    const u = this.getUser(user, nickname);
    if (u) u.isSub = true;
    if (!this.config.enabled || this.config.pointsPerSub <= 0) {
      this.scheduleSave();
      return;
    }
    this.addPoints(user, this.config.pointsPerSub, 'subscribe', { nickname, isSub: true, type: 'subscribe' });
  }

  onDonation({ user, nickname, amount = 0 }) {
    if (!this.config.enabled || this.config.pointsPer10kIdr <= 0) return;
    const amt = Number(amount) || 0;
    const pts = Math.floor((amt / 10000) * this.config.pointsPer10kIdr);
    if (pts > 0) {
      this.addPoints(user, pts, `donation_rp_${amt}`, { nickname, type: 'donation' });
    }
  }

  onChat({ user, nickname, isSub = false }) {
    const u = this.getUser(user, nickname);
    if (!u) return;
    u.chats = (u.chats || 0) + 1;
    if (isSub) u.isSub = true;
    if (!this.config.enabled || this.config.pointsPerChat <= 0) {
      this.scheduleSave();
      return;
    }
    const now = Date.now();
    const cdMs = Math.max(0, Number(this.config.chatCooldownSec) || 60) * 1000;
    if (now - (u.lastChatRewardAt || 0) >= cdMs) {
      u.lastChatRewardAt = now;
      this.addPoints(user, this.config.pointsPerChat, 'active_chat', { nickname, isSub, type: 'chat' });
    }
  }

  // ─── Loyalty Tools: Drop, Challenge, Halving ──────────────────────────────
  startDrop(opts = {}) {
    if (this._dropTimer) {
      clearTimeout(this._dropTimer);
      this._dropTimer = null;
    }
    const durSec = Math.max(5, Math.min(300, Number(opts.durationSec ?? this.config.dropDurationSec) || 30));
    this.activeDrop = {
      active: true,
      id: `drop_${Date.now()}`,
      keyword: String(opts.keyword || this.config.dropKeyword || '!get').trim() || '!get',
      amount: Math.max(1, Number(opts.amount ?? this.config.dropAmount) || 50),
      maxWinners: Math.max(1, Number(opts.maxWinners ?? this.config.dropMaxWinners) || 5),
      winners: [],
      endsAt: Date.now() + durSec * 1000
    };
    this.broadcast({ type: 'points_drop', drop: { ...this.activeDrop } });
    this._broadcastState();

    this._dropTimer = setTimeout(() => {
      this.endDrop();
    }, durSec * 1000);
    return { ...this.activeDrop };
  }

  endDrop() {
    if (this._dropTimer) {
      clearTimeout(this._dropTimer);
      this._dropTimer = null;
    }
    this.activeDrop.active = false;
    this.broadcast({ type: 'points_drop', drop: { ...this.activeDrop } });
    this._broadcastState();
    return { ...this.activeDrop };
  }

  claimDrop(username, nickname = '') {
    if (!this.activeDrop.active) return { claimed: false, reason: 'inactive' };
    if (Date.now() > this.activeDrop.endsAt) {
      this.endDrop();
      return { claimed: false, reason: 'expired' };
    }
    const key = this._normalizeKey(username);
    if (!key) return { claimed: false, reason: 'invalid_user' };
    if (this.activeDrop.winners.some(w => w.key === key)) {
      return { claimed: false, reason: 'already_claimed' };
    }
    if (this.activeDrop.winners.length >= this.activeDrop.maxWinners) {
      this.endDrop();
      return { claimed: false, reason: 'full' };
    }

    const displayUser = nickname || String(username).replace(/^@/, '');
    this.activeDrop.winners.push({ key, user: displayUser, time: Date.now() });
    this.addPoints(username, this.activeDrop.amount, 'points_drop', {
      nickname,
      applySubBonus: false,
      respectEnabled: false,
      type: 'drop'
    });

    if (this.activeDrop.winners.length >= this.activeDrop.maxWinners) {
      this.endDrop();
    } else {
      this.broadcast({ type: 'points_drop', drop: { ...this.activeDrop } });
    }
    return { claimed: true, amount: this.activeDrop.amount, remaining: Math.max(0, this.activeDrop.maxWinners - this.activeDrop.winners.length) };
  }

  startChallenge() {
    if (this.challenge.active) return this.challenge;
    const snapshot = {};
    for (const [k, u] of Object.entries(this.users)) {
      snapshot[k] = { points: u.points || 0, xp: u.xp || 0, level: u.level || 1 };
      u.points = 0;
    }
    this.challenge = { active: true, startedAt: Date.now(), snapshot };
    this._recordTx('SYSTEM', 0, 0, 'challenge', 'Challenge Mode dimulai (Poin direset sementara)');
    this.scheduleSave();
    this._broadcastState();
    return { active: true, startedAt: this.challenge.startedAt };
  }

  endChallenge(mode = 'discard') {
    if (!this.challenge.active) return { active: false };
    const snap = this.challenge.snapshot || {};
    if (mode === 'merge') {
      for (const [k, old] of Object.entries(snap)) {
        if (this.users[k]) {
          this.users[k].points = Math.max(0, (this.users[k].points || 0) + (old.points || 0));
        }
      }
      this._recordTx('SYSTEM', 0, 0, 'challenge', 'Challenge Mode selesai (Poin digabungkan)');
    } else {
      for (const u of Object.values(this.users)) {
        u.points = 0;
      }
      for (const [k, old] of Object.entries(snap)) {
        if (this.users[k]) {
          this.users[k].points = old.points || 0;
          this.users[k].xp = old.xp || 0;
          this.users[k].level = old.level || this.calcLevel(old.xp || 0);
        }
      }
      this._recordTx('SYSTEM', 0, 0, 'challenge', 'Challenge Mode dibatalkan (Poin awal dikembalikan)');
    }
    this.challenge = { active: false, startedAt: 0, snapshot: {} };
    this.scheduleSave();
    this._broadcastState();
    return { active: false, mode };
  }

  halveAllPoints(percent = 50) {
    const pct = Math.max(1, Math.min(99, Number(percent) || 50));
    const keepRatio = 1 - pct / 100;
    let affected = 0;
    for (const u of Object.values(this.users)) {
      const next = Math.floor((u.points || 0) * keepRatio);
      if (next !== u.points) {
        u.points = Math.max(0, next);
        affected++;
      }
    }
    this._recordTx('SYSTEM', 0, 0, 'halving', `Halving -${pct}% diterapkan ke ${affected} user`);
    this.scheduleSave();
    this._broadcastState();
    return { affected, percent: pct };
  }

  // ─── Viewer Economy Commands ──────────────────────────────────────────────
  handleEconomyCommand(comment, userMeta = {}, { spinWheelFn, replyFn } = {}) {
    const clean = String(comment || '').trim();
    if (!clean) return { handled: false };
    const lower = clean.toLowerCase();
    const uid = userMeta.uniqueId || userMeta.user || '';
    const nick = userMeta.nickname || uid;
    const sym = this.config.currencySymbol || '⭐';
    const reply = (msg) => {
      if (typeof replyFn === 'function' && msg) replyFn(msg);
    };

    // 1. Check active Points Drop claim first
    if (this.activeDrop.active && lower === String(this.activeDrop.keyword || '!get').toLowerCase()) {
      const claim = this.claimDrop(uid, nick);
      if (claim.claimed) {
        reply(`@${nick} berhasil klaim +${claim.amount} ${sym}!`);
        return { handled: true, command: 'drop', result: claim };
      }
      return { handled: true, command: 'drop', result: claim };
    }

    if (!this.config.enabled) return { handled: false };

    const parts = clean.split(/\s+/);
    const cmd = parts[0].toLowerCase();

    if (cmd === '!score' || cmd === '!points' || cmd === '!level') {
      const u = this.getUser(uid, nick);
      if (!u) return { handled: false };
      reply(`@${u.nickname || u.user}: ${u.points.toLocaleString('id-ID')} ${sym} | Level ${u.level} (${u.xp} XP)`);
      return { handled: true, command: 'score', user: u };
    }

    if (cmd === '!transfer' && parts.length >= 3) {
      const targetRaw = parts[1];
      const amount = Math.floor(Number(parts[2]));
      const senderKey = this._normalizeKey(uid);
      const targetKey = this._normalizeKey(targetRaw);
      if (!targetKey || targetKey === senderKey || !Number.isFinite(amount) || amount <= 0) {
        reply(`@${nick} format: !transfer @username jumlah`);
        return { handled: true, command: 'transfer', ok: false };
      }
      const spent = this.spendPoints(uid, amount, `transfer_to_${targetKey}`, { nickname: nick, type: 'transfer' });
      if (!spent.ok) {
        reply(`@${nick} ${spent.error}`);
        return { handled: true, command: 'transfer', ok: false };
      }
      this.addPoints(targetRaw, amount, `transfer_from_${senderKey}`, {
        applySubBonus: false,
        xpGain: 0,
        respectEnabled: false,
        type: 'transfer'
      });
      reply(`@${nick} mengirim ${amount} ${sym} ke @${targetKey}!`);
      return { handled: true, command: 'transfer', ok: true, amount, target: targetKey };
    }

    if (cmd === '!gamble' && this.config.gambleEnabled && parts.length >= 2) {
      const u = this.getUser(uid, nick);
      if (!u) return { handled: false };
      const rawBet = parts[1].toLowerCase();
      let bet = rawBet === 'all' ? Math.min(u.points, Number(this.config.gambleMax) || 10000) : Math.floor(Number(rawBet));
      const minBet = Math.max(1, Number(this.config.gambleMin) || 10);
      const maxBet = Math.max(minBet, Number(this.config.gambleMax) || 10000);
      if (!Number.isFinite(bet) || bet < minBet || bet > maxBet) {
        reply(`@${nick} taruhan gamble harus antara ${minBet}–${maxBet} ${sym}`);
        return { handled: true, command: 'gamble', ok: false };
      }
      if (u.points < bet) {
        reply(`@${nick} ${this.config.currencyName} tidak cukup (punya ${u.points} ${sym})`);
        return { handled: true, command: 'gamble', ok: false };
      }
      const won = Math.random() < 0.5;
      if (won) {
        const res = this.addPoints(uid, bet, 'gamble_win', {
          nickname: nick,
          applySubBonus: false,
          xpGain: Math.round(bet * 0.2),
          type: 'gamble'
        });
        reply(`🎰 @${nick} MENANG +${bet} ${sym}! Saldo: ${res?.balance ?? u.points} ${sym}`);
        return { handled: true, command: 'gamble', ok: true, won: true, balance: res?.balance ?? u.points };
      } else {
        const res = this.spendPoints(uid, bet, 'gamble_loss', { nickname: nick, type: 'gamble' });
        reply(`💸 @${nick} kalah -${bet} ${sym}. Saldo: ${res.balance} ${sym}`);
        return { handled: true, command: 'gamble', ok: true, won: false, balance: res.balance };
      }
    }

    if (cmd === '!spin') {
      const cost = Math.max(0, Number(this.config.spinCostPoints) || 0);
      if (cost > 0) {
        const spent = this.spendPoints(uid, cost, 'spin_wheel', { nickname: nick, type: 'spin' });
        if (!spent.ok) {
          reply(`@${nick} butuh ${cost} ${sym} untuk !spin (punya ${spent.balance} ${sym})`);
          return { handled: true, command: 'spin', ok: false };
        }
      }
      if (typeof spinWheelFn === 'function') spinWheelFn(nick || uid);
      reply(`🎡 @${nick} memutar Spin Wheel${cost > 0 ? ` (-${cost} ${sym})` : ''}!`);
      return { handled: true, command: 'spin', ok: true };
    }

    if (cmd === '!help' || cmd === '!commands') {
      const extra = this.activeDrop.active ? `, ${this.activeDrop.keyword}` : '';
      reply(`Command: !score, !transfer @user <jml>, !gamble <jml>${this.config.spinCostPoints >= 0 ? `, !spin (${this.config.spinCostPoints} ${sym})` : ''}${extra}`);
      return { handled: true, command: 'help' };
    }

    return { handled: false };
  }
}

module.exports = PointsManager;

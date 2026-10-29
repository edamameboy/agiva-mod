const fs = require('fs');
const path = require('path');
const paths = require('../paths');

const WIDGETS_CONFIG_PATH = paths.WIDGETS_CONFIG_PATH;

const DEFAULT_WIDGETS_STATE = {
  timer: {
    remainingSec: 3600,
    defaultSec: 3600,
    isRunning: false,
    title: '⏳ SUBATHON TIMER',
    autoAdd: {
      enabled: true,
      secPerCoin: 2,
      secPer100Likes: 5,
      secPerFollow: 10,
      secPer10kIdr: 60
    }
  },
  wheel: {
    title: '🎡 RODA GACHA STREAMER',
    autoTriggerEffect: true,
    isSpinning: false,
    lastWinner: null,
    segments: [
      { id: 'seg_1', label: '⚡ Speed Boost', color: '#6366f1', weight: 25, effectId: '' },
      { id: 'seg_2', label: '💰 Bonus Uang', color: '#22c55e', weight: 25, effectId: '' },
      { id: 'seg_3', label: '🌧️ Cuaca Buruk', color: '#38bdf8', weight: 20, effectId: '' },
      { id: 'seg_4', label: '🤡 Troll / Zonk', color: '#f59e0b', weight: 20, effectId: '' },
      { id: 'seg_5', label: '💀 JACKPOT RUSUH', color: '#ef4444', weight: 10, effectId: '' }
    ]
  },
  goals: {
    likes: { title: '❤️ Target Like', current: 0, target: 1000, autoScale: true, rewardEffectId: '' },
    coins: { title: '💎 Target Koin Gift', current: 0, target: 500, autoScale: true, rewardEffectId: '' },
    followers: { title: '👤 Target Follower Baru', current: 0, target: 50, autoScale: true, rewardEffectId: '' },
    donations: { title: '💸 Target Donasi (Rp)', current: 0, target: 100000, autoScale: true, rewardEffectId: '' }
  },
  counter: {
    title: '⚔️ REKOR TANTANGAN',
    wins: 0,
    loses: 0,
    streak: 0
  },
  poll: {
    active: false,
    question: 'Pilih Efek Game Berikutnya! (Ketik 1 / 2 / 3 di Chat)',
    endsAt: 0,
    durationSec: 45,
    winner: null,
    options: [
      { key: '1', label: 'Opsi 1: Bantu Streamer', votes: 0, effectId: '' },
      { key: '2', label: 'Opsi 2: Rusuh / Kerjai', votes: 0, effectId: '' },
      { key: '3', label: 'Opsi 3: Gacha Random', votes: 0, effectId: '' }
    ]
  },
  giveaway: {
    active: false,
    title: '🎁 UNDIAN GIVEAWAY PENONTON',
    keyword: '!ikut',
    giftTickets: true,
    coinsPerTicket: 5,
    participants: [], // [{ user, tickets }]
    winner: null
  },
  screens: {
    1: { name: 'Screen 1 (Utama / Tengah)', position: 'center', defaultDurationMs: 4000 },
    2: { name: 'Screen 2 (Pojok Kanan Atas)', position: 'top-right', defaultDurationMs: 4000 },
    3: { name: 'Screen 3 (Pojok Kiri Atas)', position: 'top-left', defaultDurationMs: 4000 },
    4: { name: 'Screen 4 (Bawah / Memes)', position: 'bottom', defaultDurationMs: 5000 },
    5: { name: 'Screen 5 (Full Screen Jumpscare)', position: 'fullscreen', defaultDurationMs: 3500 }
  }
};

class WidgetManager {
  constructor({ broadcastFn, triggerEffectFn }) {
    this.broadcast = broadcastFn || (() => {});
    this.triggerEffect = triggerEffectFn || (() => {});
    this.state = JSON.parse(JSON.stringify(DEFAULT_WIDGETS_STATE));
    this.likeSubAccumulator = 0;
    this.pollVoters = new Set();
    this.pollTimeout = null;
    this.giftersMap = new Map(); // user -> { user, coins, gifts }
    this.likersMap = new Map();  // user -> { user, likes }

    this.loadConfig();

    // 1-second tick for Subathon Timer & Poll countdown
    this.tickInterval = setInterval(() => this._onTick(), 1000);
  }

  loadConfig() {
    try {
      const dir = path.dirname(WIDGETS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(WIDGETS_CONFIG_PATH)) {
        const saved = JSON.parse(fs.readFileSync(WIDGETS_CONFIG_PATH, 'utf8'));
        this.state = {
          ...DEFAULT_WIDGETS_STATE,
          ...saved,
          timer: { ...DEFAULT_WIDGETS_STATE.timer, ...(saved.timer || {}), isRunning: false },
          wheel: { ...DEFAULT_WIDGETS_STATE.wheel, ...(saved.wheel || {}), isSpinning: false },
          goals: { ...DEFAULT_WIDGETS_STATE.goals, ...(saved.goals || {}) },
          counter: { ...DEFAULT_WIDGETS_STATE.counter, ...(saved.counter || {}) },
          poll: { ...DEFAULT_WIDGETS_STATE.poll, ...(saved.poll || {}), active: false },
          giveaway: { ...DEFAULT_WIDGETS_STATE.giveaway, ...(saved.giveaway || {}) },
          screens: { ...DEFAULT_WIDGETS_STATE.screens, ...(saved.screens || {}) }
        };
      } else {
        this.saveConfig();
      }
    } catch (e) {
      console.error('[Widgets] Failed to load config:', e.message);
    }
  }

  saveConfig() {
    try {
      const dir = path.dirname(WIDGETS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(WIDGETS_CONFIG_PATH, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (e) {
      console.error('[Widgets] Failed to save config:', e.message);
    }
  }

  getState() {
    return {
      ...this.state,
      leaderboard: this.getLeaderboard()
    };
  }

  _broadcastState(widgetKey) {
    this.broadcast({
      type: 'widgets_update',
      widget: widgetKey || 'all',
      state: this.getState()
    });
  }

  _onTick() {
    let changed = false;
    if (this.state.timer.isRunning && this.state.timer.remainingSec > 0) {
      this.state.timer.remainingSec = Math.max(0, this.state.timer.remainingSec - 1);
      if (this.state.timer.remainingSec === 0) {
        this.state.timer.isRunning = false;
      }
      changed = true;
    }
    if (this.state.poll.active && this.state.poll.endsAt > 0 && Date.now() >= this.state.poll.endsAt) {
      this.endPoll();
      return;
    }
    if (changed) {
      this.broadcast({
        type: 'timer_tick',
        remainingSec: this.state.timer.remainingSec,
        isRunning: this.state.timer.isRunning,
        title: this.state.timer.title
      });
    }
  }

  // ─── 1. Subathon Timer Controls ───────────────────────────────────────────
  controlTimer(action, value, sourceUser = '') {
    const t = this.state.timer;
    if (action === 'start') t.isRunning = true;
    else if (action === 'pause') t.isRunning = false;
    else if (action === 'toggle') t.isRunning = !t.isRunning;
    else if (action === 'reset') {
      t.isRunning = false;
      t.remainingSec = Number(t.defaultSec) || 3600;
    } else if (action === 'add') {
      const delta = Number(value) || 0;
      t.remainingSec = Math.max(0, t.remainingSec + delta);
      if (delta !== 0) {
        this.broadcast({
          type: 'timer_added',
          deltaSec: delta,
          remainingSec: t.remainingSec,
          user: sourceUser || 'Streamer'
        });
      }
    } else if (action === 'set') {
      t.remainingSec = Math.max(0, Number(value) || 0);
      t.defaultSec = t.remainingSec;
    } else if (action === 'config' && value && typeof value === 'object') {
      if (value.title !== undefined) t.title = String(value.title);
      if (value.defaultSec !== undefined) t.defaultSec = Math.max(0, Number(value.defaultSec));
      if (value.autoAdd) t.autoAdd = { ...t.autoAdd, ...value.autoAdd };
    }
    this.saveConfig();
    this._broadcastState('timer');
    return t;
  }

  // ─── 2. Spin Wheel Controls ───────────────────────────────────────────────
  updateWheelConfig({ title, autoTriggerEffect, segments }) {
    if (title !== undefined) this.state.wheel.title = String(title);
    if (autoTriggerEffect !== undefined) this.state.wheel.autoTriggerEffect = Boolean(autoTriggerEffect);
    if (Array.isArray(segments) && segments.length > 0) {
      this.state.wheel.segments = segments.map((s, idx) => ({
        id: s.id || `seg_${idx + 1}`,
        label: s.label || `Opsi ${idx + 1}`,
        color: s.color || '#6366f1',
        weight: Math.max(1, Number(s.weight) || 10),
        effectId: s.effectId || ''
      }));
    }
    this.saveConfig();
    this._broadcastState('wheel');
    return this.state.wheel;
  }

  spinWheel(triggeredBy = 'Streamer') {
    const segs = this.state.wheel.segments || [];
    if (segs.length === 0) return null;

    const totalWeight = segs.reduce((acc, s) => acc + (Number(s.weight) || 1), 0);
    let r = Math.random() * totalWeight;
    let winnerIdx = 0;
    for (let i = 0; i < segs.length; i++) {
      r -= (Number(segs[i].weight) || 1);
      if (r <= 0) {
        winnerIdx = i;
        break;
      }
    }
    const winner = segs[winnerIdx];
    this.state.wheel.lastWinner = { ...winner, user: triggeredBy, time: Date.now() };

    const spinPayload = {
      type: 'wheel_spin',
      winnerIndex: winnerIdx,
      winner,
      segments: segs,
      user: triggeredBy,
      spinDurationMs: 4200
    };
    this.broadcast(spinPayload);

    if (this.state.wheel.autoTriggerEffect && winner.effectId) {
      setTimeout(() => {
        this.triggerEffect(winner.effectId, `${triggeredBy} (Wheel: ${winner.label})`, 'wheel');
      }, 4300);
    }

    return spinPayload;
  }

  // ─── 3. Goal Bars Controls ────────────────────────────────────────────────
  updateGoal(goalType, updates = {}) {
    if (!this.state.goals[goalType]) return null;
    const g = this.state.goals[goalType];
    if (updates.title !== undefined) g.title = String(updates.title);
    if (updates.target !== undefined) g.target = Math.max(1, Number(updates.target));
    if (updates.current !== undefined) g.current = Math.max(0, Number(updates.current));
    if (updates.autoScale !== undefined) g.autoScale = Boolean(updates.autoScale);
    if (updates.rewardEffectId !== undefined) g.rewardEffectId = String(updates.rewardEffectId);
    this.saveConfig();
    this._broadcastState('goals');
    return g;
  }

  _incrementGoal(goalType, amount, user = 'Penonton') {
    const g = this.state.goals[goalType];
    if (!g || amount <= 0) return;
    g.current += amount;
    if (g.current >= g.target) {
      this.broadcast({
        type: 'goal_reached',
        goalType,
        goal: { ...g },
        user
      });
      if (g.rewardEffectId) {
        this.triggerEffect(g.rewardEffectId, `${user} (${g.title} Tercapai!)`, 'goal');
      }
      if (g.autoScale) {
        g.target = Math.round(g.target * 1.5);
      }
    }
    this._broadcastState('goals');
  }

  // ─── 4. Win / Lose Counter Controls ───────────────────────────────────────
  controlCounter(action, value) {
    const c = this.state.counter;
    if (action === 'win_add') { c.wins += (Number(value) || 1); c.streak = Math.max(1, c.streak + 1); }
    else if (action === 'win_sub') { c.wins = Math.max(0, c.wins - (Number(value) || 1)); }
    else if (action === 'lose_add') { c.loses += (Number(value) || 1); c.streak = Math.min(-1, c.streak - 1); }
    else if (action === 'lose_sub') { c.loses = Math.max(0, c.loses - (Number(value) || 1)); }
    else if (action === 'reset') { c.wins = 0; c.loses = 0; c.streak = 0; }
    else if (action === 'set' && value && typeof value === 'object') {
      if (value.title !== undefined) c.title = String(value.title);
      if (value.wins !== undefined) c.wins = Math.max(0, Number(value.wins));
      if (value.loses !== undefined) c.loses = Math.max(0, Number(value.loses));
    }
    this.saveConfig();
    this._broadcastState('counter');
    return c;
  }

  // ─── 5. Leaderboard Tracking ──────────────────────────────────────────────
  getLeaderboard() {
    const topGifters = Array.from(this.giftersMap.values())
      .sort((a, b) => b.coins - a.coins)
      .slice(0, 10);
    const topLikers = Array.from(this.likersMap.values())
      .sort((a, b) => b.likes - a.likes)
      .slice(0, 10);
    return { topGifters, topLikers };
  }

  resetLeaderboard() {
    this.giftersMap.clear();
    this.likersMap.clear();
    this._broadcastState('leaderboard');
  }

  // ─── 6. Live Chat Poll / Voting ───────────────────────────────────────────
  startPoll({ question, durationSec = 45, options }) {
    if (this.pollTimeout) clearTimeout(this.pollTimeout);
    this.pollVoters.clear();

    const p = this.state.poll;
    if (question) p.question = String(question);
    p.durationSec = Math.max(10, Number(durationSec) || 45);
    p.endsAt = Date.now() + p.durationSec * 1000;
    p.active = true;
    p.winner = null;

    if (Array.isArray(options) && options.length >= 2) {
      p.options = options.map((o, idx) => ({
        key: String(o.key || idx + 1),
        label: o.label || `Opsi ${idx + 1}`,
        votes: 0,
        effectId: o.effectId || ''
      }));
    } else {
      p.options.forEach(o => { o.votes = 0; });
    }

    this.saveConfig();
    this._broadcastState('poll');
    return p;
  }

  endPoll() {
    const p = this.state.poll;
    if (!p.active) return p;
    p.active = false;
    p.endsAt = 0;

    let sorted = [...p.options].sort((a, b) => b.votes - a.votes);
    const top = sorted[0];
    p.winner = top && top.votes > 0 ? top : null;

    this.broadcast({
      type: 'poll_ended',
      winner: p.winner,
      poll: p
    });

    if (p.winner && p.winner.effectId) {
      this.triggerEffect(p.winner.effectId, `Hasil Voting (${p.winner.label})`, 'poll');
    }

    this.saveConfig();
    this._broadcastState('poll');
    return p;
  }

  // ─── 7. Giveaway / Raffle System ──────────────────────────────────────────
  controlGiveaway(action, payload = {}) {
    const gw = this.state.giveaway;
    if (action === 'start') {
      gw.active = true;
      gw.winner = null;
      if (payload.title) gw.title = String(payload.title);
      if (payload.keyword) gw.keyword = String(payload.keyword).trim();
      if (payload.clearParticipants) gw.participants = [];
    } else if (action === 'stop') {
      gw.active = false;
    } else if (action === 'clear') {
      gw.participants = [];
      gw.winner = null;
    } else if (action === 'draw') {
      if (gw.participants.length === 0) return { error: 'Belum ada peserta giveaway' };
      const totalTickets = gw.participants.reduce((s, p) => s + (p.tickets || 1), 0);
      let r = Math.random() * totalTickets;
      let chosen = gw.participants[0];
      for (const p of gw.participants) {
        r -= (p.tickets || 1);
        if (r <= 0) {
          chosen = p;
          break;
        }
      }
      gw.winner = { user: chosen.user, tickets: chosen.tickets, time: Date.now() };
      this.broadcast({
        type: 'giveaway_winner',
        winner: gw.winner,
        totalParticipants: gw.participants.length
      });
    }
    this.saveConfig();
    this._broadcastState('giveaway');
    return gw;
  }

  _addGiveawayTicket(user, tickets = 1) {
    const gw = this.state.giveaway;
    if (!gw.active || !user) return;
    const existing = gw.participants.find(p => p.user.toLowerCase() === user.toLowerCase());
    if (existing) {
      existing.tickets += tickets;
    } else {
      gw.participants.push({ user, tickets });
    }
    this._broadcastState('giveaway');
  }

  // ─── 8. Multi-Screen Media Alert (Screen 1..10) ───────────────────────────
  triggerScreenAlert(screenId = 1, alertData = {}) {
    const sid = Math.max(1, Math.min(10, Number(screenId) || 1));
    const screenCfg = this.state.screens[sid] || { name: `Screen ${sid}`, position: 'center', defaultDurationMs: 4000 };
    const payload = {
      type: 'screen_alert',
      screen: sid,
      position: alertData.position || screenCfg.position || 'center',
      title: alertData.title || '',
      subtitle: alertData.subtitle || '',
      mediaUrl: alertData.mediaUrl || '', // Image/GIF/WebM/MP4 URL
      mediaType: alertData.mediaType || 'auto',
      soundUrl: alertData.soundUrl || '',
      color: alertData.color || '#6366f1',
      durationMs: Number(alertData.durationMs) || screenCfg.defaultDurationMs || 4000
    };
    this.broadcast(payload);
    return payload;
  }

  // ─── Stream Event Hooks (Auto-update Timer, Goals, Leaderboard, Poll, Giveaway) ──
  onGift({ user, coins = 1, giftName = '', repeatCount = 1 }) {
    const c = Number(coins) || 1;
    // Update leaderboard
    const prev = this.giftersMap.get(user) || { user, coins: 0, gifts: 0 };
    prev.coins += c;
    prev.gifts += (Number(repeatCount) || 1);
    this.giftersMap.set(user, prev);

    // Update coin goal
    this._incrementGoal('coins', c, user);

    // Auto-add Subathon Timer
    if (this.state.timer.autoAdd?.enabled && this.state.timer.autoAdd.secPerCoin > 0) {
      this.controlTimer('add', Math.round(c * this.state.timer.autoAdd.secPerCoin), user);
    }

    // Giveaway gift tickets
    if (this.state.giveaway.active && this.state.giveaway.giftTickets) {
      const tks = Math.max(1, Math.floor(c / Math.max(1, this.state.giveaway.coinsPerTicket || 5)));
      this._addGiveawayTicket(user, tks);
    }

    this._broadcastState('leaderboard');
  }

  onLike({ user, count = 1 }) {
    const c = Number(count) || 1;
    const prev = this.likersMap.get(user) || { user, likes: 0 };
    prev.likes += c;
    this.likersMap.set(user, prev);

    this._incrementGoal('likes', c, user);

    if (this.state.timer.autoAdd?.enabled && this.state.timer.autoAdd.secPer100Likes > 0) {
      this.likeSubAccumulator += c;
      while (this.likeSubAccumulator >= 100) {
        this.likeSubAccumulator -= 100;
        this.controlTimer('add', this.state.timer.autoAdd.secPer100Likes, user);
      }
    }

    this._broadcastState('leaderboard');
  }

  onFollow({ user }) {
    this._incrementGoal('followers', 1, user);
    if (this.state.timer.autoAdd?.enabled && this.state.timer.autoAdd.secPerFollow > 0) {
      this.controlTimer('add', this.state.timer.autoAdd.secPerFollow, user);
    }
  }

  onDonation({ user, amount = 0 }) {
    const amt = Number(amount) || 0;
    this._incrementGoal('donations', amt, user);
    if (this.state.timer.autoAdd?.enabled && this.state.timer.autoAdd.secPer10kIdr > 0 && amt >= 1000) {
      const addSec = Math.round((amt / 10000) * this.state.timer.autoAdd.secPer10kIdr);
      if (addSec > 0) this.controlTimer('add', addSec, user);
    }
  }

  onChat({ user, comment = '' }) {
    const clean = String(comment || '').trim();
    if (!clean) return;

    // Check active Poll voting
    if (this.state.poll.active) {
      const voteKey = clean.replace(/^!vote\s+/i, '').trim();
      const opt = this.state.poll.options.find(o => o.key === voteKey);
      if (opt && !this.pollVoters.has(user.toLowerCase())) {
        this.pollVoters.add(user.toLowerCase());
        opt.votes++;
        this._broadcastState('poll');
      }
    }

    // Check active Giveaway keyword
    if (this.state.giveaway.active) {
      const kw = (this.state.giveaway.keyword || '!ikut').toLowerCase();
      if (clean.toLowerCase() === kw || clean.toLowerCase().startsWith(kw + ' ')) {
        const exists = this.state.giveaway.participants.some(p => p.user.toLowerCase() === user.toLowerCase());
        if (!exists) {
          this._addGiveawayTicket(user, 1);
        }
      }
    }
  }
}

module.exports = WidgetManager;

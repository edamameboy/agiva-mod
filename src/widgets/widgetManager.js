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
    boostEnabled: false,
    boostMultiplier: 2,
    randomBonusEnabled: false,
    randomMinSec: 5,
    randomMaxSec: 30,
    hideWhenZero: false,
    endEffectId: '',
    endActionId: '',
    autoAdd: {
      enabled: true,
      secPerCoin: 2,
      secPer100Likes: 5,
      secPerFollow: 10,
      secPerSub: 60,
      secPerChat: 0,
      secPer10kIdr: 60
    }
  },
  wheel: {
    title: '🎡 RODA GACHA STREAMER',
    autoTriggerEffect: true,
    isSpinning: false,
    lastWinner: null,
    segments: [
      { id: 'seg_1', label: '⚡ Speed Boost', color: '#6366f1', weight: 25, effectId: '', actionId: '' },
      { id: 'seg_2', label: '💰 Bonus Uang', color: '#22c55e', weight: 25, effectId: '', actionId: '' },
      { id: 'seg_3', label: '🌧️ Cuaca Buruk', color: '#38bdf8', weight: 20, effectId: '', actionId: '' },
      { id: 'seg_4', label: '🤡 Troll / Zonk', color: '#f59e0b', weight: 20, effectId: '', actionId: '' },
      { id: 'seg_5', label: '💀 JACKPOT RUSUH', color: '#ef4444', weight: 10, effectId: '', actionId: '' }
    ]
  },
  goals: {
    likes: { title: '❤️ Target Like', current: 0, target: 1000, autoScale: true, rewardEffectId: '', deadlineAt: 0 },
    coins: { title: '💎 Target Koin Gift', current: 0, target: 500, autoScale: true, rewardEffectId: '', deadlineAt: 0 },
    followers: { title: '👤 Target Follower Baru', current: 0, target: 50, autoScale: true, rewardEffectId: '', deadlineAt: 0 },
    donations: { title: '💸 Target Donasi (Rp)', current: 0, target: 100000, autoScale: true, rewardEffectId: '', deadlineAt: 0 },
    shares: { title: '🔄 Target Share Live', current: 0, target: 50, autoScale: true, rewardEffectId: '', deadlineAt: 0 },
    subscribers: { title: '⭐ Target Subscriber', current: 0, target: 20, autoScale: true, rewardEffectId: '', deadlineAt: 0 },
    custom_1: { title: '🎯 Custom Goal 1', current: 0, target: 100, autoScale: false, rewardEffectId: '', deadlineAt: 0 },
    custom_2: { title: '🔥 Custom Goal 2', current: 0, target: 100, autoScale: false, rewardEffectId: '', deadlineAt: 0 },
    custom_3: { title: '👑 Custom Goal 3', current: 0, target: 100, autoScale: false, rewardEffectId: '', deadlineAt: 0 }
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
  lastX: {
    follower: null,
    gifter: null,
    subscriber: null,
    share: null,
    like: null,
    chatter: null
  },
  records: {
    topGift: null,
    topStreak: null
  },
  giftCounters: [
    { id: 'slot_1', enabled: true, giftId: 5655, label: '🌹 Rose', count: 0, target: 100 },
    { id: 'slot_2', enabled: false, giftId: 5879, label: '🍩 Doughnut', count: 0, target: 50 },
    { id: 'slot_3', enabled: false, giftId: 5487, label: '🫰 Finger Heart', count: 0, target: 50 }
  ],
  giftBattle: {
    active: false,
    title: '⚔️ GIFT BATTLE',
    target: 50,
    left: { label: 'TEAM A (Rose)', giftId: 5655, score: 0, color: '#3b82f6', winEffectId: '', winActionId: '' },
    right: { label: 'TEAM B (Doughnut)', giftId: 5879, score: 0, color: '#ef4444', winEffectId: '', winActionId: '' },
    winner: null
  },
  coinMatch: {
    active: false,
    title: '🏆 COIN MATCH',
    durationSec: 120,
    remainingSec: 120,
    entries: {},
    showWinners: false,
    topWinners: []
  },
  likeathon: {
    active: false,
    title: '🔥 LIKEATHON',
    decayPercent: 10,
    decayIntervalSec: 10,
    lastDecayAt: 0,
    scores: {}
  },
  coinJar: {
    enabled: true,
    title: '🪙 COIN JAR',
    totalCoins: 0,
    capacityCoins: 500
  },
  streamBuddies: {
    enabled: true,
    maxBuddies: 8,
    showChatBubbles: true,
    spriteStyle: 'chibi' // 'chibi' | 'pixel' | 'neon'
  },
  penaltyBattle: {
    active: true,
    title: '⚽ PENALTY BATTLE',
    minCoinsToShoot: 5,
    goals: 0,
    saves: 0,
    keeperDir: 'center', // 'left' | 'center' | 'right'
    lastShot: null,
    goalEffectId: '',
    saveEffectId: ''
  },
  socials: {
    enabled: true,
    intervalSec: 6,
    items: [
      { platform: 'tiktok', icon: '🎵', handle: '@agiva.live' },
      { platform: 'instagram', icon: '📸', handle: '@agiva.live' },
      { platform: 'youtube', icon: '▶️', handle: 'Agiva Official' },
      { platform: 'saweria', icon: '💸', handle: 'saweria.co/agiva' }
    ]
  },
  seasonalFx: {
    enabled: true,
    mode: 'snow', // 'snow' | 'sakura' | 'confetti' | 'matrix'
    density: 45
  },
  screens: {
    1: { name: 'Screen 1 (Utama / Tengah)', position: 'center', defaultDurationMs: 4000, maxQueueLength: 10 },
    2: { name: 'Screen 2 (Pojok Kanan Atas)', position: 'top-right', defaultDurationMs: 4000, maxQueueLength: 10 },
    3: { name: 'Screen 3 (Pojok Kiri Atas)', position: 'top-left', defaultDurationMs: 4000, maxQueueLength: 10 },
    4: { name: 'Screen 4 (Bawah / Memes)', position: 'bottom', defaultDurationMs: 5000, maxQueueLength: 10 },
    5: { name: 'Screen 5 (Full Screen Jumpscare)', position: 'fullscreen', defaultDurationMs: 3500, maxQueueLength: 10 }
  },
  theme: {
    pack: 'default',
    fontFamily: 'Inter',
    fontSizeScale: 1.0,
    textColor: '#f8fafc',
    accentColor: '#6366f1',
    bgColor: '#0b0f19',
    bgOpacity: 0.9,
    borderRadius: 16,
    animation: 'pop',
    customCss: ''
  }
};

class WidgetManager {
  constructor({ broadcastFn, triggerEffectFn, triggerActionFn }) {
    this.broadcast = broadcastFn || (() => {});
    this.triggerEffect = triggerEffectFn || (() => {});
    this.triggerAction = triggerActionFn || (() => {});
    this.state = JSON.parse(JSON.stringify(DEFAULT_WIDGETS_STATE));
    this.likeSubAccumulator = 0;
    this.pollVoters = new Set();
    this.pollTimeout = null;
    this.giftersMap = new Map(); // user -> { user, coins, gifts }
    this.likersMap = new Map();  // user -> { user, likes }
    this._saveTimer = null;
    this._dirty = false;
    this._isWriting = false;

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
        const mergedGoals = { ...DEFAULT_WIDGETS_STATE.goals };
        for (const [k, v] of Object.entries(saved.goals || {})) {
          mergedGoals[k] = { ...(DEFAULT_WIDGETS_STATE.goals[k] || {}), ...(v || {}) };
        }
        const mergedScreens = { ...DEFAULT_WIDGETS_STATE.screens };
        for (const [k, v] of Object.entries(saved.screens || {})) {
          mergedScreens[k] = { ...(DEFAULT_WIDGETS_STATE.screens[k] || {}), ...(v || {}) };
        }
        this.state = {
          ...DEFAULT_WIDGETS_STATE,
          ...saved,
          timer: {
            ...DEFAULT_WIDGETS_STATE.timer,
            ...(saved.timer || {}),
            autoAdd: { ...DEFAULT_WIDGETS_STATE.timer.autoAdd, ...(saved.timer?.autoAdd || {}) },
            isRunning: false
          },
          wheel: { ...DEFAULT_WIDGETS_STATE.wheel, ...(saved.wheel || {}), isSpinning: false },
          goals: mergedGoals,
          counter: { ...DEFAULT_WIDGETS_STATE.counter, ...(saved.counter || {}) },
          poll: { ...DEFAULT_WIDGETS_STATE.poll, ...(saved.poll || {}), active: false },
          giveaway: { ...DEFAULT_WIDGETS_STATE.giveaway, ...(saved.giveaway || {}) },
          lastX: { ...DEFAULT_WIDGETS_STATE.lastX, ...(saved.lastX || {}) },
          records: { ...DEFAULT_WIDGETS_STATE.records, ...(saved.records || {}) },
          giftCounters: Array.isArray(saved.giftCounters) && saved.giftCounters.length > 0
            ? saved.giftCounters
            : JSON.parse(JSON.stringify(DEFAULT_WIDGETS_STATE.giftCounters)),
          giftBattle: {
            ...DEFAULT_WIDGETS_STATE.giftBattle,
            ...(saved.giftBattle || {}),
            left: { ...DEFAULT_WIDGETS_STATE.giftBattle.left, ...(saved.giftBattle?.left || {}) },
            right: { ...DEFAULT_WIDGETS_STATE.giftBattle.right, ...(saved.giftBattle?.right || {}) },
            active: false
          },
          coinMatch: { ...DEFAULT_WIDGETS_STATE.coinMatch, ...(saved.coinMatch || {}), active: false },
          likeathon: { ...DEFAULT_WIDGETS_STATE.likeathon, ...(saved.likeathon || {}), active: false },
          coinJar: { ...DEFAULT_WIDGETS_STATE.coinJar, ...(saved.coinJar || {}) },
          streamBuddies: { ...DEFAULT_WIDGETS_STATE.streamBuddies, ...(saved.streamBuddies || {}) },
          penaltyBattle: { ...DEFAULT_WIDGETS_STATE.penaltyBattle, ...(saved.penaltyBattle || {}) },
          socials: {
            ...DEFAULT_WIDGETS_STATE.socials,
            ...(saved.socials || {}),
            items: Array.isArray(saved.socials?.items) && saved.socials.items.length > 0
              ? saved.socials.items
              : JSON.parse(JSON.stringify(DEFAULT_WIDGETS_STATE.socials.items))
          },
          seasonalFx: { ...DEFAULT_WIDGETS_STATE.seasonalFx, ...(saved.seasonalFx || {}) },
          screens: mergedScreens,
          theme: { ...DEFAULT_WIDGETS_STATE.theme, ...(saved.theme || {}) }
        };
      } else {
        this.flushSaveSync(true);
      }
    } catch (e) {
      console.error('[Widgets] Failed to load config:', e.message);
    }
  }

  saveConfig() {
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
      const dir = path.dirname(WIDGETS_CONFIG_PATH);
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = `${WIDGETS_CONFIG_PATH}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      await fs.promises.rename(tmp, WIDGETS_CONFIG_PATH);
    } catch (e) {
      console.error('[Widgets] Failed to save config:', e.message);
    } finally {
      this._isWriting = false;
      if (this._dirty) this.saveConfig();
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
      const dir = path.dirname(WIDGETS_CONFIG_PATH);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const tmp = `${WIDGETS_CONFIG_PATH}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
      fs.renameSync(tmp, WIDGETS_CONFIG_PATH);
    } catch (e) {
      console.error('[Widgets] Failed to flush config:', e.message);
    }
  }

  _sortedLikeathonLeaderboard() {
    return Object.entries(this.state.likeathon?.scores || {})
      .map(([user, likes]) => ({ user, likes: Number(likes) || 0 }))
      .filter(x => x.likes > 0)
      .sort((a, b) => b.likes - a.likes)
      .slice(0, 10);
  }

  _sortedCoinMatchLeaderboard() {
    return Object.entries(this.state.coinMatch?.entries || {})
      .map(([user, coins]) => ({ user, coins: Number(coins) || 0 }))
      .filter(x => x.coins > 0)
      .sort((a, b) => b.coins - a.coins)
      .slice(0, 10);
  }

  getState() {
    return {
      ...this.state,
      leaderboard: this.getLeaderboard(),
      likeathonLeaderboard: this._sortedLikeathonLeaderboard(),
      coinMatchLeaderboard: this._sortedCoinMatchLeaderboard()
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
    let endedNow = false;
    if (this.state.timer.isRunning && this.state.timer.remainingSec > 0) {
      this.state.timer.remainingSec = Math.max(0, this.state.timer.remainingSec - 1);
      if (this.state.timer.remainingSec === 0) {
        this.state.timer.isRunning = false;
        endedNow = true;
      }
      changed = true;
    }
    if (this.state.poll.active && this.state.poll.endsAt > 0 && Date.now() >= this.state.poll.endsAt) {
      this.endPoll();
      return;
    }

    // Coin Match countdown
    const cm = this.state.coinMatch;
    if (cm && cm.active && cm.remainingSec > 0) {
      cm.remainingSec = Math.max(0, cm.remainingSec - 1);
      if (cm.remainingSec === 0) {
        this.controlCoinMatch('end');
      } else {
        this._broadcastState('coinMatch');
      }
    }

    // Likeathon auto-decay
    const lk = this.state.likeathon;
    if (lk && lk.active) {
      const intervalMs = Math.max(2, Number(lk.decayIntervalSec) || 10) * 1000;
      const now = Date.now();
      if (now - (lk.lastDecayAt || 0) >= intervalMs) {
        this._applyLikeathonDecay(now);
      }
    }

    if (changed) {
      this.broadcast({
        type: 'timer_tick',
        remainingSec: this.state.timer.remainingSec,
        isRunning: this.state.timer.isRunning,
        title: this.state.timer.title
      });
    }
    if (endedNow) {
      this.broadcast({ type: 'timer_ended', title: this.state.timer.title });
      if (this.state.timer.endEffectId) {
        this.triggerEffect(this.state.timer.endEffectId, 'Timer 0:00', 'timer_end');
      }
      if (this.state.timer.endActionId) {
        this.triggerAction(this.state.timer.endActionId, { user: 'Timer 0:00', source: 'timer_end' });
      }
      this.saveConfig();
    }
  }

  _applyLikeathonDecay(now = Date.now()) {
    const lk = this.state.likeathon;
    lk.lastDecayAt = now;
    const pct = Math.max(0, Math.min(95, Number(lk.decayPercent) || 10));
    const ratio = 1 - pct / 100;
    let mutated = false;
    for (const [k, v] of Object.entries(lk.scores || {})) {
      const next = Math.floor((Number(v) || 0) * ratio);
      if (next <= 0) {
        delete lk.scores[k];
        mutated = true;
      } else if (next !== v) {
        lk.scores[k] = next;
        mutated = true;
      }
    }
    if (mutated) {
      this._broadcastState('likeathon');
    }
  }

  _computeTimerBonus(baseSec) {
    let sec = Number(baseSec) || 0;
    if (sec <= 0) return 0;
    const t = this.state.timer;
    if (t.boostEnabled) {
      sec = Math.round(sec * Math.max(1, Number(t.boostMultiplier) || 2));
    }
    if (t.randomBonusEnabled) {
      const minS = Math.max(0, Number(t.randomMinSec) || 0);
      const maxS = Math.max(minS, Number(t.randomMaxSec) || minS);
      sec += minS + Math.floor(Math.random() * (maxS - minS + 1));
    }
    return sec;
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
      if (value.boostEnabled !== undefined) t.boostEnabled = Boolean(value.boostEnabled);
      if (value.boostMultiplier !== undefined) t.boostMultiplier = Math.max(1, Number(value.boostMultiplier) || 2);
      if (value.randomBonusEnabled !== undefined) t.randomBonusEnabled = Boolean(value.randomBonusEnabled);
      if (value.randomMinSec !== undefined) t.randomMinSec = Math.max(0, Number(value.randomMinSec) || 0);
      if (value.randomMaxSec !== undefined) t.randomMaxSec = Math.max(t.randomMinSec || 0, Number(value.randomMaxSec) || 30);
      if (value.hideWhenZero !== undefined) t.hideWhenZero = Boolean(value.hideWhenZero);
      if (value.endEffectId !== undefined) t.endEffectId = String(value.endEffectId || '');
      if (value.endActionId !== undefined) t.endActionId = String(value.endActionId || '');
      if (value.autoAdd && typeof value.autoAdd === 'object') {
        t.autoAdd = { ...t.autoAdd, ...value.autoAdd };
      }
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
      this.state.wheel.segments = segments.slice(0, 24).map((s, idx) => ({
        id: s.id || `seg_${idx + 1}`,
        label: s.label || `Opsi ${idx + 1}`,
        color: s.color || '#6366f1',
        weight: Math.max(1, Number(s.weight) || 10),
        effectId: s.effectId || '',
        actionId: s.actionId || ''
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

    if (this.state.wheel.autoTriggerEffect && (winner.effectId || winner.actionId)) {
      setTimeout(() => {
        if (winner.effectId) {
          this.triggerEffect(winner.effectId, `${triggeredBy} (Wheel: ${winner.label})`, 'wheel');
        }
        if (winner.actionId) {
          this.triggerAction(winner.actionId, { user: triggeredBy, nickname: triggeredBy, wheelWinner: winner.label, source: 'wheel' });
        }
      }, 4300);
    }

    return spinPayload;
  }

  // ─── 3. Goal Bars Controls ────────────────────────────────────────────────
  updateGoal(goalType, updates = {}) {
    if (!this.state.goals[goalType]) {
      this.state.goals[goalType] = { title: goalType, current: 0, target: 100, autoScale: false, rewardEffectId: '', deadlineAt: 0 };
    }
    const g = this.state.goals[goalType];
    if (updates.title !== undefined) g.title = String(updates.title);
    if (updates.target !== undefined) g.target = Math.max(1, Number(updates.target));
    if (updates.current !== undefined) g.current = Math.max(0, Number(updates.current));
    if (updates.autoScale !== undefined) g.autoScale = Boolean(updates.autoScale);
    if (updates.rewardEffectId !== undefined) g.rewardEffectId = String(updates.rewardEffectId);
    if (updates.countdownMinutes !== undefined) {
      const mins = Math.max(0, Number(updates.countdownMinutes) || 0);
      g.deadlineAt = mins > 0 ? (Date.now() + mins * 60000) : 0;
    } else if (updates.deadlineAt !== undefined) {
      g.deadlineAt = Math.max(0, Number(updates.deadlineAt) || 0);
    }
    this.saveConfig();
    this._broadcastState('goals');
    return g;
  }

  adjustGoal(goalType, delta = 1, user = 'System') {
    const d = Number(delta) || 0;
    if (d > 0) {
      this._incrementGoal(goalType, d, user);
    } else if (d < 0 && this.state.goals[goalType]) {
      this.state.goals[goalType].current = Math.max(0, (this.state.goals[goalType].current || 0) + d);
      this.saveConfig();
      this._broadcastState('goals');
    }
    return this.state.goals[goalType] || null;
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

  // ─── 8. Multi-Screen Media Alert & Theme Customizer ───────────────────────
  updateTheme(updates = {}) {
    const t = this.state.theme;
    if (updates.pack !== undefined) t.pack = String(updates.pack || 'default');
    if (updates.fontFamily !== undefined) t.fontFamily = String(updates.fontFamily || 'Inter');
    if (updates.fontSizeScale !== undefined) t.fontSizeScale = Math.max(0.6, Math.min(2.0, Number(updates.fontSizeScale) || 1.0));
    if (updates.textColor !== undefined) t.textColor = String(updates.textColor || '#f8fafc');
    if (updates.accentColor !== undefined) t.accentColor = String(updates.accentColor || '#6366f1');
    if (updates.bgColor !== undefined) t.bgColor = String(updates.bgColor || '#0b0f19');
    if (updates.bgOpacity !== undefined) t.bgOpacity = Math.max(0, Math.min(1, Number(updates.bgOpacity) ?? 0.9));
    if (updates.borderRadius !== undefined) t.borderRadius = Math.max(0, Math.min(36, Number(updates.borderRadius) ?? 16));
    if (updates.animation !== undefined) t.animation = String(updates.animation || 'pop');
    if (updates.customCss !== undefined) t.customCss = String(updates.customCss || '').slice(0, 4000);
    this.saveConfig();
    this._broadcastState('theme');
    return t;
  }

  // ─── 9. Mini-Games & PRO Overlays Controls (Phase 3) ──────────────────────
  configureGiftCounters(slots = []) {
    if (Array.isArray(slots)) {
      this.state.giftCounters = slots.slice(0, 3).map((s, idx) => ({
        id: s.id || `slot_${idx + 1}`,
        enabled: s.enabled !== false,
        giftId: s.giftId !== undefined && s.giftId !== '' && !isNaN(s.giftId) ? Number(s.giftId) : (s.giftId || 5655),
        label: String(s.label || `Slot ${idx + 1}`),
        count: Math.max(0, Number(s.count ?? this.state.giftCounters?.[idx]?.count) || 0),
        target: Math.max(0, Number(s.target) || 0)
      }));
    }
    this.saveConfig();
    this._broadcastState('giftCounters');
    return this.state.giftCounters;
  }

  controlGiftBattle(action = 'config', opts = {}) {
    const gb = this.state.giftBattle;
    if (opts.title !== undefined) gb.title = String(opts.title);
    if (opts.target !== undefined) gb.target = Math.max(1, Number(opts.target) || 50);
    if (opts.left && typeof opts.left === 'object') {
      gb.left = {
        ...gb.left,
        ...opts.left,
        giftId: !isNaN(opts.left.giftId) && opts.left.giftId !== '' ? Number(opts.left.giftId) : gb.left.giftId
      };
    }
    if (opts.right && typeof opts.right === 'object') {
      gb.right = {
        ...gb.right,
        ...opts.right,
        giftId: !isNaN(opts.right.giftId) && opts.right.giftId !== '' ? Number(opts.right.giftId) : gb.right.giftId
      };
    }

    if (action === 'start') {
      gb.active = true;
      gb.winner = null;
      gb.left.score = 0;
      gb.right.score = 0;
    } else if (action === 'stop') {
      gb.active = false;
    } else if (action === 'reset') {
      gb.active = false;
      gb.winner = null;
      gb.left.score = 0;
      gb.right.score = 0;
    }
    this.saveConfig();
    this._broadcastState('giftBattle');
    return gb;
  }

  controlCoinMatch(action = 'config', opts = {}) {
    const cm = this.state.coinMatch;
    if (opts.title !== undefined) cm.title = String(opts.title);
    if (opts.durationSec !== undefined) cm.durationSec = Math.max(10, Number(opts.durationSec) || 120);

    if (action === 'start') {
      cm.active = true;
      cm.entries = {};
      cm.topWinners = [];
      cm.showWinners = false;
      cm.remainingSec = cm.durationSec;
    } else if (action === 'end' || action === 'stop') {
      cm.active = false;
      cm.topWinners = this._sortedCoinMatchLeaderboard().slice(0, 3);
      cm.showWinners = true;
      this.broadcast({ type: 'coin_match_ended', topWinners: cm.topWinners, coinMatch: cm });
    } else if (action === 'reset') {
      cm.active = false;
      cm.entries = {};
      cm.topWinners = [];
      cm.showWinners = false;
      cm.remainingSec = cm.durationSec;
    } else if (action === 'show_winners') {
      cm.showWinners = true;
      cm.topWinners = this._sortedCoinMatchLeaderboard().slice(0, 3);
    }
    this.saveConfig();
    this._broadcastState('coinMatch');
    return cm;
  }

  controlLikeathon(action = 'config', opts = {}) {
    const lk = this.state.likeathon;
    if (opts.title !== undefined) lk.title = String(opts.title);
    if (opts.decayPercent !== undefined) lk.decayPercent = Math.max(0, Math.min(95, Number(opts.decayPercent) ?? 10));
    if (opts.decayIntervalSec !== undefined) lk.decayIntervalSec = Math.max(2, Number(opts.decayIntervalSec) || 10);

    if (action === 'start') {
      lk.active = true;
      lk.lastDecayAt = Date.now();
    } else if (action === 'stop' || action === 'pause') {
      lk.active = false;
    } else if (action === 'reset') {
      lk.active = false;
      lk.scores = {};
      lk.lastDecayAt = 0;
    }
    this.saveConfig();
    this._broadcastState('likeathon');
    return lk;
  }

  controlCoinJar(action = 'config', opts = {}) {
    const cj = this.state.coinJar;
    if (opts.title !== undefined) cj.title = String(opts.title);
    if (opts.enabled !== undefined) cj.enabled = Boolean(opts.enabled);
    if (opts.capacityCoins !== undefined) cj.capacityCoins = Math.max(10, Number(opts.capacityCoins) || 500);
    if (action === 'reset') {
      cj.totalCoins = 0;
    }
    this.saveConfig();
    this._broadcastState('coinJar');
    return cj;
  }

  resetRecords() {
    this.state.records = { topGift: null, topStreak: null };
    this.state.lastX = { follower: null, gifter: null, subscriber: null, share: null, like: null, chatter: null };
    for (const c of this.state.giftCounters || []) {
      c.count = 0;
    }
    this.saveConfig();
    this._broadcastState('records');
    return { records: this.state.records, lastX: this.state.lastX, giftCounters: this.state.giftCounters };
  }

  updateScreenConfig(screenId, updates = {}) {
    const sid = Math.max(1, Math.min(10, Number(screenId) || 1));
    const cur = this.state.screens[sid] || { name: `Screen ${sid}`, position: 'center', defaultDurationMs: 4000, maxQueueLength: 10 };
    this.state.screens[sid] = {
      ...cur,
      ...(updates.name !== undefined ? { name: String(updates.name) } : {}),
      ...(updates.position !== undefined ? { position: String(updates.position) } : {}),
      ...(updates.defaultDurationMs !== undefined ? { defaultDurationMs: Math.max(500, Number(updates.defaultDurationMs) || 4000) } : {}),
      ...(updates.maxQueueLength !== undefined ? { maxQueueLength: Math.max(1, Math.min(50, Number(updates.maxQueueLength) || 10)) } : {})
    };
    this.saveConfig();
    this._broadcastState('screens');
    return this.state.screens[sid];
  }

  triggerScreenAlert(screenId = 1, alertData = {}) {
    const sid = Math.max(1, Math.min(10, Number(screenId) || 1));
    const screenCfg = this.state.screens[sid] || { name: `Screen ${sid}`, position: 'center', defaultDurationMs: 4000, maxQueueLength: 10 };
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
      durationMs: Number(alertData.durationMs) || screenCfg.defaultDurationMs || 4000,
      maxQueueLength: Number(screenCfg.maxQueueLength) || 10
    };
    this.broadcast(payload);
    return payload;
  }

  // ─── Stream Event Hooks (Auto-update Timer, Goals, Leaderboard, Poll, Giveaway, Mini-Games) ──
  onGift({ user, coins = 1, giftName = '', giftId = '', repeatCount = 1, avatar = '' }) {
    const c = Number(coins) || 1;
    const rep = Number(repeatCount) || 1;
    const now = Date.now();

    // Update leaderboard
    const prev = this.giftersMap.get(user) || { user, coins: 0, gifts: 0 };
    prev.coins += c;
    prev.gifts += rep;
    this.giftersMap.set(user, prev);

    // Update Last X & Records
    this.state.lastX.gifter = { user, giftName, giftId, coins: c, repeatCount: rep, avatar, time: now };
    if (!this.state.records.topGift || c >= (this.state.records.topGift.coins || 0)) {
      this.state.records.topGift = { user, giftName, giftId, coins: c, time: now };
    }
    if (!this.state.records.topStreak || rep >= (this.state.records.topStreak.repeatCount || 0)) {
      this.state.records.topStreak = { user, giftName, giftId, repeatCount: rep, coins: c, time: now };
    }

    // Update Gift Counters
    if (giftId) {
      for (const slot of this.state.giftCounters || []) {
        if (slot.enabled && String(slot.giftId) === String(giftId)) {
          slot.count = (Number(slot.count) || 0) + rep;
        }
      }
    }

    // Update Gift Battle
    const gb = this.state.giftBattle;
    if (gb && gb.active && giftId) {
      let hitSide = null;
      if (String(gb.left.giftId) === String(giftId)) {
        gb.left.score = (Number(gb.left.score) || 0) + rep;
        hitSide = 'left';
      } else if (String(gb.right.giftId) === String(giftId)) {
        gb.right.score = (Number(gb.right.score) || 0) + rep;
        hitSide = 'right';
      }
      if (hitSide) {
        const sideObj = gb[hitSide];
        if (sideObj.score >= (Number(gb.target) || 50)) {
          gb.winner = {
            side: hitSide,
            label: sideObj.label,
            giftId: sideObj.giftId,
            score: sideObj.score,
            user,
            time: now
          };
          gb.active = false;
          this.broadcast({ type: 'gift_battle_winner', winner: gb.winner, battle: gb });
          if (sideObj.winEffectId) {
            this.triggerEffect(sideObj.winEffectId, `${user} (${sideObj.label} Menang!)`, 'gift_battle');
          }
          if (sideObj.winActionId) {
            this.triggerAction(sideObj.winActionId, { user, nickname: user, battleWinner: sideObj.label, source: 'gift_battle' });
          }
        }
      }
    }

    // Update Coin Match
    const cm = this.state.coinMatch;
    if (cm && cm.active) {
      cm.entries[user] = (Number(cm.entries[user]) || 0) + c;
    }

    // Update Coin Jar
    if (this.state.coinJar?.enabled) {
      this.state.coinJar.totalCoins = (Number(this.state.coinJar.totalCoins) || 0) + c;
      this.broadcast({
        type: 'coin_jar_drop',
        user,
        giftName,
        giftId,
        coins: c,
        totalCoins: this.state.coinJar.totalCoins,
        capacityCoins: this.state.coinJar.capacityCoins || 500
      });
    }

    // Stream Buddies spawn / speech bubble on gift
    if (this.state.streamBuddies?.enabled !== false) {
      this.broadcast({
        type: 'buddy_event',
        kind: 'gift',
        user,
        avatar,
        coins: c,
        text: `🎁 ${giftName} (${c}💎)`
      });
    }

    // Penalty Battle auto-shoot on gift >= minCoinsToShoot
    if (this.state.penaltyBattle?.active && c >= Math.max(1, Number(this.state.penaltyBattle.minCoinsToShoot) || 5)) {
      this.shootPenalty(user, null, { giftName, coins: c, avatar });
    }

    // Update coin goal
    this._incrementGoal('coins', c, user);

    // Auto-add Subathon Timer
    if (this.state.timer.autoAdd?.enabled && this.state.timer.autoAdd.secPerCoin > 0) {
      const addSec = this._computeTimerBonus(Math.round(c * this.state.timer.autoAdd.secPerCoin));
      if (addSec > 0) this.controlTimer('add', addSec, user);
    }

    // Giveaway gift tickets
    if (this.state.giveaway.active && this.state.giveaway.giftTickets) {
      const tks = Math.max(1, Math.floor(c / Math.max(1, this.state.giveaway.coinsPerTicket || 5)));
      this._addGiveawayTicket(user, tks);
    }

    this.saveConfig();
    this._broadcastState('leaderboard');
  }

  onLike({ user, count = 1, avatar = '' }) {
    const c = Number(count) || 1;
    const prev = this.likersMap.get(user) || { user, likes: 0 };
    prev.likes += c;
    this.likersMap.set(user, prev);

    this.state.lastX.like = { user, count: c, avatar, time: Date.now() };
    if (this.state.likeathon?.active) {
      this.state.likeathon.scores[user] = (Number(this.state.likeathon.scores[user]) || 0) + c;
      this._broadcastState('likeathon');
    }

    this._incrementGoal('likes', c, user);

    if (this.state.timer.autoAdd?.enabled && this.state.timer.autoAdd.secPer100Likes > 0) {
      this.likeSubAccumulator += c;
      while (this.likeSubAccumulator >= 100) {
        this.likeSubAccumulator -= 100;
        const addSec = this._computeTimerBonus(this.state.timer.autoAdd.secPer100Likes);
        if (addSec > 0) this.controlTimer('add', addSec, user);
      }
    }

    this._broadcastState('leaderboard');
  }

  onFollow({ user, avatar = '' }) {
    this.state.lastX.follower = { user, avatar, time: Date.now() };
    this._incrementGoal('followers', 1, user);
    if (this.state.timer.autoAdd?.enabled && this.state.timer.autoAdd.secPerFollow > 0) {
      const addSec = this._computeTimerBonus(this.state.timer.autoAdd.secPerFollow);
      if (addSec > 0) this.controlTimer('add', addSec, user);
    }
  }

  onShare({ user, avatar = '' }) {
    this.state.lastX.share = { user, avatar, time: Date.now() };
    this._incrementGoal('shares', 1, user);
  }

  onSubscribe({ user, avatar = '' }) {
    this.state.lastX.subscriber = { user, avatar, time: Date.now() };
    this._incrementGoal('subscribers', 1, user);
    if (this.state.timer.autoAdd?.enabled && this.state.timer.autoAdd.secPerSub > 0) {
      const addSec = this._computeTimerBonus(this.state.timer.autoAdd.secPerSub);
      if (addSec > 0) this.controlTimer('add', addSec, user);
    }
  }

  onDonation({ user, amount = 0 }) {
    const amt = Number(amount) || 0;
    this._incrementGoal('donations', amt, user);
    if (this.state.timer.autoAdd?.enabled && this.state.timer.autoAdd.secPer10kIdr > 0 && amt >= 1000) {
      const baseSec = Math.round((amt / 10000) * this.state.timer.autoAdd.secPer10kIdr);
      const addSec = this._computeTimerBonus(baseSec);
      if (addSec > 0) this.controlTimer('add', addSec, user);
    }
  }

  onChat({ user, comment = '', avatar = '' }) {
    const clean = String(comment || '').trim();
    if (!clean) return;

    this.state.lastX.chatter = { user, comment: clean, avatar, time: Date.now() };
    this._broadcastState('lastX');

    if (this.state.timer.autoAdd?.enabled && this.state.timer.autoAdd.secPerChat > 0) {
      const addSec = this._computeTimerBonus(this.state.timer.autoAdd.secPerChat);
      if (addSec > 0) this.controlTimer('add', addSec, user);
    }

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

    // Stream Buddies chat bubble
    if (this.state.streamBuddies?.enabled !== false && this.state.streamBuddies.showChatBubbles !== false) {
      this.broadcast({
        type: 'buddy_event',
        kind: 'chat',
        user,
        avatar,
        text: clean.slice(0, 60)
      });
    }

    // Penalty Battle goalkeeper direction commands (!kiri, !tengah, !kanan) or chat kick (!tendang kiri/tengah/kanan)
    if (this.state.penaltyBattle?.active) {
      const low = clean.toLowerCase();
      if (low === '!kiri' || low === '!left') {
        this.state.penaltyBattle.keeperDir = 'left';
        this._broadcastState('penaltyBattle');
      } else if (low === '!tengah' || low === '!center') {
        this.state.penaltyBattle.keeperDir = 'center';
        this._broadcastState('penaltyBattle');
      } else if (low === '!kanan' || low === '!right') {
        this.state.penaltyBattle.keeperDir = 'right';
        this._broadcastState('penaltyBattle');
      } else if (low.startsWith('!penalti') || low.startsWith('!shoot')) {
        const dir = low.includes('kiri') || low.includes('left') ? 'left'
          : (low.includes('kanan') || low.includes('right') ? 'right' : 'center');
        this.shootPenalty(user, dir, { avatar });
      }
    }
  }

  // ─── Stream Buddies, Penalty Battle, Social Rotator & Seasonal FX Controls ──
  updateStreamBuddies(patch = {}) {
    this.state.streamBuddies = {
      ...this.state.streamBuddies,
      ...patch,
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : this.state.streamBuddies.enabled,
      maxBuddies: Math.max(1, Math.min(25, Number(patch.maxBuddies ?? this.state.streamBuddies.maxBuddies) || 8)),
      showChatBubbles: patch.showChatBubbles !== undefined ? Boolean(patch.showChatBubbles) : this.state.streamBuddies.showChatBubbles
    };
    this.saveConfig();
    this._broadcastState('streamBuddies');
    return this.state.streamBuddies;
  }

  controlPenaltyBattle(action, payload = {}) {
    const pb = this.state.penaltyBattle;
    if (action === 'config' || action === 'start') {
      if (payload.title !== undefined) pb.title = String(payload.title || '⚽ PENALTY BATTLE');
      if (payload.minCoinsToShoot !== undefined) pb.minCoinsToShoot = Math.max(1, Number(payload.minCoinsToShoot) || 5);
      if (payload.goalEffectId !== undefined) pb.goalEffectId = String(payload.goalEffectId || '');
      if (payload.saveEffectId !== undefined) pb.saveEffectId = String(payload.saveEffectId || '');
      if (payload.active !== undefined) pb.active = Boolean(payload.active);
      else if (action === 'start') pb.active = true;
    } else if (action === 'stop') {
      pb.active = false;
    } else if (action === 'reset') {
      pb.goals = 0;
      pb.saves = 0;
      pb.lastShot = null;
    } else if (action === 'shoot') {
      return this.shootPenalty(payload.user || 'Streamer', payload.direction || null, payload);
    }
    this.saveConfig();
    this._broadcastState('penaltyBattle');
    return pb;
  }

  shootPenalty(user = 'Penonton', forcedDir = null, meta = {}) {
    const pb = this.state.penaltyBattle;
    const dirs = ['left', 'center', 'right'];
    const shotDir = dirs.includes(forcedDir) ? forcedDir : dirs[Math.floor(Math.random() * dirs.length)];
    // Goalkeeper dives toward current chat-voted keeperDir (70% chance) or random dive (30%)
    const keeperDir = (Math.random() < 0.7 && dirs.includes(pb.keeperDir))
      ? pb.keeperDir
      : dirs[Math.floor(Math.random() * dirs.length)];
    const isGoal = shotDir !== keeperDir;

    if (isGoal) {
      pb.goals = (Number(pb.goals) || 0) + 1;
      if (pb.goalEffectId) {
        this.triggerEffect(pb.goalEffectId, user, 'penalty_goal');
      }
    } else {
      pb.saves = (Number(pb.saves) || 0) + 1;
      if (pb.saveEffectId) {
        this.triggerEffect(pb.saveEffectId, user, 'penalty_save');
      }
    }

    const shot = {
      id: `shot_${Date.now()}`,
      user,
      shotDir,
      keeperDir,
      isGoal,
      giftName: meta.giftName || '',
      coins: Number(meta.coins) || 0,
      time: Date.now()
    };
    pb.lastShot = shot;
    // Rotate keeper stance randomly for next shot
    pb.keeperDir = dirs[Math.floor(Math.random() * dirs.length)];

    this.saveConfig();
    this.broadcast({
      type: 'penalty_shot',
      shot,
      penaltyBattle: pb
    });
    this._broadcastState('penaltyBattle');
    return shot;
  }

  updateSocials(patch = {}) {
    if (patch.enabled !== undefined) this.state.socials.enabled = Boolean(patch.enabled);
    if (patch.intervalSec !== undefined) this.state.socials.intervalSec = Math.max(2, Number(patch.intervalSec) || 6);
    if (Array.isArray(patch.items)) {
      this.state.socials.items = patch.items
        .filter(it => it && String(it.handle || '').trim())
        .map(it => ({
          platform: String(it.platform || 'custom'),
          icon: String(it.icon || '🔗'),
          handle: String(it.handle || '').trim()
        }));
    }
    this.saveConfig();
    this._broadcastState('socials');
    return this.state.socials;
  }

  updateSeasonalFx(patch = {}) {
    this.state.seasonalFx = {
      ...this.state.seasonalFx,
      ...patch,
      enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : this.state.seasonalFx.enabled,
      mode: ['snow', 'sakura', 'confetti', 'matrix'].includes(patch.mode) ? patch.mode : this.state.seasonalFx.mode,
      density: Math.max(10, Math.min(120, Number(patch.density ?? this.state.seasonalFx.density) || 45))
    };
    this.saveConfig();
    this._broadcastState('seasonalFx');
    return this.state.seasonalFx;
  }
}

module.exports = WidgetManager;

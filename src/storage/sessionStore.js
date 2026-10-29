const fs = require('fs');
const path = require('path');
const paths = require('../paths');

const SESSIONS_DIR = paths.SESSIONS_DIR;

class SessionStore {
  constructor() {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
    const today = new Date().toISOString().slice(0, 10);
    this.sessionFile = path.join(SESSIONS_DIR, `session_${today}.json`);
    this.data = {
      date: today,
      startedAt: Date.now(),
      updatedAt: Date.now(),
      totals: {
        coins: 0,
        giftsCount: 0,
        likesCount: 0,
        followsCount: 0,
        sharesCount: 0,
        chatsCount: 0,
        donationsIdr: 0,
        donationsCount: 0,
        effectsTriggered: 0
      },
      gifters: {},   // user -> { user, coins, gifts }
      likers: {},    // user -> { user, likes }
      donators: {},  // user -> { user, amountIdr, count }
      giftHistory: [] // last 500 gift/donation events
    };
    this.loadToday();
  }

  loadToday() {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const saved = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
        this.data = {
          ...this.data,
          ...saved,
          totals: { ...this.data.totals, ...(saved.totals || {}) }
        };
      }
    } catch {}
  }

  saveAtomic() {
    try {
      this.data.updatedAt = Date.now();
      const tmp = this.sessionFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.sessionFile);
    } catch {}
  }

  recordGift({ user, giftName, giftId, coins = 0, repeatCount = 1 }) {
    const c = Number(coins) || 0;
    this.data.totals.coins += c;
    this.data.totals.giftsCount += (Number(repeatCount) || 1);

    const g = this.data.gifters[user] || { user, coins: 0, gifts: 0 };
    g.coins += c;
    g.gifts += (Number(repeatCount) || 1);
    this.data.gifters[user] = g;

    this.data.giftHistory.unshift({
      time: new Date().toISOString(),
      type: 'gift',
      user,
      item: giftName || `Gift #${giftId}`,
      coins: c,
      amountIdr: 0,
      repeatCount
    });
    if (this.data.giftHistory.length > 500) this.data.giftHistory.length = 500;
    this.saveAtomic();
  }

  recordDonation({ user, platform, amount = 0, message = '' }) {
    const amt = Number(amount) || 0;
    this.data.totals.donationsIdr += amt;
    this.data.totals.donationsCount += 1;

    const d = this.data.donators[user] || { user, amountIdr: 0, count: 0 };
    d.amountIdr += amt;
    d.count += 1;
    this.data.donators[user] = d;

    this.data.giftHistory.unshift({
      time: new Date().toISOString(),
      type: `donation:${platform || 'saweria'}`,
      user,
      item: message || 'Donasi',
      coins: 0,
      amountIdr: amt,
      repeatCount: 1
    });
    if (this.data.giftHistory.length > 500) this.data.giftHistory.length = 500;
    this.saveAtomic();
  }

  recordLike({ user, count = 1 }) {
    const c = Number(count) || 1;
    this.data.totals.likesCount += c;
    const l = this.data.likers[user] || { user, likes: 0 };
    l.likes += c;
    this.data.likers[user] = l;
  }

  recordFollow() {
    this.data.totals.followsCount += 1;
  }

  recordShare() {
    this.data.totals.sharesCount += 1;
  }

  recordChat() {
    this.data.totals.chatsCount += 1;
  }

  recordEffectTriggered() {
    this.data.totals.effectsTriggered += 1;
  }

  getSummary() {
    const topGifters = Object.values(this.data.gifters).sort((a, b) => b.coins - a.coins).slice(0, 20);
    const topLikers = Object.values(this.data.likers).sort((a, b) => b.likes - a.likes).slice(0, 20);
    const topDonators = Object.values(this.data.donators).sort((a, b) => b.amountIdr - a.amountIdr).slice(0, 20);
    return {
      date: this.data.date,
      totals: this.data.totals,
      topGifters,
      topLikers,
      topDonators,
      recentHistory: this.data.giftHistory.slice(0, 100)
    };
  }

  resetSession() {
    this.data.totals = {
      coins: 0, giftsCount: 0, likesCount: 0, followsCount: 0,
      sharesCount: 0, chatsCount: 0, donationsIdr: 0, donationsCount: 0, effectsTriggered: 0
    };
    this.data.gifters = {};
    this.data.likers = {};
    this.data.donators = {};
    this.data.giftHistory = [];
    this.saveAtomic();
    return this.getSummary();
  }

  exportCsv() {
    const rows = [
      ['Timestamp', 'Type', 'Username', 'Item / Message', 'Coins', 'Amount (IDR)', 'Repeat Count']
    ];
    for (const h of this.data.giftHistory) {
      const safeItem = String(h.item || '').replace(/"/g, '""');
      rows.push([
        h.time,
        h.type,
        h.user,
        `"${safeItem}"`,
        h.coins || 0,
        h.amountIdr || 0,
        h.repeatCount || 1
      ]);
    }
    return rows.map(r => r.join(',')).join('\n');
  }
}

module.exports = new SessionStore();
